import type { Database } from "~/lib/db/types";
import type { EpayMerchantClient } from "~/lib/epay";
import { recordAudit } from "~/lib/audit";
import { markPaid } from "./invoice";

/**
 * Collecting what merchants owe Betal.
 *
 * Two paths, chosen per merchant:
 *
 *   'auto'   — charged to a stored card through ePay, with Betal acting as its own
 *              merchant. Betal is a payments company; collecting its own fees through
 *              its own platform is both the obvious dogfood and the fastest way to
 *              find problems before a client does.
 *   'manual' — an emailed invoice settled by bank transfer, reconciled by hand.
 *              Larger clients tend to want this.
 *
 * A note on why this uses MIT rather than ePay's billing agreements. Billing plans
 * carry a **fixed** amount, so they model a subscription at a set price. A Betal
 * invoice varies every month with the merchant's volume, which a fixed plan cannot
 * express. ePay's own guidance covers this case: if you trigger each charge yourself,
 * you need neither a billing plan nor an agreement — just a subscription and an MIT
 * call carrying the amount. So each merchant on auto-collect has one UNSCHEDULED
 * subscription, established by a card-on-file consent flow at onboarding, and each
 * month's invoice is a single MIT against it.
 */

export class CollectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionError";
  }
}

export interface CollectionResult {
  collected: boolean;
  /** ePay transaction id, when a charge was started. */
  transactionId?: string;
  reason?: string;
}

/**
 * Charges an issued invoice to the merchant's stored card.
 *
 * MIT is asynchronous — ePay is explicit that it "cannot run in real time" — so a
 * successful return here means the charge was accepted for processing, not that it
 * succeeded. The invoice is only marked paid when the notification webhook confirms
 * it, which is handled by `applyChargeOutcome`.
 */
export async function collectInvoice(
  db: Database,
  client: EpayMerchantClient,
  invoiceId: string,
  options: { notificationUrl: string; actorEmail?: string },
): Promise<CollectionResult> {
  const invoice = await db
    .prepare(
      `SELECT i.id, i.merchant_id, i.number, i.state, i.gross_minor, i.currency,
              i.collection_method, m.billing_subscription_id
         FROM invoice i
         JOIN merchant m ON m.id = i.merchant_id
        WHERE i.id = ?1`,
    )
    .bind(invoiceId)
    .first<{
      id: string;
      merchant_id: string;
      number: string | null;
      state: string;
      gross_minor: number;
      currency: string;
      collection_method: string;
      billing_subscription_id: string | null;
    }>();

  if (!invoice) throw new CollectionError(`Unknown invoice ${invoiceId}`);

  if (invoice.state !== "issued" && invoice.state !== "overdue") {
    return { collected: false, reason: `Invoice is ${invoice.state}` };
  }
  if (invoice.collection_method !== "auto") {
    return { collected: false, reason: "Merchant settles by bank transfer" };
  }
  if (!invoice.billing_subscription_id) {
    // Onboarding did not complete the card-on-file consent.
    return { collected: false, reason: "No stored payment method for this merchant" };
  }

  // Keyed on the invoice so a retried collection run cannot double-charge. ePay caches
  // the response for 24 hours and flags the replay.
  const idempotencyKey = `invoice-collect:${invoiceId}`;

  const { transaction } = await client.mitAuthorization(
    {
      subscriptionId: invoice.billing_subscription_id,
      amount: invoice.gross_minor,
      currency: invoice.currency,
      reference: invoice.number ?? invoiceId,
      notificationUrl: options.notificationUrl,
      // Capture immediately: this is a debt already incurred, not a reservation.
      instantCapture: "NO_VOID",
      textOnStatement: "BETAL",
    },
    idempotencyKey,
  );

  await db
    .prepare(`UPDATE invoice SET billing_charge_id = ?2 WHERE id = ?1`)
    .bind(invoiceId, transaction.id)
    .run();

  await recordAudit(db, {
    actorEmail: options.actorEmail ?? "system",
    merchantId: invoice.merchant_id,
    action: "issue_invoice",
    subjectType: "invoice",
    subjectId: invoiceId,
    amountMinor: invoice.gross_minor,
    currency: invoice.currency,
    detail: { collection: "auto", transactionId: transaction.id },
  });

  return { collected: true, transactionId: transaction.id };
}

/**
 * Applies the outcome of a collection charge once ePay reports it.
 *
 * Called from webhook projection. A success marks the invoice paid; a failure starts
 * or advances dunning.
 */
export async function applyChargeOutcome(
  db: Database,
  transactionId: string,
  outcome: "SUCCESS" | "FAILED",
  errorCode: string | null,
  now: () => number = () => Date.now(),
): Promise<void> {
  const invoice = await db
    .prepare(
      `SELECT id, merchant_id, gross_minor, currency FROM invoice
        WHERE billing_charge_id = ?1`,
    )
    .bind(transactionId)
    .first<{ id: string; merchant_id: string; gross_minor: number; currency: string }>();

  if (!invoice) return;

  if (outcome === "SUCCESS") {
    await markPaid(db, invoice.id, now);
    await recordAudit(
      db,
      {
        actorEmail: "system",
        merchantId: invoice.merchant_id,
        action: "issue_invoice",
        subjectType: "invoice",
        subjectId: invoice.id,
        amountMinor: invoice.gross_minor,
        currency: invoice.currency,
        detail: { collection: "auto", result: "paid" },
      },
      now,
    );
    return;
  }

  await recordDunningAttempt(db, invoice.id, errorCode, now);
}

