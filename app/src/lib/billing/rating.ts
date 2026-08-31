import { addVat, applyBasisPoints, MVG_RATE_BASIS_POINTS } from "~/lib/money";
import type {
  BillableTransaction,
  ManualAdjustmentParams,
  MinimumParams,
  MonthlyFixedParams,
  PercentageParams,
  PerTransactionParams,
  PerUnitParams,
  PeriodContext,
  PricePlan,
  PriceRule,
  RatedLine,
  RatingResult,
  TieredParams,
} from "./types";

/**
 * The rating engine: a price plan plus a frozen set of transactions produces invoice
 * lines.
 *
 * Two properties matter more than anything else here.
 *
 * It is **deterministic**. Nothing reads the clock, nothing reads a random source,
 * and all arithmetic is integer minor units through the money module. The same plan
 * version against the same snapshot must produce a byte-identical invoice, because an
 * invoice gets regenerated whenever a client disputes it and the second answer had
 * better match the first.
 *
 * It **records its inputs**. Every line carries the transaction ids that produced it.
 * Storing only totals means the question "why is this 1.247 kr?" has no answer, and
 * that is exactly the question that gets asked.
 */

export class RatingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatingError";
  }
}

/** Whether a transaction is billable under this plan. */
export function isBillable(
  plan: Pick<PricePlan, "billableStates" | "billableTypes">,
  transaction: BillableTransaction,
): boolean {
  return (
    plan.billableStates.includes(transaction.state) &&
    plan.billableTypes.includes(transaction.type)
  );
}

function evaluateRule(
  rule: PriceRule,
  billable: BillableTransaction[],
  context: PeriodContext,
  linesSoFar: RatedLine[],
): RatedLine | null {
  const count = billable.length;
  const volume = billable.reduce((sum, t) => sum + t.amount, 0);

  switch (rule.kind) {
    case "per_transaction": {
      const { amountMinor } = rule.params as PerTransactionParams;
      if (count === 0) return null;
      return {
        ruleId: rule.id,
        kind: rule.kind,
        description: rule.label,
        quantity: count,
        unitMinor: amountMinor,
        amountMinor: amountMinor * count,
        inputs: billable.map((t) => ({ transactionId: t.id, amountMinor })),
      };
    }

    case "percentage": {
      const { basisPoints } = rule.params as PercentageParams;
      if (count === 0) return null;
      // Charged per transaction and summed, not applied to the aggregate. Rounding
      // the total instead would make a line unexplainable at the transaction level,
      // and the per-transaction figures are what a client checks against.
      const inputs = billable.map((t) => ({
        transactionId: t.id,
        amountMinor: applyBasisPoints(t.amount, basisPoints),
      }));
      const amountMinor = inputs.reduce((sum, i) => sum + (i.amountMinor ?? 0), 0);
      return {
        ruleId: rule.id,
        kind: rule.kind,
        description: rule.label,
        quantity: count,
        unitMinor: 0,
        amountMinor,
        basisPoints,
        inputs,
      };
    }

    case "monthly_fixed": {
      const { amountMinor } = rule.params as MonthlyFixedParams;
      return {
        ruleId: rule.id,
        kind: rule.kind,
        description: rule.label,
        quantity: 1,
        unitMinor: amountMinor,
        amountMinor,
        inputs: [],
      };
    }

    case "per_point_of_sale":
    case "per_terminal": {
      const { amountMinor, includedUnits = 0 } = rule.params as PerUnitParams;
      const units =
        rule.kind === "per_point_of_sale"
          ? context.pointOfSaleCount
          : context.terminalCount;
      const chargeable = Math.max(units - includedUnits, 0);
      if (chargeable === 0) return null;
      return {
        ruleId: rule.id,
        kind: rule.kind,
        description: rule.label,
        quantity: chargeable,
        unitMinor: amountMinor,
        amountMinor: amountMinor * chargeable,
        inputs: [],
      };
    }

    case "tiered_per_transaction": {
      const { bands } = rule.params as TieredParams;
      if (count === 0) return null;
      if (bands.length === 0) throw new RatingError(`Rule ${rule.id} has no bands`);

      // Each band prices the transactions falling inside it, so crossing a threshold
      // does not reprice everything below it.
      let remaining = count;
      let consumed = 0;
      let amountMinor = 0;

      for (const band of bands) {
        if (remaining <= 0) break;
        const capacity =
          band.upTo === undefined ? remaining : Math.max(band.upTo - consumed, 0);
        const inBand = Math.min(remaining, capacity);
        amountMinor += inBand * band.amountMinor;
        consumed += inBand;
        remaining -= inBand;
      }

      if (remaining > 0) {
        // No open-ended band: the last one caps the plan, which is a configuration
        // error rather than something to silently absorb.
        throw new RatingError(
          `Rule ${rule.id} has no band covering transaction ${consumed + 1}`,
        );
      }

      return {
        ruleId: rule.id,
        kind: rule.kind,
        description: rule.label,
        quantity: count,
        unitMinor: 0,
        amountMinor,
        inputs: billable.map((t) => ({ transactionId: t.id })),
      };
    }

    case "minimum": {
      const { amountMinor } = rule.params as MinimumParams;
      const subtotal = linesSoFar.reduce((sum, line) => sum + line.amountMinor, 0);
      const shortfall = amountMinor - subtotal;
      if (shortfall <= 0) return null;
      return {
        ruleId: rule.id,
        kind: rule.kind,
        description: rule.label,
        quantity: 1,
        unitMinor: shortfall,
        amountMinor: shortfall,
        inputs: [],
      };
    }

    case "manual_adjustment": {
      const { amountMinor } = rule.params as ManualAdjustmentParams;
      if (amountMinor === 0) return null;
      return {
        ruleId: rule.id,
        kind: rule.kind,
        description: rule.label,
        quantity: 1,
        unitMinor: amountMinor,
        amountMinor,
        inputs: [],
      };
    }

    default:
      throw new RatingError(`Unknown price rule kind: ${rule.kind}`);
  }
}

