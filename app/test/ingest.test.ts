import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  drainPendingDeliveries,
  processDelivery,
  receiveWebhook,
  recordWebhookHealth,
} from "~/lib/ingest/handler";
import { deliveryFingerprint, generateWebhookSecret, secretsMatch } from "~/lib/ingest/verify";
import type { EventWebhook, NotificationWebhook, Transaction } from "~/lib/epay";
import {
  freshDatabase,
  seedMerchant,
  seedPointOfSale,
  type TestDatabase,
} from "./helpers/sqlite";

const SECRET = "Bearer secret-token";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "T1",
    subscriptionId: null,
    billingAgreementChargeId: null,
    state: "SUCCESS",
    errorCode: null,
    externalStatusCodes: null,
    createdAt: "2026-08-15T12:00:00Z",
    sessionId: "S1",
    paymentMethodId: "pm1",
    paymentMethodType: "CARD",
    paymentMethodSubType: "Visa",
    paymentMethodExpiry: "2030-05-31",
    paymentMethodDisplayText: "40000000XXXX0003",
    paymentMethodHolderName: null,
    scaMode: "NORMAL",
    customerId: "cust-1",
    amount: 24_950,
    fee: 0,
    currency: "DKK",
    instantCapture: "OFF",
    notificationUrl: "https://app.betal.fo/api/hooks/m1",
    pointOfSaleId: "pos1",
    reference: "ordur-1001",
    textOnStatement: "BETAL",
    exemptions: [],
    attributes: {},
    clientIp: "1.2.3.4",
    clientCountry: "FO",
    type: "PAYMENT",
    ...overrides,
  };
}

/** A notification delivery, the only shape that carries card and SCA detail. */
function notification(overrides: Partial<NotificationWebhook> = {}): NotificationWebhook {
  return {
    transaction: transaction(),
    aggregates: {
      authorized: 24_950,
      captured: 0,
      refunded: 0,
      voided: 0,
      remaining: 24_950,
      paidOut: 0,
    },
    operations: [
      {
        id: "op-auth",
        referenceTransactionOperationId: null,
        amount: 24_950,
        state: "SUCCESS",
        transactionId: "T1",
        type: "AUTHORIZATION",
        errorCode: null,
        createdAt: "2026-08-15T12:00:01Z",
        finalizedAt: "2026-08-15T12:00:02Z",
      },
    ],
    acquirerAgreement: { acquirer: "clearhaus", mcc: "5814" },
    card: {
      pan: "40000000XXXX0003",
      expireMonth: "05",
      expireYear: "30",
      par: "PAR-ABC-123",
      Issuer: "Betri Banki",
      Scheme: "Visa",
      Country: "FO",
      Segment: "consumer",
      Funding: "debit",
    },
    sca: { rejected: false, type: "3DS", verification: "FRICTIONLESS" },
    ...overrides,
  };
}

describe("webhook secret verification", () => {
  it("accepts the exact header value including the scheme", async () => {
    expect(await secretsMatch(SECRET, SECRET)).toBe(true);
  });

  it("rejects a mismatch, a missing header and a scheme-only difference", async () => {
    expect(await secretsMatch("Bearer wrong", SECRET)).toBe(false);
    expect(await secretsMatch(null, SECRET)).toBe(false);
    expect(await secretsMatch(SECRET, null)).toBe(false);
    // ePay warns the scheme is not always Bearer, so the whole value must match.
    expect(await secretsMatch("Basic secret-token", SECRET)).toBe(false);
  });

  it("does not accept a prefix of the real secret", async () => {
    expect(await secretsMatch("Bearer secret", SECRET)).toBe(false);
  });

  it("generates a distinct secret per call", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).not.toBe(b);
    expect(a.startsWith("Bearer ")).toBe(true);
  });

  it("fingerprints identical payloads identically and differing ones differently", async () => {
    const one = await deliveryFingerprint("m1", '{"a":1}');
    const same = await deliveryFingerprint("m1", '{"a":1}');
    const otherBody = await deliveryFingerprint("m1", '{"a":2}');
    const otherMerchant = await deliveryFingerprint("m2", '{"a":1}');

    expect(one).toBe(same);
    expect(one).not.toBe(otherBody);
    expect(one).not.toBe(otherMerchant);
  });
});