export interface DunningState {
  invoiceId: string;
  attempts: number;
  lastErrorCode: string | null;
  nextAttemptAtMs: number | null;
  exhausted: boolean;
}

/** Retry schedule in days. Deliberately slow — the aim is to get paid, not to hammer
 * a card that has already declined. After the last one a human takes over. */
const DUNNING_SCHEDULE_DAYS = [3, 7, 14];

export async function recordDunningAttempt(
  db: Database,
  invoiceId: string,
  errorCode: string | null,
  now: () => number = () => Date.now(),
): Promise<DunningState> {
  const existing = await db
    .prepare(
      `SELECT COUNT(*) AS attempts FROM audit_log
        WHERE subject_type = 'invoice' AND subject_id = ?1
          AND action = 'issue_invoice' AND outcome = 'failure'`,
    )
    .bind(invoiceId)
    .first<{ attempts: number }>();

  const attempts = (existing?.attempts ?? 0) + 1;

  await recordAudit(
    db,
    {
      actorEmail: "system",
      action: "issue_invoice",
      subjectType: "invoice",
      subjectId: invoiceId,
      outcome: "failure",
      detail: { errorCode, attempt: attempts },
    },
    now,
  );

  const nextDelay = DUNNING_SCHEDULE_DAYS[attempts - 1];
  const exhausted = nextDelay === undefined;

  return {
    invoiceId,
    attempts,
    lastErrorCode: errorCode,
    nextAttemptAtMs: exhausted ? null : now() + nextDelay * 86_400_000,
    exhausted,
  };
}

/**
 * Invoices due for a collection attempt.
 *
 * Covers both the first attempt on a freshly issued invoice and a scheduled retry
 * after a decline. Exhausted invoices are excluded: once the schedule is spent, a
 * person should be calling the merchant rather than the system retrying forever.
 */
export async function invoicesDueForCollection(
  db: Database,
  now: () => number = () => Date.now(),
): Promise<Array<{ id: string; merchant_id: string; attempts: number }>> {
  const result = await db
    .prepare(
      `SELECT i.id, i.merchant_id,
              (SELECT COUNT(*) FROM audit_log a
                WHERE a.subject_type = 'invoice' AND a.subject_id = i.id
                  AND a.action = 'issue_invoice' AND a.outcome = 'failure') AS attempts
         FROM invoice i
         JOIN merchant m ON m.id = i.merchant_id
        WHERE i.state IN ('issued', 'overdue')
          AND i.collection_method = 'auto'
          AND m.billing_subscription_id IS NOT NULL
          AND i.issued_at <= ?1
        ORDER BY i.issued_at ASC`,
    )
    .bind(new Date(now()).toISOString())
    .all<{ id: string; merchant_id: string; attempts: number }>();

  return result.results.filter((row) => row.attempts < DUNNING_SCHEDULE_DAYS.length);
}

/**
 * Reconciles a bank transfer against an outstanding invoice.
 *
 * The manual path. Matching is by invoice number and exact amount rather than fuzzy
 * matching, because a wrong automatic match on money is worse than no match at all —
 * anything ambiguous is left for a person.
 */
export async function reconcileBankTransfer(
  db: Database,
  input: { reference: string; amountMinor: number; actorEmail: string },
  now: () => number = () => Date.now(),
): Promise<{ matched: boolean; invoiceId?: string; reason?: string }> {
  const candidates = await db
    .prepare(
      `SELECT id, merchant_id, gross_minor, currency FROM invoice
        WHERE number = ?1 AND state IN ('issued', 'overdue')`,
    )
    .bind(input.reference.trim())
    .all<{ id: string; merchant_id: string; gross_minor: number; currency: string }>();

  if (candidates.results.length === 0) {
    return { matched: false, reason: "No outstanding invoice with that number" };
  }
  if (candidates.results.length > 1) {
    return { matched: false, reason: "Reference matches more than one invoice" };
  }

  const invoice = candidates.results[0]!;
  if (invoice.gross_minor !== input.amountMinor) {
    // A part payment or an overpayment needs a decision, not a guess.
    return {
      matched: false,
      invoiceId: invoice.id,
      reason: `Amount differs: invoice is ${invoice.gross_minor}, received ${input.amountMinor}`,
    };
  }

  await markPaid(db, invoice.id, now);
  await recordAudit(
    db,
    {
      actorEmail: input.actorEmail,
      merchantId: invoice.merchant_id,
      action: "issue_invoice",
      subjectType: "invoice",
      subjectId: invoice.id,
      amountMinor: input.amountMinor,
      currency: invoice.currency,
      detail: { collection: "bank_transfer" },
    },
    now,
  );

  return { matched: true, invoiceId: invoice.id };
}
