import type { Database } from "~/lib/db/types";
import { applyBasisPoints, decimalToMinor, minorToDecimal } from "~/lib/money";
import type { CostPlan } from "./types";

/**
 * Margin and acquirer analysis.
 *
 * Betal buys the gateway from ePay wholesale at a per-merchant discount and charges
 * the merchant its own fee. ePay exposes no partner billing, commission or
 * revenue-share data whatsoever, so the cost side cannot be fetched — it is recorded
 * by hand from the commercial agreement as a cost plan, and margin is computed here.
 *
 * The acquirer side is different and better: settlement adjustments expose the
 * acquirer, interchange and scheme fee for every settled transaction. That is worth
 * mining twice — it lets a merchant see honestly what was deducted from their payout,
 * and it gives Betal evidence for which acquirer to push at renegotiation.
 *
 * Note these are different people's money and must never be added together. The
 * acquirer fee is the merchant's cost. ePay's gateway rate is Betal's cost. Betal's
 * fee is Betal's revenue.
 */

export interface MarginRow {
  merchantId: string;
  merchantName: string;
  year: number;
  month: number;
  billableCount: number;
  /** What we invoiced, excluding VAT. VAT is never ours. */
  revenueMinor: number;
  /** What ePay charges us, from the recorded cost plan. */
  costMinor: number;
  marginMinor: number;
  /** Basis points of revenue retained; null when there was no revenue. */
  marginBasisPoints: number | null;
  currency: string;
}

/** Computes what ePay charges us for a period under the applicable cost plan. */
export function costFor(
  plan: Pick<
    CostPlan,
    "perTransactionMinor" | "monthlyFixedMinor" | "percentageBasisPoints"
  >,
  billableCount: number,
  volumeMinor: number,
): number {
  return (
    plan.monthlyFixedMinor +
    plan.perTransactionMinor * billableCount +
    applyBasisPoints(volumeMinor, plan.percentageBasisPoints)
  );
}

/**
 * Margin per merchant for a month.
 *
 * Revenue is taken from the issued invoice rather than recomputed, so the figure
 * always matches what the client was actually billed.
 */
export async function marginForPeriod(
  db: Database,
  year: number,
  month: number,
): Promise<MarginRow[]> {
  const rows = await db
    .prepare(
      `SELECT p.merchant_id, m.name AS merchant_name, p.year, p.month,
              COALESCE(p.billable_count, 0) AS billable_count,
              COALESCE(p.gross_minor, 0) AS volume_minor,
              i.net_minor AS revenue_minor,
              i.currency AS currency,
              c.per_transaction_minor, c.monthly_fixed_minor,
              c.percentage_basis_points
         FROM billing_period p
         JOIN merchant m ON m.id = p.merchant_id
         LEFT JOIN invoice i
                ON i.billing_period_id = p.id AND i.kind = 'invoice'
               AND i.state IN ('issued', 'paid', 'overdue', 'credited')
         LEFT JOIN cost_plan c
                ON c.merchant_id = p.merchant_id
               AND c.effective_from <= p.created_at
               AND (c.effective_to IS NULL OR c.effective_to > p.created_at)
        WHERE p.year = ?1 AND p.month = ?2
        ORDER BY m.name`,
    )
    .bind(year, month)
    .all<{
      merchant_id: string;
      merchant_name: string;
      year: number;
      month: number;
      billable_count: number;
      volume_minor: number;
      revenue_minor: number | null;
      currency: string | null;
      per_transaction_minor: number | null;
      monthly_fixed_minor: number | null;
      percentage_basis_points: number | null;
    }>();

  return rows.results.map((row) => {
    const revenueMinor = row.revenue_minor ?? 0;
    const costMinor = costFor(
      {
        perTransactionMinor: row.per_transaction_minor ?? 0,
        monthlyFixedMinor: row.monthly_fixed_minor ?? 0,
        percentageBasisPoints: row.percentage_basis_points ?? 0,
      },
      row.billable_count,
      row.volume_minor,
    );

    const marginMinor = revenueMinor - costMinor;

    return {
      merchantId: row.merchant_id,
      merchantName: row.merchant_name,
      year: row.year,
      month: row.month,
      billableCount: row.billable_count,
      revenueMinor,
      costMinor,
      marginMinor,
      marginBasisPoints:
        revenueMinor > 0 ? Math.round((marginMinor * 10000) / revenueMinor) : null,
      currency: row.currency ?? "DKK",
    };
  });
}