describe("receiveWebhook", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db);
    seedPointOfSale(db, "m1", "pos1", SECRET);
  });

  it("rejects a delivery with the wrong secret and stores nothing", async () => {
    const result = await receiveWebhook(
      { db },
      "m1",
      "Bearer nope",
      JSON.stringify(notification()),
      "notification",
    );

    expect(result.status).toBe(401);
    expect(db.query("SELECT * FROM webhook_delivery")).toHaveLength(0);
  });

  it("accepts a valid delivery and stores the raw body", async () => {
    const body = JSON.stringify(notification());
    const result = await receiveWebhook({ db }, "m1", SECRET, body, "notification");

    expect(result.status).toBe(200);
    const rows = db.query<{ payload: string; processed_at_ms: number | null }>(
      "SELECT payload, processed_at_ms FROM webhook_delivery",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toBe(body);
    // Stored but not yet projected: acknowledgement must not wait for processing.
    expect(rows[0]!.processed_at_ms).toBeNull();
  });

  it("accepts a secret belonging to any of the merchant's points of sale", async () => {
    seedPointOfSale(db, "m1", "pos2", "Bearer second-secret");
    const result = await receiveWebhook(
      { db },
      "m1",
      "Bearer second-secret",
      JSON.stringify(notification()),
      "notification",
    );
    expect(result.status).toBe(200);
  });

  it("collapses a redelivery instead of storing it twice", async () => {
    const body = JSON.stringify(notification());
    const first = await receiveWebhook({ db }, "m1", SECRET, body, "notification");
    const second = await receiveWebhook({ db }, "m1", SECRET, body, "notification");

    expect(first.status).toBe(200);
    expect(first.duplicate).toBeFalsy();
    // A retry means ePay did not believe our acknowledgement, so 200 again is right.
    expect(second.status).toBe(200);
    expect(second.duplicate).toBe(true);
    expect(db.query("SELECT * FROM webhook_delivery")).toHaveLength(1);
  });

  it("enqueues the delivery when a queue binding is present", async () => {
    const send = vi.fn(async () => {});
    const result = await receiveWebhook(
      { db, queue: { send } },
      "m1",
      SECRET,
      JSON.stringify(notification()),
      "notification",
    );

    expect(send).toHaveBeenCalledWith({ deliveryId: result.deliveryId });
  });

  it("still acknowledges when the queue send fails, leaving the row for the drain", async () => {
    const send = vi.fn(async () => {
      throw new Error("queue unavailable");
    });
    const result = await receiveWebhook(
      { db, queue: { send } },
      "m1",
      SECRET,
      JSON.stringify(notification()),
      "notification",
    );

    expect(result.status).toBe(200);
    expect(db.query("SELECT * FROM webhook_delivery WHERE processed_at_ms IS NULL"))
      .toHaveLength(1);
  });

  it("rejects a body that is not JSON", async () => {
    const result = await receiveWebhook({ db }, "m1", SECRET, "not json", "notification");
    expect(result.status).toBe(400);
  });

  it("rejects when the merchant has no configured secret", async () => {
    seedMerchant(db, "m2", "acct-2");
    const result = await receiveWebhook(
      { db },
      "m2",
      SECRET,
      JSON.stringify(notification()),
      "notification",
    );
    expect(result.status).toBe(401);
  });
});

