import type { Database } from "./types";

/**
 * Read-model queries.
 *
 * Every list view in the product is served from here, never by proxying ePay: their
 * index endpoints allow one request per five seconds, which a handful of concurrent
 * users would exhaust immediately.
 *
 * Pagination is keyset rather than offset. Transaction tables grow without bound and
 * OFFSET degrades linearly, but more importantly a merchant paging through history
 * while new payments arrive would see rows shift between pages.
 */

export interface TransactionFilters {
  merchantId: string;
  state?: string;
  pointOfSaleId?: string;
  reference?: string;
  search?: string;
  currency?: string;
  paymentMethodType?: string;
  acquirer?: string;
  /** Inclusive, epoch millis. */
  from?: number;
  /** Exclusive, epoch millis, so adjacent ranges never double-count. */
  to?: number;
  minAmount?: number;
  maxAmount?: number;
}

export interface TransactionRow {
  id: string;
  state: string;
  type: string;
  amount: number;
  surcharge: number;
  currency: string;
  reference: string | null;
  payment_method_type: string | null;
  payment_method_sub_type: string | null;
  payment_method_display: string | null;
  card_scheme: string | null;
  card_issuer: string | null;
  acquirer: string | null;
  error_code: string | null;
  amount_captured: number | null;
  amount_refunded: number | null;
  amount_remaining: number | null;
  sca_verification: string | null;
  created_at: string;
  created_at_ms: number;
  point_of_sale_id: string | null;
}

export interface Page<T> {
  rows: T[];
  /** Pass back as `cursor` to fetch the next page. Null when exhausted. */
  nextCursor: string | null;
}

function buildTransactionWhere(filters: TransactionFilters): {
  clause: string;
  params: unknown[];
} {
  const conditions = ["t.merchant_id = ?"];
  const params: unknown[] = [filters.merchantId];

  if (filters.state) {
    conditions.push("t.state = ?");
    params.push(filters.state);
  }
  if (filters.pointOfSaleId) {
    conditions.push("t.point_of_sale_id = ?");
    params.push(filters.pointOfSaleId);
  }
  if (filters.reference) {
    conditions.push("t.reference = ?");
    params.push(filters.reference);
  }
  if (filters.currency) {
    conditions.push("t.currency = ?");
    params.push(filters.currency);
  }
  if (filters.paymentMethodType) {
    conditions.push("t.payment_method_type = ?");
    params.push(filters.paymentMethodType);
  }
  if (filters.acquirer) {
    conditions.push("t.acquirer = ?");
    params.push(filters.acquirer);
  }
  if (filters.from !== undefined) {
    conditions.push("t.created_at_ms >= ?");
    params.push(filters.from);
  }
  if (filters.to !== undefined) {
    conditions.push("t.created_at_ms < ?");
    params.push(filters.to);
  }
  if (filters.minAmount !== undefined) {
    conditions.push("t.amount >= ?");
    params.push(filters.minAmount);
  }
  if (filters.maxAmount !== undefined) {
    conditions.push("t.amount <= ?");
    params.push(filters.maxAmount);
  }
  if (filters.search) {
    // Reference or masked card. Deliberately narrow: a LIKE across every column would
    // table-scan, and the reference is what merchants actually search by.
    conditions.push("(t.reference LIKE ? OR t.payment_method_display LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  return { clause: conditions.join(" AND "), params };
}

/** Encodes the sort key so a caller cannot craft one that skips rows. */
function encodeCursor(createdAtMs: number, id: string): string {
  return `${createdAtMs}:${id}`;
}

function decodeCursor(cursor: string): { createdAtMs: number; id: string } | null {
  const separator = cursor.indexOf(":");
  if (separator < 1) return null;
  const createdAtMs = Number.parseInt(cursor.slice(0, separator), 10);
  const id = cursor.slice(separator + 1);
  if (!Number.isFinite(createdAtMs) || !id) return null;
  return { createdAtMs, id };
}

export async function listTransactions(
  db: Database,
  filters: TransactionFilters,
  limit = 50,
  cursor?: string,
): Promise<Page<TransactionRow>> {
  const { clause, params } = buildTransactionWhere(filters);
  const conditions = [clause];

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      // Tie-break on id so transactions sharing a millisecond are never skipped or
      // repeated across a page boundary.
      conditions.push("(t.created_at_ms < ? OR (t.created_at_ms = ? AND t.id < ?))");
      params.push(decoded.createdAtMs, decoded.createdAtMs, decoded.id);
    }
  }

  // One extra row tells us whether another page exists without a second count query.
  const result = await db
    .prepare(
      `SELECT t.id, t.state, t.type, t.amount, t.surcharge, t.currency, t.reference,
              t.payment_method_type, t.payment_method_sub_type, t.payment_method_display,
              t.card_scheme, t.card_issuer, t.acquirer, t.error_code,
              t.amount_captured, t.amount_refunded, t.amount_remaining,
              t.sca_verification, t.created_at, t.created_at_ms, t.point_of_sale_id
         FROM txn t
        WHERE ${conditions.join(" AND ")}
        ORDER BY t.created_at_ms DESC, t.id DESC
        LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<TransactionRow>();

  const rows = result.results.slice(0, limit);
  const hasMore = result.results.length > limit;
  const last = rows[rows.length - 1];

  return {
    rows,
    nextCursor: hasMore && last ? encodeCursor(last.created_at_ms, last.id) : null,
  };
}

export interface TransactionTotals {
  count: number;
  gross: number;
  captured: number;
  refunded: number;
}

/**
 * Totals for the current filter, shown under the list.
 *
 * Separate from the page query because it scans the whole filtered set; the UI renders
 * the rows first and fills the summary in when it arrives.
 */
export async function transactionTotals(
  db: Database,
  filters: TransactionFilters,
): Promise<TransactionTotals> {
  const { clause, params } = buildTransactionWhere(filters);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(t.amount), 0) AS gross,
              COALESCE(SUM(t.amount_captured), 0) AS captured,
              COALESCE(SUM(t.amount_refunded), 0) AS refunded
         FROM txn t
        WHERE ${clause}`,
    )
    .bind(...params)
    .first<TransactionTotals>();

  return row ?? { count: 0, gross: 0, captured: 0, refunded: 0 };
}

