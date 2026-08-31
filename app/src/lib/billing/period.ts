import type { Database } from "~/lib/db/types";
import type { EpayMerchantClient } from "~/lib/epay";
import type { PeriodState } from "./types";

/**
 * The month-end close.
 *
 * Counting for an invoice is a close, not a running tally. Webhooks are lossy by
 * design — ePay pauses an endpoint that fails more than half the time over a week, and
 * abandons a delivery after 25 attempts — so a webhook-fed count can be short with
 * nothing anywhere looking wrong. That is fine for a dashboard and not good enough to
 * bill from.
 *
 * So each period is frozen, re-walked against ePay's own transaction list, and diffed.
 * Nothing can be rated or invoiced until every difference has been explained.
 *
 *   open → frozen → reconciling → (discrepancy) → reconciled → rated → issued
 */

export class PeriodStateError extends Error {
  constructor(
    readonly from: PeriodState,
    readonly to: PeriodState,
  ) {
    super(`Cannot move a billing period from ${from} to ${to}`);
    this.name = "PeriodStateError";
  }
}

/** Legal transitions. Anything not listed here is rejected. */
const transitions: Record<PeriodState, PeriodState[]> = {
  open: ["frozen"],
  frozen: ["reconciling"],
  reconciling: ["discrepancy", "reconciled"],
  // Resolving the differences sends it back through reconciliation, never straight on.
  discrepancy: ["reconciling"],
  reconciled: ["rated"],
  rated: ["issued"],
  issued: [],
};

export function canTransition(from: PeriodState, to: PeriodState): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export interface PeriodRow {
  id: string;
  merchant_id: string;
  year: number;
  month: number;
  state: PeriodState;
  starts_at_ms: number;
  ends_at_ms: number;
  mirror_count: number | null;
  epay_count: number | null;
  billable_count: number | null;
  price_plan_id: string | null;
  cost_plan_id: string | null;
}

/** Month boundaries in UTC: inclusive start, exclusive end. */
export function monthBounds(year: number, month: number): {
  startsAtMs: number;
  endsAtMs: number;
} {
  const startsAtMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  const endsAtMs = Date.UTC(year, month, 1, 0, 0, 0, 0);
  return { startsAtMs, endsAtMs };
}

export async function ensurePeriod(
  db: Database,
  merchantId: string,
  year: number,
  month: number,
  now: () => number = () => Date.now(),
): Promise<PeriodRow> {
  const existing = await db
    .prepare(
      `SELECT * FROM billing_period
        WHERE merchant_id = ?1 AND year = ?2 AND month = ?3`,
    )
    .bind(merchantId, year, month)
    .first<PeriodRow>();

  if (existing) return existing;

  const { startsAtMs, endsAtMs } = monthBounds(year, month);
  const timestamp = new Date(now()).toISOString();
  const id = `${merchantId}:${year}-${String(month).padStart(2, "0")}`;

  await db
    .prepare(
      `INSERT INTO billing_period (
         id, merchant_id, year, month, state, starts_at_ms, ends_at_ms,
         created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?6, ?7, ?7)
       ON CONFLICT (merchant_id, year, month) DO NOTHING`,
    )
    .bind(id, merchantId, year, month, startsAtMs, endsAtMs, timestamp)
    .run();

  const created = await db
    .prepare(`SELECT * FROM billing_period WHERE id = ?1`)
    .bind(id)
    .first<PeriodRow>();

  if (!created) throw new Error(`Failed to create billing period ${id}`);
  return created;
}

async function setState(
  db: Database,
  period: PeriodRow,
  next: PeriodState,
  columns: Record<string, unknown> = {},
  now: () => number = () => Date.now(),
): Promise<void> {
  if (!canTransition(period.state, next)) {
    throw new PeriodStateError(period.state, next);
  }

  const timestamp = new Date(now()).toISOString();
  const assignments = ["state = ?2", "updated_at = ?3"];
  const values: unknown[] = [period.id, next, timestamp];

  for (const [column, value] of Object.entries(columns)) {
    values.push(value);
    assignments.push(`${column} = ?${values.length}`);
  }

  await db
    .prepare(`UPDATE billing_period SET ${assignments.join(", ")} WHERE id = ?1`)
    .bind(...values)
    .run();
}

