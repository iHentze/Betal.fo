import { beforeEach, describe, expect, it, vi } from "vitest";
import { acquirerCosts, costFor, marginForPeriod, totalMargin } from "~/lib/billing/margin";
import {
  applyChargeOutcome,
  collectInvoice,
  invoicesDueForCollection,
  reconcileBankTransfer,
  recordDunningAttempt,
} from "~/lib/billing/collection";
import type { EpayMerchantClient } from "~/lib/epay";
import { freshDatabase, seedMerchant, type TestDatabase } from "./helpers/sqlite";

function seedPeriodWithInvoice(
  db: TestDatabase,
  options: {
    merchantId?: string;
    billableCount: number;
    volumeMinor: number;
    revenueNetMinor: number;
    state?: string;
    collection?: string;
  },
) {
  const merchantId = options.merchantId ?? "m1";
  db.raw
    .prepare(
      `INSERT INTO billing_period (id, merchant_id, year, month, state, starts_at_ms,
                                   ends_at_ms, billable_count, gross_minor,
                                   created_at, updated_at)
       VALUES (?, ?, 2026, 8, 'issued', 0, 1, ?, ?, '2026-09-01', '2026-09-01')`,
    )
    .run(`p-${merchantId}`, merchantId, options.billableCount, options.volumeMinor);

  // Realistic totals: net plus 25% MVG. Gross is what the merchant owes; net is what
  // Betal actually earns, since the VAT is collected on the Treasury's behalf.
  const vatMinor = Math.round(options.revenueNetMinor * 0.25);
  const grossMinor = options.revenueNetMinor + vatMinor;

  db.raw
    .prepare(
      `INSERT INTO invoice (id, merchant_id, billing_period_id, number, kind, state,
                            currency, net_minor, vat_minor, gross_minor,
                            collection_method, issued_at, due_at, created_at)
       VALUES (?, ?, ?, ?, 'invoice', ?, 'DKK', ?, ?, ?, ?, '2026-09-01T00:00:00Z',
               '2026-09-15T00:00:00Z', '2026-09-01')`,
    )
    .run(
      `i-${merchantId}`,
      merchantId,
      `p-${merchantId}`,
      `BETAL-2026-000${merchantId.slice(-1)}`,
      options.state ?? "issued",
      options.revenueNetMinor,
      vatMinor,
      grossMinor,
      options.collection ?? "manual",
    );

  return { netMinor: options.revenueNetMinor, vatMinor, grossMinor };
}

function seedCostPlan(
  db: TestDatabase,
  merchantId: string,
  perTransaction: number,
  monthly: number,
) {
  db.raw
    .prepare(
      `INSERT INTO cost_plan (id, merchant_id, version, per_transaction_minor,
                              monthly_fixed_minor, percentage_basis_points,
                              effective_from, created_at)
       VALUES (?, ?, 1, ?, ?, 0, '2020-01-01', '2020-01-01')`,
    )
    .run(`c-${merchantId}`, merchantId, perTransaction, monthly);
}

describe("costFor", () => {
  it("combines the fixed, per-transaction and percentage components", () => {
    expect(
      costFor(
        { perTransactionMinor: 20, monthlyFixedMinor: 50_00, percentageBasisPoints: 10 },
        100,
        1_000_00,
      ),
    ).toBe(50_00 + 100 * 20 + 100);
  });
});

describe("marginForPeriod", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db, "m1", "acct-1");
  });

  it("computes revenue minus the recorded ePay cost", async () => {
    // Revenue comes from the issued invoice; cost from the hand-recorded plan,
    // because ePay reports nothing about what it charges us.
    seedPeriodWithInvoice(db, {
      billableCount: 1000,
      volumeMinor: 500_000_00,
      revenueNetMinor: 500_00,
    });
    seedCostPlan(db, "m1", 20, 100_00);

    const rows = await marginForPeriod(db, 2026, 8);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.revenueMinor).toBe(500_00);
    expect(rows[0]!.costMinor).toBe(100_00 + 1000 * 20);
    expect(rows[0]!.marginMinor).toBe(500_00 - (100_00 + 1000 * 20));
  });

  it("uses the invoice net, so VAT is never counted as revenue", async () => {
    seedPeriodWithInvoice(db, {
      billableCount: 10,
      volumeMinor: 10_000,
      revenueNetMinor: 200_00,
    });
    seedCostPlan(db, "m1", 0, 0);

    const rows = await marginForPeriod(db, 2026, 8);
    // The invoice grosses 250,00 including MVG; only the 200,00 net is Betal's.
    expect(rows[0]!.revenueMinor).toBe(200_00);
  });

  it("reports a null ratio rather than dividing by zero", async () => {
    seedPeriodWithInvoice(db, {
      billableCount: 0,
      volumeMinor: 0,
      revenueNetMinor: 0,
    });
    seedCostPlan(db, "m1", 0, 0);

    const rows = await marginForPeriod(db, 2026, 8);
    expect(rows[0]!.marginBasisPoints).toBeNull();
  });

  it("treats a merchant with no cost plan as zero cost rather than failing", async () => {
    seedPeriodWithInvoice(db, {
      billableCount: 100,
      volumeMinor: 10_000,
      revenueNetMinor: 100_00,
    });

    const rows = await marginForPeriod(db, 2026, 8);
    expect(rows[0]!.costMinor).toBe(0);
    expect(rows[0]!.marginMinor).toBe(100_00);
  });

  it("totals across merchants", async () => {
    seedMerchant(db, "m2", "acct-2");
    seedPeriodWithInvoice(db, {
      billableCount: 100,
      volumeMinor: 10_000,
      revenueNetMinor: 100_00,
    });
    seedPeriodWithInvoice(db, {
      merchantId: "m2",
      billableCount: 50,
      volumeMinor: 5_000,
      revenueNetMinor: 60_00,
    });
    seedCostPlan(db, "m1", 10, 0);
    seedCostPlan(db, "m2", 10, 0);

    const totals = totalMargin(await marginForPeriod(db, 2026, 8));
    expect(totals.merchantCount).toBe(2);
    expect(totals.revenueMinor).toBe(160_00);
    expect(totals.costMinor).toBe(100 * 10 + 50 * 10);
  });
});