export interface AcquirerCost {
  acquirer: string;
  transactionCount: number;
  /** Settled volume, as a decimal string. */
  volume: string;
  /** Total acquirer, interchange and scheme fees, as a decimal string (negative). */
  fees: string;
  /** Effective rate in basis points: fees as a share of settled volume. */
  effectiveBasisPoints: number | null;
  breakdown: Record<string, string>;
}

/**
 * Effective acquirer cost per acquirer, derived from settlement data.
 *
 * This is the report that pays for itself. Acquirers quote headline rates; what a
 * merchant actually pays depends on their card mix, and only settled data shows it.
 * Running this across the book tells Betal which acquirer genuinely costs least for
 * the kind of trade Faroese merchants do.
 *
 * Amounts stay decimal strings throughout and are summed as scaled integers, never
 * through floating point.
 */
export async function acquirerCosts(
  db: Database,
  options: { merchantId?: string; since?: string } = {},
): Promise<AcquirerCost[]> {
  const conditions: string[] = ["1 = 1"];
  const params: unknown[] = [];

  if (options.merchantId) {
    conditions.push("tr.merchant_id = ?");
    params.push(options.merchantId);
  }
  if (options.since) {
    conditions.push("tr.posting_date >= ?");
    params.push(options.since);
  }

  const rows = await db
    .prepare(
      `SELECT tr.acquirer,
              a.type AS adjustment_type,
              a.amount AS amount,
              st.net_amount AS net_amount,
              st.id AS settlement_transaction_id
         FROM settlement_transaction st
         JOIN settlement_transfer tr ON tr.id = st.settlement_transfer_id
         LEFT JOIN settlement_adjustment a
                ON a.settlement_transaction_id = st.id
        WHERE ${conditions.join(" AND ")}`,
    )
    .bind(...params)
    .all<{
      acquirer: string | null;
      adjustment_type: string | null;
      amount: string | null;
      net_amount: string;
      settlement_transaction_id: string;
    }>();

  const byAcquirer = new Map<
    string,
    {
      transactions: Set<string>;
      volumeMinor: number;
      feesMinor: number;
      breakdown: Map<string, number>;
    }
  >();

  for (const row of rows.results) {
    const acquirer = row.acquirer ?? "unknown";
    let entry = byAcquirer.get(acquirer);
    if (!entry) {
      entry = {
        transactions: new Set(),
        volumeMinor: 0,
        feesMinor: 0,
        breakdown: new Map(),
      };
      byAcquirer.set(acquirer, entry);
    }

    // A settlement transaction appears once per adjustment after the join, so volume
    // is only counted the first time we see each id.
    if (!entry.transactions.has(row.settlement_transaction_id)) {
      entry.transactions.add(row.settlement_transaction_id);
      entry.volumeMinor += decimalToMinor(row.net_amount);
    }

    if (row.adjustment_type && row.amount) {
      const minor = decimalToMinor(row.amount);
      entry.feesMinor += minor;
      entry.breakdown.set(
        row.adjustment_type,
        (entry.breakdown.get(row.adjustment_type) ?? 0) + minor,
      );
    }
  }

  return Array.from(byAcquirer.entries())
    .map(([acquirer, entry]) => ({
      acquirer,
      transactionCount: entry.transactions.size,
      volume: minorToDecimal(entry.volumeMinor),
      fees: minorToDecimal(entry.feesMinor),
      effectiveBasisPoints:
        entry.volumeMinor > 0
          ? Math.round((Math.abs(entry.feesMinor) * 10000) / entry.volumeMinor)
          : null,
      breakdown: Object.fromEntries(
        Array.from(entry.breakdown.entries()).map(([type, minor]) => [
          type,
          minorToDecimal(minor),
        ]),
      ),
    }))
    .sort((a, b) => (a.effectiveBasisPoints ?? 0) - (b.effectiveBasisPoints ?? 0));
}

export interface MarginTotals {
  revenueMinor: number;
  costMinor: number;
  marginMinor: number;
  merchantCount: number;
}

export function totalMargin(rows: MarginRow[]): MarginTotals {
  return rows.reduce<MarginTotals>(
    (totals, row) => ({
      revenueMinor: totals.revenueMinor + row.revenueMinor,
      costMinor: totals.costMinor + row.costMinor,
      marginMinor: totals.marginMinor + row.marginMinor,
      merchantCount: totals.merchantCount + 1,
    }),
    { revenueMinor: 0, costMinor: 0, marginMinor: 0, merchantCount: 0 },
  );
}