/**
 * Freezes the period.
 *
 * After this the billable set is fixed: late-arriving webhooks still update the mirror
 * for display, but reconciliation and rating work from the frozen window, so an
 * invoice cannot change under someone's feet while it is being reviewed.
 */
export async function freezePeriod(
  db: Database,
  period: PeriodRow,
  now: () => number = () => Date.now(),
): Promise<void> {
  const mirrorCount = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM txn
        WHERE merchant_id = ?1 AND created_at_ms >= ?2 AND created_at_ms < ?3`,
    )
    .bind(period.merchant_id, period.starts_at_ms, period.ends_at_ms)
    .first<{ count: number }>();

  await setState(
    db,
    period,
    "frozen",
    {
      frozen_at: new Date(now()).toISOString(),
      mirror_count: mirrorCount?.count ?? 0,
    },
    now,
  );
}

export interface ReconcileResult {
  complete: boolean;
  epayCount: number;
  mirrorCount: number;
  discrepancies: number;
  /** Cursor to resume from when the walk did not finish in this invocation. */
  nextCursor: string | null;
}

/**
 * Re-walks ePay for the period and records every difference against the mirror.
 *
 * Resumable: the ePay cursor is persisted after each page, so an invocation that runs
 * out of time or hits the rate limit continues rather than starting over. At one index
 * request per five seconds a restart is expensive enough to matter.
 *
 * The period window is [start, end) in our own storage, but ePay treats both bounds as
 * inclusive, so the upper bound sent to them is one millisecond short of our end.
 */
export async function reconcilePeriod(
  db: Database,
  client: EpayMerchantClient,
  period: PeriodRow,
  options: { maxPages?: number; now?: () => number } = {},
): Promise<ReconcileResult> {
  const now = options.now ?? (() => Date.now());
  const maxPages = options.maxPages ?? 20;

  if (period.state === "frozen") {
    await setState(db, period, "reconciling", {}, now);
    period = { ...period, state: "reconciling" };
  } else if (period.state === "discrepancy") {
    const unresolved = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM period_discrepancy
          WHERE billing_period_id = ?1 AND resolved_at IS NULL`,
      )
      .bind(period.id)
      .first<{ count: number }>();

    if ((unresolved?.count ?? 0) > 0) {
      throw new Error(
        `Period ${period.id} still has ${unresolved?.count} unresolved discrepancies`,
      );
    }
    await setState(db, period, "reconciling", {}, now);
    period = { ...period, state: "reconciling" };
  } else if (period.state !== "reconciling") {
    throw new PeriodStateError(period.state, "reconciling");
  }

  const cursorKey = `${period.id}:reconcile`;
  const stored = await db
    .prepare(`SELECT cursor, items_seen FROM sync_cursor WHERE id = ?1`)
    .bind(cursorKey)
    .first<{ cursor: string | null; items_seen: number }>();

  if (!stored) {
    await db
      .prepare(
        `INSERT INTO sync_cursor (
           id, merchant_id, kind, cursor, window_start, window_end, state,
           items_seen, started_at_ms, updated_at_ms
         ) VALUES (?1, ?2, 'reconcile', NULL, ?3, ?4, 'running', 0, ?5, ?5)`,
      )
      .bind(
        cursorKey,
        period.merchant_id,
        new Date(period.starts_at_ms).toISOString(),
        new Date(period.ends_at_ms - 1).toISOString(),
        now(),
      )
      .run();
  }

  let cursor = stored?.cursor ?? "";
  let seen = stored?.items_seen ?? 0;
  let pages = 0;
  let complete = false;

  while (pages < maxPages) {
    const page = await client.listTransactions({
      createdAfter: new Date(period.starts_at_ms).toISOString(),
      // ePay's upper bound is inclusive; ours is exclusive.
      createdBefore: new Date(period.ends_at_ms - 1).toISOString(),
      perPage: 500,
      offset: cursor,
    });
    pages += 1;

    for (const item of page.items) {
      seen += 1;
      const mirrored = await db
        .prepare(`SELECT id, amount, state FROM txn WHERE id = ?1 AND merchant_id = ?2`)
        .bind(item.transaction.id, period.merchant_id)
        .first<{ id: string; amount: number; state: string }>();

      if (!mirrored) {
        await recordDiscrepancy(db, period, item.transaction.id, "missing_locally", {
          amount: item.transaction.amount,
          state: item.transaction.state,
        });
      } else if (mirrored.amount !== item.transaction.amount) {
        await recordDiscrepancy(db, period, item.transaction.id, "amount_mismatch", {
          mirror: mirrored.amount,
          epay: item.transaction.amount,
        });
      } else if (mirrored.state !== item.transaction.state) {
        await recordDiscrepancy(db, period, item.transaction.id, "state_mismatch", {
          mirror: mirrored.state,
          epay: item.transaction.state,
        });
      }
    }

    const hasMore = page.hasMore && page.nextOffset !== null;
    cursor = page.nextOffset ?? "";

    await db
      .prepare(
        `UPDATE sync_cursor SET cursor = ?2, items_seen = ?3, updated_at_ms = ?4,
                state = ?5 WHERE id = ?1`,
      )
      .bind(cursorKey, hasMore ? cursor : null, seen, now(), hasMore ? "running" : "complete")
      .run();

    if (!hasMore) {
      complete = true;
      break;
    }
  }

  if (!complete) {
    return {
      complete: false,
      epayCount: seen,
      mirrorCount: period.mirror_count ?? 0,
      discrepancies: await countDiscrepancies(db, period.id),
      nextCursor: cursor,
    };
  }

  // The walk finished. Anything in our mirror that ePay did not return is also a
  // difference — a row we invented, or one ePay has since removed.
  const extras = await db
    .prepare(
      `SELECT t.id FROM txn t
        WHERE t.merchant_id = ?1
          AND t.created_at_ms >= ?2 AND t.created_at_ms < ?3
          AND NOT EXISTS (
            SELECT 1 FROM period_discrepancy d
             WHERE d.billing_period_id = ?4 AND d.transaction_id = t.id
          )`,
    )
    .bind(period.merchant_id, period.starts_at_ms, period.ends_at_ms, period.id)
    .all<{ id: string }>();

  const mirrorCount = extras.results.length;
  if (mirrorCount > seen) {
    // More locally than ePay returned: flag the surplus rather than silently billing it.
    await db
      .prepare(
        `UPDATE billing_period SET notes = ?2 WHERE id = ?1`,
      )
      .bind(
        period.id,
        `Mirror holds ${mirrorCount} rows against ${seen} from ePay`,
      )
      .run();
  }

  const discrepancies = await countDiscrepancies(db, period.id);
  const current = await db
    .prepare(`SELECT * FROM billing_period WHERE id = ?1`)
    .bind(period.id)
    .first<PeriodRow>();

  await setState(
    db,
    current ?? period,
    discrepancies > 0 ? "discrepancy" : "reconciled",
    {
      epay_count: seen,
      reconciled_at: discrepancies > 0 ? null : new Date(now()).toISOString(),
    },
    now,
  );

  return {
    complete: true,
    epayCount: seen,
    mirrorCount,
    discrepancies,
    nextCursor: null,
  };
}