describe("acquirerCosts", () => {
  function seedSettlement(
    db: TestDatabase,
    acquirer: string,
    transferId: string,
    rows: Array<{ id: string; net: string; fees: Array<[string, string]> }>,
  ) {
    db.raw
      .prepare(
        `INSERT INTO settlement_transfer (id, merchant_id, acquirer, net_amount,
                                          currency, posting_date, created_at,
                                          created_at_ms)
         VALUES (?, 'm1', ?, '0.00', 'DKK', '2026-08-20', '2026-08-20', 1)`,
      )
      .run(transferId, acquirer);

    for (const row of rows) {
      db.raw
        .prepare(
          `INSERT INTO settlement_transaction (id, settlement_transfer_id, merchant_id,
                                               net_amount, currency, created_at)
           VALUES (?, ?, 'm1', ?, 'DKK', '2026-08-20')`,
        )
        .run(row.id, transferId, row.net);

      for (const [type, amount] of row.fees) {
        db.raw
          .prepare(
            `INSERT INTO settlement_adjustment (id, merchant_id,
                                                settlement_transfer_id,
                                                settlement_transaction_id, scope,
                                                type, amount)
             VALUES (?, 'm1', ?, ?, 'transaction', ?, ?)`,
          )
          .run(`${row.id}-${type}`, transferId, row.id, type, amount);
      }
    }
  }

  it("derives an effective rate per acquirer from settled data", async () => {
    const db = freshDatabase();
    seedMerchant(db);

    // 1000,00 settled, 20,00 in fees: 2%.
    seedSettlement(db, "clearhaus", "tr1", [
      {
        id: "s1",
        net: "1000.00",
        fees: [
          ["ACQUIRER_FEE", "-12.00"],
          ["INTERCHANGE_FEE", "-5.00"],
          ["SCHEME_FEE", "-3.00"],
        ],
      },
    ]);

    const costs = await acquirerCosts(db);
    expect(costs).toHaveLength(1);
    expect(costs[0]!.acquirer).toBe("clearhaus");
    expect(costs[0]!.volume).toBe("1000.00");
    expect(costs[0]!.fees).toBe("-20.00");
    expect(costs[0]!.effectiveBasisPoints).toBe(200);
    expect(costs[0]!.breakdown.INTERCHANGE_FEE).toBe("-5.00");
  });

  it("does not multiply volume by the number of fee rows", async () => {
    // The join fans out one row per adjustment; volume must still be counted once.
    const db = freshDatabase();
    seedMerchant(db);
    seedSettlement(db, "shift4", "tr1", [
      {
        id: "s1",
        net: "100.00",
        fees: [
          ["ACQUIRER_FEE", "-1.00"],
          ["SCHEME_FEE", "-1.00"],
        ],
      },
    ]);

    const costs = await acquirerCosts(db);
    expect(costs[0]!.volume).toBe("100.00");
    expect(costs[0]!.transactionCount).toBe(1);
  });

  it("ranks acquirers cheapest first, which is the point of the report", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    seedSettlement(db, "expensive", "tr1", [
      { id: "s1", net: "1000.00", fees: [["ACQUIRER_FEE", "-30.00"]] },
    ]);
    seedSettlement(db, "cheap", "tr2", [
      { id: "s2", net: "1000.00", fees: [["ACQUIRER_FEE", "-10.00"]] },
    ]);

    const costs = await acquirerCosts(db);
    expect(costs.map((c) => c.acquirer)).toEqual(["cheap", "expensive"]);
    expect(costs[0]!.effectiveBasisPoints).toBe(100);
    expect(costs[1]!.effectiveBasisPoints).toBe(300);
  });
});

