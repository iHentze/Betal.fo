/**
 * Semantic status mapping.
 *
 * Payments have far more states than a three-colour brand palette covers, so every
 * state in the product is mapped to a semantic token here and nowhere else. No
 * component chooses a status colour ad hoc, which keeps "failed" the same red on the
 * transaction list, the invoice screen and the close report.
 *
 * Two of these are operational rather than payment states, and both are things that
 * silently break the business if nobody notices: a webhook ePay has paused, and a
 * period whose reconciliation did not balance.
 */

export type StatusTone =
  | "success"
  | "pending"
  | "processing"
  | "failed"
  | "refunded"
  | "voided"
  | "expired"
  | "paused"
  | "discrepancy";

export interface StatusDescriptor {
  tone: StatusTone;
  /** Faroese label shown to merchants and staff. */
  label: string;
}

/** CSS custom property backing each tone, defined in styles/app.css. */
export const toneColor: Record<StatusTone, string> = {
  success: "var(--color-state-success)",
  pending: "var(--color-state-pending)",
  processing: "var(--color-state-processing)",
  failed: "var(--color-state-failed)",
  refunded: "var(--color-state-refunded)",
  voided: "var(--color-state-voided)",
  expired: "var(--color-state-expired)",
  paused: "var(--color-state-paused)",
  discrepancy: "var(--color-state-discrepancy)",
};

const transactionStates: Record<string, StatusDescriptor> = {
  SUCCESS: { tone: "success", label: "Góðkent" },
  PENDING: { tone: "pending", label: "Bíðar" },
  PROCESSING: { tone: "processing", label: "Verður viðgjørt" },
  FAILED: { tone: "failed", label: "Miseydnað" },
};

const operationTypes: Record<string, StatusDescriptor> = {
  AUTHORIZATION: { tone: "pending", label: "Góðkenning" },
  SALE: { tone: "success", label: "Sala" },
  CAPTURE: { tone: "success", label: "Tikið" },
  REFUND: { tone: "refunded", label: "Endurgoldið" },
  VOID: { tone: "voided", label: "Ógildað" },
  PAYOUT: { tone: "processing", label: "Útgjald" },
};

const subscriptionStates: Record<string, StatusDescriptor> = {
  ACTIVE: { tone: "success", label: "Virkin" },
  PENDING: { tone: "pending", label: "Bíðar" },
  INVALID: { tone: "failed", label: "Ógildug" },
  DISABLED: { tone: "voided", label: "Óvirkin" },
};

const periodStates: Record<string, StatusDescriptor> = {
  open: { tone: "processing", label: "Opið" },
  frozen: { tone: "pending", label: "Fryst" },
  reconciling: { tone: "processing", label: "Verður avstemt" },
  discrepancy: { tone: "discrepancy", label: "Ósamsvar" },
  reconciled: { tone: "success", label: "Avstemt" },
  rated: { tone: "success", label: "Roknað" },
  issued: { tone: "success", label: "Sent" },
};

const invoiceStates: Record<string, StatusDescriptor> = {
  draft: { tone: "pending", label: "Uppskot" },
  approved: { tone: "processing", label: "Góðkent" },
  issued: { tone: "success", label: "Sent" },
  paid: { tone: "success", label: "Goldið" },
  overdue: { tone: "failed", label: "Yvir tíð" },
  credited: { tone: "refunded", label: "Krediterað" },
  void: { tone: "voided", label: "Ógildað" },
};

const unknown: StatusDescriptor = { tone: "voided", label: "Ókent" };

export function transactionStatus(state: string): StatusDescriptor {
  return transactionStates[state] ?? unknown;
}

export function operationStatus(
  type: string,
  state: string,
): StatusDescriptor {
  const base = operationTypes[type] ?? unknown;
  // A failed operation reads as failed regardless of what it was trying to do.
  if (state === "FAILED") return { tone: "failed", label: base.label };
  if (state === "PROCESSING") return { tone: "processing", label: base.label };
  return base;
}

export function subscriptionStatus(state: string): StatusDescriptor {
  return subscriptionStates[state] ?? unknown;
}

export function periodStatus(state: string): StatusDescriptor {
  return periodStates[state] ?? unknown;
}

export function invoiceStatus(state: string): StatusDescriptor {
  return invoiceStates[state] ?? unknown;
}

/**
 * Describes what actually happened to a transaction's money.
 *
 * ePay's transaction state only says whether the authorization succeeded. Whether it
 * was captured, partly captured, refunded or voided lives in the operations, so the
 * list needs this derived view to be useful — a merchant asking "did I get paid?" is
 * not answered by SUCCESS.
 */
export function settlementStatus(row: {
  state: string;
  amount: number;
  amount_captured?: number | null;
  amount_refunded?: number | null;
  amount_voided?: number | null;
}): StatusDescriptor {
  if (row.state !== "SUCCESS") return transactionStatus(row.state);

  const captured = row.amount_captured ?? 0;
  const refunded = row.amount_refunded ?? 0;
  const voided = row.amount_voided ?? 0;

  if (refunded > 0) {
    return refunded >= captured && captured > 0
      ? { tone: "refunded", label: "Endurgoldið" }
      : { tone: "refunded", label: "Partvís endurgoldið" };
  }
  if (voided > 0 && captured === 0) {
    return { tone: "voided", label: "Ógildað" };
  }
  if (captured === 0) {
    return { tone: "pending", label: "Góðkent, ikki tikið" };
  }
  if (captured < row.amount) {
    return { tone: "success", label: "Partvís tikið" };
  }
  return { tone: "success", label: "Tikið" };
}

/** Operational alerts that must be impossible to miss. */
export function webhookStatus(pausedAt: string | null): StatusDescriptor {
  return pausedAt
    ? { tone: "paused", label: "Steðgað" }
    : { tone: "success", label: "Virkin" };
}