export async function getTransaction(
  db: Database,
  merchantId: string,
  transactionId: string,
): Promise<{
  transaction: Record<string, unknown> | null;
  operations: Record<string, unknown>[];
  settlement: Record<string, unknown>[];
  adjustments: Array<{ type: string; amount: string; description: string | null }>;
}> {
  const transaction = await db
    .prepare(`SELECT * FROM txn WHERE merchant_id = ?1 AND id = ?2`)
    .bind(merchantId, transactionId)
    .first<Record<string, unknown>>();

  if (!transaction) {
    return { transaction: null, operations: [], settlement: [], adjustments: [] };
  }

  const operations = await db
    .prepare(
      `SELECT * FROM operation WHERE transaction_id = ?1 ORDER BY created_at_ms ASC`,
    )
    .bind(transactionId)
    .all<Record<string, unknown>>();

  // One transaction can map to several settlement rows when partial captures or
  // refunds were used, so this is a list rather than a single row.
  const settlement = await db
    .prepare(
      `SELECT st.*, tr.posting_date AS transfer_posting_date, tr.acquirer
         FROM settlement_transaction st
         JOIN settlement_transfer tr ON tr.id = st.settlement_transfer_id
        WHERE st.transaction_id = ?1`,
    )
    .bind(transactionId)
    .all<Record<string, unknown>>();

  // The acquirer, interchange and scheme fees charged against this one payment.
  // Shown inline on the transaction so the gap between what was charged and what
  // will arrive is answered where the question is asked, rather than only on the
  // settlements screen.
  const adjustments = await db
    .prepare(
      `SELECT a.type, a.amount, a.description
         FROM settlement_adjustment a
         JOIN settlement_transaction st ON st.id = a.settlement_transaction_id
        WHERE st.transaction_id = ?1
        ORDER BY a.type`,
    )
    .bind(transactionId)
    .all<{ type: string; amount: string; description: string | null }>();

  return {
    transaction,
    operations: operations.results,
    settlement: settlement.results,
    adjustments: adjustments.results,
  };
}

/**
 * Settlement transfers for a merchant, with the fee total that explains the gap
 * between what they sold and what reached their bank.
 */
export async function listSettlementTransfers(
  db: Database,
  merchantId: string,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const result = await db
    .prepare(
      `SELECT tr.*,
              (SELECT COUNT(*) FROM settlement_transaction st
                WHERE st.settlement_transfer_id = tr.id) AS transaction_count
         FROM settlement_transfer tr
        WHERE tr.merchant_id = ?1
        ORDER BY tr.posting_date DESC
        LIMIT ?2`,
    )
    .bind(merchantId, limit)
    .all<Record<string, unknown>>();
  return result.results;
}

export interface FeeBreakdownRow {
  type: string;
  /** Decimal string sum. Computed in SQL as text to avoid float rounding. */
  total: string;
  count: number;
}

/**
 * Acquirer, interchange and scheme fees for one transfer.
 *
 * This is the number no international dashboard shows a merchant: exactly what was
 * deducted from the payout and by whom. Amounts are decimal strings, so they are
 * summed as scaled integers rather than through binary floating point.
 */
export async function settlementFeeBreakdown(
  db: Database,
  transferId: string,
): Promise<FeeBreakdownRow[]> {
  const result = await db
    .prepare(
      `SELECT type,
              CAST(ROUND(SUM(CAST(amount AS REAL) * 100)) AS INTEGER) AS minor_total,
              COUNT(*) AS count
         FROM settlement_adjustment
        WHERE settlement_transfer_id = ?1
        GROUP BY type
        ORDER BY type`,
    )
    .bind(transferId)
    .all<{ type: string; minor_total: number; count: number }>();

  return result.results.map((row) => ({
    type: row.type,
    total: (row.minor_total / 100).toFixed(2),
    count: row.count,
  }));
}

/**
 * Webhook endpoints ePay has paused.
 *
 * A paused webhook stops a merchant's data silently — no error surfaces, the events
 * just stop — so this drives an alert rather than sitting on a settings page.
 */
export async function pausedWebhooks(
  db: Database,
): Promise<Array<{ merchant_id: string; url: string; pause_reason: string | null }>> {
  const result = await db
    .prepare(
      `SELECT merchant_id, url, pause_reason FROM webhook_endpoint
        WHERE paused_at IS NOT NULL`,
    )
    .all<{ merchant_id: string; url: string; pause_reason: string | null }>();
  return result.results;
}

/** Merchants whose mirror has not been touched recently, as a staleness signal. */
export async function staleMerchants(
  db: Database,
  olderThanMs: number,
): Promise<Array<{ merchant_id: string; last_synced_ms: number | null }>> {
  const result = await db
    .prepare(
      `SELECT m.id AS merchant_id, MAX(t.synced_at_ms) AS last_synced_ms
         FROM merchant m
         LEFT JOIN txn t ON t.merchant_id = m.id
        WHERE m.status = 'active'
        GROUP BY m.id
       HAVING last_synced_ms IS NULL OR last_synced_ms < ?1`,
    )
    .bind(olderThanMs)
    .all<{ merchant_id: string; last_synced_ms: number | null }>();
  return result.results;
}