describe("projection into the mirror", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db);
    seedPointOfSale(db, "m1", "pos1", SECRET);
  });

  async function deliver(
    body: unknown,
    channel: "notification" | "event" = "notification",
  ) {
    const received = await receiveWebhook(
      { db },
      "m1",
      SECRET,
      JSON.stringify(body),
      channel,
    );
    if (received.deliveryId) await processDelivery({ db }, received.deliveryId);
    return received;
  }

  it("writes the transaction, its card detail and its operations", async () => {
    await deliver(notification());

    const rows = db.query<Record<string, unknown>>("SELECT * FROM txn");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe("T1");
    expect(row.amount).toBe(24_950);
    expect(row.currency).toBe("DKK");
    expect(row.reference).toBe("ordur-1001");
    expect(row.acquirer).toBe("clearhaus");
    expect(row.card_par).toBe("PAR-ABC-123");
    expect(row.card_issuer).toBe("Betri Banki");
    expect(row.sca_verification).toBe("FRICTIONLESS");
    expect(row.sca_rejected).toBe(0);

    expect(db.query("SELECT * FROM operation")).toHaveLength(1);
  });

  it("stores ePay's surcharge separately from the amount", async () => {
    // Transaction.fee is a surcharge added to what the cardholder pays and is already
    // included in amount. It is not Betal revenue, so it lives in its own column.
    await deliver(
      notification({ transaction: transaction({ amount: 10_250, fee: 250 }) }),
    );

    const row = db.query<{ amount: number; surcharge: number }>(
      "SELECT amount, surcharge FROM txn",
    )[0]!;
    expect(row.amount).toBe(10_250);
    expect(row.surcharge).toBe(250);
  });

  it("is idempotent when the same delivery is projected twice", async () => {
    const body = notification();
    const received = await receiveWebhook(
      { db },
      "m1",
      SECRET,
      JSON.stringify(body),
      "notification",
    );
    await processDelivery({ db }, received.deliveryId!);
    await processDelivery({ db }, received.deliveryId!);

    expect(db.query("SELECT * FROM txn")).toHaveLength(1);
    expect(db.query("SELECT * FROM operation")).toHaveLength(1);
  });

  it("never blanks card detail when a later event lacks it", async () => {
    // This is the important one. Card and SCA data exist only on the notification
    // payload; no GET returns them. A subsequent capture event carries a bare
    // transaction, and must not regress what we already captured.
    await deliver(notification());

    const captured: EventWebhook = {
      event: "transaction.captured.v1",
      data: {
        transaction: transaction({ state: "SUCCESS" }),
        operation: {
          id: "op-capture",
          referenceTransactionOperationId: "op-auth",
          amount: 24_950,
          state: "SUCCESS",
          transactionId: "T1",
          type: "CAPTURE",
          errorCode: null,
          createdAt: "2026-08-16T09:00:00Z",
          finalizedAt: "2026-08-16T09:00:01Z",
        },
      },
    };
    await deliver(captured, "event");

    const row = db.query<Record<string, unknown>>("SELECT * FROM txn")[0]!;
    expect(row.card_par).toBe("PAR-ABC-123");
    expect(row.card_issuer).toBe("Betri Banki");
    expect(row.sca_type).toBe("3DS");
    // And the acquirer, which the event envelope also omits.
    expect(row.acquirer).toBe("clearhaus");
  });

  it("derives aggregates from operations when the event envelope omits them", async () => {
    await deliver(notification());
    await deliver(
      {
        event: "transaction.captured.v1",
        data: {
          operation: {
            id: "op-capture",
            referenceTransactionOperationId: "op-auth",
            amount: 20_000,
            state: "SUCCESS",
            transactionId: "T1",
            type: "CAPTURE",
            errorCode: null,
            createdAt: "2026-08-16T09:00:00Z",
            finalizedAt: "2026-08-16T09:00:01Z",
          },
        },
      } satisfies EventWebhook,
      "event",
    );

    const row = db.query<{ amount_captured: number }>(
      "SELECT amount_captured FROM txn",
    )[0]!;
    expect(row.amount_captured).toBe(20_000);
  });

  it("excludes failed operations from derived aggregates", async () => {
    await deliver(notification());
    await deliver(
      {
        event: "transaction.refunded.v1",
        data: {
          operation: {
            id: "op-refund-failed",
            referenceTransactionOperationId: "op-auth",
            amount: 5_000,
            state: "FAILED",
            transactionId: "T1",
            type: "REFUND",
            errorCode: "DECLINED_BY_ISSUER_OR_SCHEME",
            createdAt: "2026-08-17T09:00:00Z",
            finalizedAt: "2026-08-17T09:00:01Z",
          },
        },
      } satisfies EventWebhook,
      "event",
    );

    const row = db.query<{ amount_refunded: number }>(
      "SELECT amount_refunded FROM txn",
    )[0]!;
    expect(row.amount_refunded).toBe(0);
  });

  it("stores settlement amounts verbatim as decimal strings", async () => {
    await deliver(
      {
        event: "settlement.transfer-ready.v1",
        data: {
          settlementTransfer: {
            id: "st-1",
            acquirer: "clearhaus",
            settlementName: "settlement.csv",
            settlementIds: ["R01234"],
            postingDate: "2026-08-20",
            netAmount: "24671.05",
            currency: "DKK",
            acquirerReference: "acq-123",
            adjustments: [
              { type: "FEE", amount: "-12.50", description: "wire_fee" },
            ],
            adjustmentSums: [],
            createdAt: "2026-08-20T06:00:00Z",
          },
        },
      } satisfies EventWebhook,
      "event",
    );

    const transfer = db.query<{ net_amount: unknown }>(
      "SELECT net_amount FROM settlement_transfer",
    )[0]!;
    // Must remain the exact string ePay sent — never round-tripped through a float.
    expect(transfer.net_amount).toBe("24671.05");
    expect(typeof transfer.net_amount).toBe("string");

    const adjustment = db.query<{ amount: unknown; type: string; scope: string }>(
      "SELECT amount, type, scope FROM settlement_adjustment",
    )[0]!;
    expect(adjustment.amount).toBe("-12.50");
    expect(adjustment.type).toBe("FEE");
    expect(adjustment.scope).toBe("transfer");
  });

  it("marks the delivery processed so the drain does not repeat it", async () => {
    const received = await deliver(notification());
    const row = db.query<{ processed_at_ms: number | null; attempts: number }>(
      "SELECT processed_at_ms, attempts FROM webhook_delivery WHERE id = ?",
      received.deliveryId,
    )[0]!;
    expect(row.processed_at_ms).not.toBeNull();
    expect(row.attempts).toBe(1);
  });
});