async function recordDiscrepancy(
  db: Database,
  period: PeriodRow,
  transactionId: string,
  kind: string,
  detail: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO period_discrepancy (
         id, billing_period_id, merchant_id, transaction_id, kind, detail, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (id) DO UPDATE SET detail = excluded.detail`,
    )
    .bind(
      `${period.id}:${transactionId}:${kind}`,
      period.id,
      period.merchant_id,
      transactionId,
      kind,
      JSON.stringify(detail),
      new Date().toISOString(),
    )
    .run();
}

async function countDiscrepancies(db: Database, periodId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM period_discrepancy
        WHERE billing_period_id = ?1 AND resolved_at IS NULL`,
    )
    .bind(periodId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function resolveDiscrepancy(
  db: Database,
  discrepancyId: string,
  resolvedBy: string,
  resolution: string,
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE period_discrepancy
          SET resolved_at = ?2, resolved_by = ?3, resolution = ?4
        WHERE id = ?1`,
    )
    .bind(discrepancyId, new Date(now()).toISOString(), resolvedBy, resolution)
    .run();
}

/**
 * The gate every invoice has to pass.
 *
 * Called before rating and again before issuing. A period that has not balanced
 * against ePay cannot produce an invoice, which is the whole reason the close exists.
 */
export async function assertReadyToRate(
  db: Database,
  periodId: string,
): Promise<PeriodRow> {
  const period = await db
    .prepare(`SELECT * FROM billing_period WHERE id = ?1`)
    .bind(periodId)
    .first<PeriodRow>();

  if (!period) throw new Error(`Unknown billing period ${periodId}`);

  if (period.state !== "reconciled") {
    throw new PeriodStateError(period.state, "rated");
  }

  const outstanding = await countDiscrepancies(db, periodId);
  if (outstanding > 0) {
    throw new Error(
      `Period ${periodId} has ${outstanding} unresolved discrepancies and cannot be rated`,
    );
  }

  return period;
}

export async function markRated(
  db: Database,
  period: PeriodRow,
  billableCount: number,
  grossMinor: number,
  now: () => number = () => Date.now(),
): Promise<void> {
  await setState(
    db,
    period,
    "rated",
    {
      rated_at: new Date(now()).toISOString(),
      billable_count: billableCount,
      gross_minor: grossMinor,
    },
    now,
  );
}

export async function markIssued(
  db: Database,
  period: PeriodRow,
  now: () => number = () => Date.now(),
): Promise<void> {
  await setState(
    db,
    period,
    "issued",
    { issued_at: new Date(now()).toISOString() },
    now,
  );
}

/** The frozen, reconciled set of transactions the rating engine works from. */
export async function billableTransactions(
  db: Database,
  period: PeriodRow,
  billableStates: string[],
  billableTypes: string[],
): Promise<
  Array<{
    id: string;
    state: string;
    type: string;
    amount: number;
    currency: string;
    createdAtMs: number;
    pointOfSaleId: string | null;
  }>
> {
  const statePlaceholders = billableStates.map(() => "?").join(", ");
  const typePlaceholders = billableTypes.map(() => "?").join(", ");

  const result = await db
    .prepare(
      `SELECT id, state, type, amount, currency, created_at_ms, point_of_sale_id
         FROM txn
        WHERE merchant_id = ?
          AND created_at_ms >= ?
          AND created_at_ms < ?
          AND state IN (${statePlaceholders})
          AND type IN (${typePlaceholders})
        ORDER BY created_at_ms ASC, id ASC`,
    )
    .bind(
      period.merchant_id,
      period.starts_at_ms,
      period.ends_at_ms,
      ...billableStates,
      ...billableTypes,
    )
    .all<{
      id: string;
      state: string;
      type: string;
      amount: number;
      currency: string;
      created_at_ms: number;
      point_of_sale_id: string | null;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    state: row.state,
    type: row.type,
    amount: row.amount,
    currency: row.currency,
    createdAtMs: row.created_at_ms,
    pointOfSaleId: row.point_of_sale_id,
  }));
}
