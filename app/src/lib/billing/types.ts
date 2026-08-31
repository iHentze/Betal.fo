/**
 * Pricing and billing domain types.
 *
 * Pricing is fully negotiable per client, so a plan is an ordered list of rules rather
 * than a fixed set of fee columns. Rules are evaluated in order and each produces at
 * most one invoice line; later rules can see what earlier ones produced, which is what
 * makes minimums and tiers expressible.
 */

export type PeriodState =
  | "open"
  | "frozen"
  | "reconciling"
  | "discrepancy"
  | "reconciled"
  | "rated"
  | "issued";

export type InvoiceState =
  | "draft"
  | "approved"
  | "issued"
  | "paid"
  | "overdue"
  | "credited"
  | "void";

export type UserRole = "owner" | "admin" | "operator" | "viewer";

export type RuleKind =
  | "per_transaction"
  | "percentage"
  | "monthly_fixed"
  | "per_point_of_sale"
  | "per_terminal"
  | "tiered_per_transaction"
  | "minimum"
  | "manual_adjustment";

/** A fixed fee for every billable transaction. The standard Betal rule. */
export interface PerTransactionParams {
  amountMinor: number;
}

/** A share of processed volume, in basis points: 175 is 1,75%. */
export interface PercentageParams {
  basisPoints: number;
}

/** A flat monthly platform or gateway fee. */
export interface MonthlyFixedParams {
  amountMinor: number;
}

export interface PerUnitParams {
  amountMinor: number;
  /** Ignore the first N units, e.g. the first point of sale included in the plan. */
  includedUnits?: number;
}

/**
 * Volume bands. Each band prices the transactions that fall inside it, so a merchant
 * crossing a threshold does not have their whole volume repriced.
 */
export interface TieredParams {
  bands: Array<{
    /** Upper bound of this band, inclusive. Omit on the last band for "and above". */
    upTo?: number;
    amountMinor: number;
  }>;
}

/** Tops the invoice up to a floor if everything before it came to less. */
export interface MinimumParams {
  amountMinor: number;
}

export interface ManualAdjustmentParams {
  amountMinor: number;
  reason?: string;
}

export type RuleParams =
  | PerTransactionParams
  | PercentageParams
  | MonthlyFixedParams
  | PerUnitParams
  | TieredParams
  | MinimumParams
  | ManualAdjustmentParams;

export interface PriceRule {
  id: string;
  position: number;
  kind: RuleKind;
  label: string;
  params: RuleParams;
}

export interface PricePlan {
  id: string;
  merchantId: string | null;
  name: string;
  version: number;
  currency: string;
  /**
   * Which transactions count. Stored rather than hardcoded because "count the
   * transactions" is ambiguous, and the ambiguity becomes a dispute months later.
   */
  billableStates: string[];
  billableTypes: string[];
  billRefunds: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  rules: PriceRule[];
}

/** What ePay charges Betal. Recorded by hand: no ePay endpoint reports it. */
export interface CostPlan {
  id: string;
  merchantId: string;
  version: number;
  perTransactionMinor: number;
  monthlyFixedMinor: number;
  percentageBasisPoints: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** A transaction as the rating engine sees it: the frozen, reconciled input. */
export interface BillableTransaction {
  id: string;
  state: string;
  type: string;
  amount: number;
  currency: string;
  createdAtMs: number;
  pointOfSaleId: string | null;
}

export interface RatedLine {
  ruleId: string | null;
  kind: RuleKind | "vat";
  description: string;
  quantity: number;
  unitMinor: number;
  amountMinor: number;
  basisPoints?: number;
  /** The transaction ids behind this line, so any figure can be explained. */
  inputs: Array<{ transactionId: string; amountMinor?: number }>;
}

export interface RatingResult {
  lines: RatedLine[];
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  vatRateBasisPoints: number;
  /** Count of transactions the plan deemed billable. */
  billableCount: number;
  /** Total processed volume across billable transactions, in minor units. */
  volumeMinor: number;
}

export interface PeriodContext {
  merchantId: string;
  year: number;
  month: number;
  startsAtMs: number;
  endsAtMs: number;
  /** Counts used by per-unit rules. */
  pointOfSaleCount: number;
  terminalCount: number;
}