describe("drainPendingDeliveries", () => {
  it("processes rows the queue never picked up", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    seedPointOfSale(db, "m1", "pos1", SECRET);

    // No queue binding, so nothing is dispatched at receive time.
    await receiveWebhook({ db }, "m1", SECRET, JSON.stringify(notification()), "notification");
    expect(db.query("SELECT * FROM txn")).toHaveLength(0);

    const result = await drainPendingDeliveries({ db });
    expect(result.processed).toBe(1);
    expect(db.query("SELECT * FROM txn")).toHaveLength(1);
  });
});

describe("recordWebhookHealth", () => {
  it("records a paused endpoint so the UI can surface it", async () => {
    const db = freshDatabase();
    seedMerchant(db);

    await recordWebhookHealth(db, "m1", [
      {
        id: "wh-1",
        url: "https://app.betal.fo/api/hooks/m1",
        events: ["transaction.success.v1"],
        pausedAt: "2026-08-20T00:00:00Z",
        pauseReason: "ERROR_RATE_TOO_HIGH",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);

    const row = db.query<{ paused_at: string; pause_reason: string }>(
      "SELECT paused_at, pause_reason FROM webhook_endpoint",
    )[0]!;
    expect(row.paused_at).toBe("2026-08-20T00:00:00Z");
    expect(row.pause_reason).toBe("ERROR_RATE_TOO_HIGH");
  });

  it("clears the paused state once ePay resumes delivery", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const webhook = {
      id: "wh-1",
      url: "https://app.betal.fo/api/hooks/m1",
      events: ["transaction.success.v1"],
      createdAt: "2026-01-01T00:00:00Z",
    };

    await recordWebhookHealth(db, "m1", [
      { ...webhook, pausedAt: "2026-08-20T00:00:00Z", pauseReason: "ERROR_RATE_TOO_HIGH" },
    ]);
    await recordWebhookHealth(db, "m1", [
      { ...webhook, pausedAt: null, pauseReason: null },
    ]);

    const row = db.query<{ paused_at: string | null }>(
      "SELECT paused_at FROM webhook_endpoint",
    )[0]!;
    expect(row.paused_at).toBeNull();
  });
});
