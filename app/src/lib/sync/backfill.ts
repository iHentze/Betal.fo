import type { Database } from "~/lib/db/types";
import type { EpayMerchantClient, ListTransactionsQuery } from "~/lib/epay";
import { transactionUpsert } from "~/lib/ingest/project";

/**
 * Backfill and resynchronisation of the mirror from ePay's REST API.
 *
 * This is the slow path. Index endpoints allow one request per five seconds, so a run
 * over a busy month can take a while and must survive being interrupted: the ePay
 * cursor is persisted after every page, and a resumed run continues from it rather
 * than restarting and spending the rate-limit budget twice.
 *
 * Webhooks remain the primary feed. This exists to fill gaps — a paused endpoint, a
 * delivery that exhausted its 25 retries, or a merchant onboarded with history.
 */

export type SyncKind = "backfill" | "reconcile" | "settlements";

export interface SyncWindow {
  /** Inclusive lower bound, ISO 8601. */
  createdAfter: string;
  /** Inclusive upper bound, ISO 8601. */
  createdBefore: string;
}

export interface BackfillOptions {
  merchantId: string;
  window: SyncWindow;
  kind?: SyncKind;
  /** Stop after this many pages so a Worker invocation stays inside its limits. */
  maxPages?: number;
  perPage?: number;
  now?: () => number;
}

export interface BackfillResult {
  /** Transactions written on this run. */
  written: number;
  /** Null when the walk finished; otherwise the cursor to resume from. */
  nextCursor: string | null;
  complete: boolean;
  pages: number;
}

interface CursorRow {
  id: string;
  cursor: string | null;
  items_seen: number;
  state: string;
}

function cursorId(merchantId: string, kind: SyncKind, window: SyncWindow): string {
  return `${merchantId}:${kind}:${window.createdAfter}:${window.createdBefore}`;
}

/**
 * Walks one window of transactions into the mirror, resuming from any stored cursor.
 *
 * Call repeatedly until `complete` is true. Each call does at most `maxPages` pages so
 * it can run inside a Worker invocation and be continued by the next scheduled run.
 */