/**
 * Rates a period.
 *
 * `transactions` must be the frozen, reconciled set from the close. Rules run in
 * their stored order, and a rule that produces nothing (a minimum already met, a
 * per-terminal charge for a merchant with none) yields no line rather than a zero one,
 * so the invoice shows only what was actually charged.
 */
export function ratePeriod(
  plan: PricePlan,
  transactions: BillableTransaction[],
  context: PeriodContext,
  vatRateBasisPoints = MVG_RATE_BASIS_POINTS,
): RatingResult {
  const billable = transactions.filter((t) => isBillable(plan, t));
  const volumeMinor = billable.reduce((sum, t) => sum + t.amount, 0);

  const rules = [...plan.rules].sort((a, b) => a.position - b.position);
  const lines: RatedLine[] = [];

  for (const rule of rules) {
    const line = evaluateRule(rule, billable, context, lines);
    if (line) lines.push(line);
  }

  const netMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const { vat, gross } = addVat(netMinor, vatRateBasisPoints);

  return {
    lines,
    netMinor,
    vatMinor: vat,
    grossMinor: gross,
    vatRateBasisPoints,
    billableCount: billable.length,
    volumeMinor,
  };
}

/**
 * A stable fingerprint of a rating result.
 *
 * Used to prove a regenerated invoice matches the one already issued. If these differ,
 * something that should have been immutable has changed and the discrepancy needs
 * investigating before anything is sent to a client.
 */
export function ratingFingerprint(result: RatingResult): string {
  const canonical = result.lines
    .map((line) =>
      [
        line.ruleId ?? "",
        line.kind,
        line.quantity,
        line.unitMinor,
        line.amountMinor,
        line.basisPoints ?? "",
        line.inputs.map((i) => i.transactionId).join(","),
      ].join("|"),
    )
    .join("\n");

  return `${canonical}\n=${result.netMinor}|${result.vatMinor}|${result.grossMinor}`;
}

/** Parses a stored plan row into the shape the engine expects. */
export function parsePricePlan(
  row: {
    id: string;
    merchant_id: string | null;
    name: string;
    version: number;
    currency: string;
    billable_states: string;
    billable_types: string;
    bill_refunds: number;
    effective_from: string;
    effective_to: string | null;
  },
  ruleRows: Array<{
    id: string;
    position: number;
    kind: string;
    label: string;
    params: string;
  }>,
): PricePlan {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    version: row.version,
    currency: row.currency,
    billableStates: JSON.parse(row.billable_states) as string[],
    billableTypes: JSON.parse(row.billable_types) as string[],
    billRefunds: row.bill_refunds === 1,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    rules: ruleRows.map((rule) => ({
      id: rule.id,
      position: rule.position,
      kind: rule.kind as PriceRule["kind"],
      label: rule.label,
      params: JSON.parse(rule.params) as PriceRule["params"],
    })),
  };
}