describe("automatic collection", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db);
    db.raw
      .prepare(
        `UPDATE merchant SET collection_method = 'auto',
                billing_subscription_id = 'sub-1' WHERE id = 'm1'`,
      )
      .run();
    seedPeriodWithInvoice(db, {
      billableCount: 100,
      volumeMinor: 10_000,
      revenueNetMinor: 200_00,
      collection: "auto",
    });
  });

  function client() {
    const mitAuthorization = vi.fn(async () => ({
      transaction: { id: "TX-1" } as never,
    }));
    return {
      client: { mitAuthorization } as unknown as EpayMerchantClient,
      mitAuthorization,
    };
  }

  it("charges the stored subscription for the invoice total", async () => {
    const { client: c, mitAuthorization } = client();

    const result = await collectInvoice(db, c, "i-m1", {
      notificationUrl: "https://app.betal.fo/api/hooks/betal",
    });

    expect(result.collected).toBe(true);
    const request = mitAuthorization.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.subscriptionId).toBe("sub-1");
    // The gross total including MVG, since that is what the merchant owes.
    expect(request.amount).toBe(250_00);
    expect(request.instantCapture).toBe("NO_VOID");
  });

  it("keys idempotency on the invoice so a retried run cannot double-charge", async () => {
    const { client: c, mitAuthorization } = client();
    await collectInvoice(db, c, "i-m1", { notificationUrl: "https://x" });
    expect(mitAuthorization.mock.calls[0]![1]).toBe("invoice-collect:i-m1");
  });

  it("does not charge a merchant who settles by bank transfer", async () => {
    db.raw.prepare("UPDATE invoice SET collection_method = 'manual'").run();
    const { client: c, mitAuthorization } = client();

    const result = await collectInvoice(db, c, "i-m1", { notificationUrl: "https://x" });
    expect(result.collected).toBe(false);
    expect(mitAuthorization).not.toHaveBeenCalled();
  });

  it("does not charge an invoice that is already paid", async () => {
    db.raw.prepare("UPDATE invoice SET state = 'paid'").run();
    const { client: c, mitAuthorization } = client();

    const result = await collectInvoice(db, c, "i-m1", { notificationUrl: "https://x" });
    expect(result.collected).toBe(false);
    expect(mitAuthorization).not.toHaveBeenCalled();
  });

  it("does not mark the invoice paid until the webhook confirms it", async () => {
    // MIT is asynchronous; acceptance is not payment.
    const { client: c } = client();
    await collectInvoice(db, c, "i-m1", { notificationUrl: "https://x" });

    expect(db.query<{ state: string }>("SELECT state FROM invoice")[0]!.state).toBe(
      "issued",
    );

    await applyChargeOutcome(db, "TX-1", "SUCCESS", null);
    expect(db.query<{ state: string }>("SELECT state FROM invoice")[0]!.state).toBe(
      "paid",
    );
  });

  it("starts dunning when the charge declines", async () => {
    const { client: c } = client();
    await collectInvoice(db, c, "i-m1", { notificationUrl: "https://x" });
    await applyChargeOutcome(db, "TX-1", "FAILED", "INSUFFICIENT_FUNDS");

    expect(db.query<{ state: string }>("SELECT state FROM invoice")[0]!.state).toBe(
      "issued",
    );
    const failures = db.query(
      "SELECT * FROM audit_log WHERE outcome = 'failure'",
    );
    expect(failures).toHaveLength(1);
  });

  it("stops retrying once the schedule is spent", async () => {
    for (let i = 0; i < 3; i += 1) {
      await recordDunningAttempt(db, "i-m1", "INSUFFICIENT_FUNDS");
    }
    const final = await recordDunningAttempt(db, "i-m1", "INSUFFICIENT_FUNDS");
    expect(final.exhausted).toBe(true);
    expect(final.nextAttemptAtMs).toBeNull();

    // And it drops out of the queue, so a person takes over.
    expect(await invoicesDueForCollection(db)).toHaveLength(0);
  });
});

describe("bank transfer reconciliation", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db);
    seedPeriodWithInvoice(db, {
      billableCount: 10,
      volumeMinor: 1_000,
      revenueNetMinor: 200_00,
    });
    db.raw.prepare("UPDATE invoice SET number = 'BETAL-2026-0001'").run();
  });

  it("matches on invoice number and exact amount", async () => {
    const result = await reconcileBankTransfer(db, {
      reference: "BETAL-2026-0001",
      amountMinor: 250_00,
      actorEmail: "ingvar@betal.fo",
    });

    expect(result.matched).toBe(true);
    expect(db.query<{ state: string }>("SELECT state FROM invoice")[0]!.state).toBe(
      "paid",
    );
  });

  it("refuses to guess when the amount differs", async () => {
    // A part payment needs a decision; a wrong automatic match on money is worse
    // than no match.
    const result = await reconcileBankTransfer(db, {
      reference: "BETAL-2026-0001",
      amountMinor: 300_00,
      actorEmail: "ingvar@betal.fo",
    });

    expect(result.matched).toBe(false);
    expect(result.reason).toContain("Amount differs");
    expect(db.query<{ state: string }>("SELECT state FROM invoice")[0]!.state).toBe(
      "issued",
    );
  });

  it("reports when no outstanding invoice matches", async () => {
    const result = await reconcileBankTransfer(db, {
      reference: "BETAL-2026-9999",
      amountMinor: 250_00,
      actorEmail: "ingvar@betal.fo",
    });
    expect(result.matched).toBe(false);
  });
});