export async function backfillTransactions(
  db: Database,
  client: EpayMerchantClient,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const {
    merchantId,
    window,
    kind = "backfill",
    maxPages = 20,
    perPage = 500,
  } = options;
  const now = options.now ?? (() => Date.now());
  const id = cursorId(merchantId, kind, window);

  const existing = await db
    .prepare(`SELECT id, cursor, items_seen, state FROM sync_cursor WHERE id = ?1`)
    .bind(id)
    .first<CursorRow>();

  if (existing?.state === "complete") {
    return { written: 0, nextCursor: null, complete: true, pages: 0 };
  }

  if (!existing) {
    await db
      .prepare(
        `INSERT INTO sync_cursor (
           id, merchant_id, kind, cursor, window_start, window_end, state,
           items_seen, started_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'running', 0, ?6, ?6)`,
      )
      .bind(id, merchantId, kind, window.createdAfter, window.createdBefore, now())
      .run();
  }

  const query: ListTransactionsQuery = {
    createdAfter: window.createdAfter,
    createdBefore: window.createdBefore,
    perPage,
  };

  let cursor = existing?.cursor ?? "";
  let written = 0;
  let pages = 0;
  let complete = false;

  try {
    while (pages < maxPages) {
      const page = await client.listTransactions({ ...query, offset: cursor });
      pages += 1;

      if (page.items.length > 0) {
        await db.batch(
          page.items.map((item) =>
            // Marked as a backfill so a later audit can tell which rows came from the
            // API rather than a webhook. Card and SCA columns are absent from this
            // source and the upsert's COALESCE keeps any we already had.
            transactionUpsert(db, merchantId, item.transaction, { source: "backfill" }),
          ),
        );
        written += page.items.length;
      }

      const hasMore = page.hasMore && page.nextOffset !== null;
      cursor = page.nextOffset ?? "";

      await db
        .prepare(
          `UPDATE sync_cursor
              SET cursor = ?2, items_seen = items_seen + ?3, updated_at_ms = ?4,
                  state = ?5
            WHERE id = ?1`,
        )
        .bind(
          id,
          hasMore ? cursor : null,
          page.items.length,
          now(),
          hasMore ? "running" : "complete",
        )
        .run();

      if (!hasMore) {
        complete = true;
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The cursor already points at the next unread page, so a retry resumes rather
    // than repeating work.
    await db
      .prepare(
        `UPDATE sync_cursor SET state = 'error', error = ?2, updated_at_ms = ?3
          WHERE id = ?1`,
      )
      .bind(id, message, now())
      .run();
    throw error;
  }

  return { written, nextCursor: complete ? null : cursor, complete, pages };
}

/**
 * Pulls a settlement transfer and its per-transaction rows into the mirror.
 *
 * Driven by settlement.transfer-ready.v1 rather than polling, because the settlement
 * endpoints have no filters at all — no date range, no acquirer, and no way to find a
 * transfer by transaction id. Walking them to find something would be prohibitive
 * under the rate limit.
 */
export async function syncSettlementTransfer(
  db: Database,
  client: EpayMerchantClient,
  merchantId: string,
  transferId: string,
): Promise<{ rows: number }> {
  const transfer = await client.getSettlementTransfer(transferId);

  await db
    .prepare(
      `INSERT INTO settlement_transfer (
         id, merchant_id, acquirer, settlement_name, settlement_ids, posting_date,
         net_amount, currency, acquirer_reference, created_at, created_at_ms
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT (id) DO UPDATE SET
         net_amount = excluded.net_amount,
         posting_date = excluded.posting_date`,
    )
    .bind(
      transfer.id,
      merchantId,
      transfer.acquirer ?? null,
      transfer.settlementName ?? null,
      JSON.stringify(transfer.settlementIds ?? []),
      transfer.postingDate ?? null,
      transfer.netAmount,
      transfer.currency,
      transfer.acquirerReference ?? null,
      transfer.createdAt,
      Date.parse(transfer.createdAt) || Date.now(),
    )
    .run();

  let rows = 0;
  for await (const item of client.iterateSettlementTransactions(transferId)) {
    const settlement = item.settlementTransaction;

    const statements = [
      db
        .prepare(
          `INSERT INTO settlement_transaction (
             id, settlement_transfer_id, merchant_id, transaction_id, agreement_id,
             merchant_reference, acquirer_reference, posting_date, net_amount,
             currency, created_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
           ON CONFLICT (id) DO UPDATE SET net_amount = excluded.net_amount`,
        )
        .bind(
          settlement.id,
          transferId,
          merchantId,
          settlement.transactionId ?? null,
          settlement.agreementId ?? null,
          settlement.merchantReference ?? null,
          settlement.acquirerReference ?? null,
          settlement.postingDate ?? null,
          settlement.settlementNetAmount,
          settlement.settlementCurrency,
          settlement.createdAt,
        ),
    ];

    // These are the acquirer, interchange and scheme costs. They are what makes fee
    // transparency and acquirer comparison possible, so they are stored per row.
    for (const [index, adjustment] of (settlement.adjustments ?? []).entries()) {
      statements.push(
        db
          .prepare(
            `INSERT INTO settlement_adjustment (
               id, merchant_id, settlement_transfer_id, settlement_transaction_id,
               scope, type, amount, description
             ) VALUES (?1, ?2, ?3, ?4, 'transaction', ?5, ?6, ?7)
             ON CONFLICT (id) DO UPDATE SET amount = excluded.amount`,
          )
          .bind(
            `${settlement.id}:txn:${index}`,
            merchantId,
            transferId,
            settlement.id,
            adjustment.type,
            adjustment.amount,
            adjustment.description ?? null,
          ),
      );
    }

    await db.batch(statements);
    rows += 1;
  }

  await db
    .prepare(`UPDATE settlement_transfer SET transactions_synced = 1 WHERE id = ?1`)
    .bind(transferId)
    .run();

  return { rows };
}

/**
 * Splits a range into windows that can each be walked in one go.
 *
 * ePay treats both `createdAfter` and `createdBefore` as inclusive, so naively chaining
 * windows would count the boundary transaction twice. Each window after the first
 * therefore starts one millisecond after the previous ended.
 */
export function splitWindow(
  from: Date,
  to: Date,
  days = 7,
): SyncWindow[] {
  const windows: SyncWindow[] = [];
  const stepMs = days * 24 * 60 * 60 * 1000;
  let start = from.getTime();
  const end = to.getTime();

  while (start <= end) {
    const stop = Math.min(start + stepMs - 1, end);
    windows.push({
      createdAfter: new Date(start).toISOString(),
      createdBefore: new Date(stop).toISOString(),
    });
    start = stop + 1;
  }

  return windows;
}
