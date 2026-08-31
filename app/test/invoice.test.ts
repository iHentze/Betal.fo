import { beforeEach, describe, expect, it } from "vitest";
import {
  approveInvoice,
  createDraftInvoice,
  creditInvoice,
  InvoiceError,
  issueInvoice,
  lineEvidence,
  markOverdue,
  markPaid,
  nextInvoiceNumber,
  renderInvoice,
} from "~/lib/billing/invoice";
import { ratePeriod } from "~/lib/billing/rating";
import type { PricePlan, PeriodContext } from "~/lib/billing/types";
import { freshDatabase, seedMerchant, type TestDatabase } from "./helpers/sqlite";

const context: PeriodContext = {
  merchantId: "m1",
  year: 2026,
  month: 8,
  startsAtMs: Date.UTC(2026, 7, 1),
  endsAtMs: Date.UTC(2026, 8, 1),
  pointOfSaleCount: 1,
  terminalCount: 0,
};

const plan: PricePlan = {
  id: "plan-1",
  merchantId: "m1",
  name: "Standard",
  version: 1,
  currency: "DKK",
  billableStates: ["SUCCESS"],
  billableTypes: ["PAYMENT"],
  billRefunds: false,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  rules: [
    {
      id: "r1",
      position: 1,
      kind: "monthly_fixed",
      label: "Gáttargjald",
      params: { amountMinor: 149_00 },
    },
    {
      id: "r2",
      position: 2,
      kind: "per_transaction",
      label: "Gjald per gjalding",
      params: { amountMinor: 50 },
    },
  ],
};

function transactions(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `T${String(i + 1).padStart(3, "0")}`,
    state: "SUCCESS",
    type: "PAYMENT",
    amount: 10_000,
    currency: "DKK",
    createdAtMs: Date.UTC(2026, 7, 15) + i,
    pointOfSaleId: "pos1",
  }));
}

async function setup(): Promise<{ db: TestDatabase; periodId: string }> {
  const db = freshDatabase();
  seedMerchant(db);
  db.raw
    .prepare(
      `UPDATE merchant SET v_tal = '654321', legal_name = 'Handil P/F',
              city = 'Klaksvík', invoice_email = 'rokning@handil.fo',
              payment_terms_days = 14 WHERE id = 'm1'`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO billing_period (id, merchant_id, year, month, state, starts_at_ms,
                                   ends_at_ms, created_at, updated_at)
       VALUES ('p1','m1',2026,8,'reconciled',?,?,'2026-09-01','2026-09-01')`,
    )
    .run(context.startsAtMs, context.endsAtMs);
  return { db, periodId: "p1" };
}

const AT = () => Date.parse("2026-09-01T10:00:00Z");

describe("invoice numbering", () => {
  it("is sequential and gapless within a year", async () => {
    const { db } = await setup();
    const numbers: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      numbers.push(await nextInvoiceNumber(db, "BETAL", 2026));
    }
    expect(numbers).toEqual([
      "BETAL-2026-0001",
      "BETAL-2026-0002",
      "BETAL-2026-0003",
      "BETAL-2026-0004",
      "BETAL-2026-0005",
    ]);
  });

  it("restarts each year while staying gapless within one", async () => {
    const { db } = await setup();
    await nextInvoiceNumber(db, "BETAL", 2026);
    await nextInvoiceNumber(db, "BETAL", 2026);
    expect(await nextInvoiceNumber(db, "BETAL", 2027)).toBe("BETAL-2027-0001");
    expect(await nextInvoiceNumber(db, "BETAL", 2026)).toBe("BETAL-2026-0003");
  });

  it("never issues the same number twice under repeated draws", async () => {
    const { db } = await setup();
    const drawn = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      drawn.add(await nextInvoiceNumber(db, "BETAL", 2026));
    }
    expect(drawn.size).toBe(50);
  });
});

describe("invoice lifecycle", () => {
  let db: TestDatabase;
  let periodId: string;
  let invoiceId: string;

  beforeEach(async () => {
    ({ db, periodId } = await setup());
    const rating = ratePeriod(plan, transactions(120), context);
    invoiceId = await createDraftInvoice(
      db,
      { merchantId: "m1", billingPeriodId: periodId, rating },
      AT,
    );
  });

  it("creates a draft with no number so an abandoned draft leaves no gap", async () => {
    const row = db.query<{ state: string; number: string | null }>(
      "SELECT state, number FROM invoice",
    )[0]!;
    expect(row.state).toBe("draft");
    expect(row.number).toBeNull();
  });

  it("stores the lines and the transactions behind them", async () => {
    const lines = db.query<{ id: string; description: string; amount_minor: number }>(
      "SELECT id, description, amount_minor FROM invoice_line ORDER BY position",
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]!.amount_minor).toBe(149_00);
    expect(lines[1]!.amount_minor).toBe(60_00);

    // 120 transactions at 0,50 — and each one recorded, so the figure is explainable.
    const evidence = await lineEvidence(db, lines[1]!.id);
    expect(evidence).toHaveLength(120);
  });

  it("computes MVG at 25% over the whole invoice", async () => {
    const row = db.query<{ net_minor: number; vat_minor: number; gross_minor: number }>(
      "SELECT net_minor, vat_minor, gross_minor FROM invoice",
    )[0]!;
    expect(row.net_minor).toBe(209_00);
    expect(row.vat_minor).toBe(52_25);
    expect(row.gross_minor).toBe(261_25);
  });

  it("refuses to issue before approval", async () => {
    await expect(issueInvoice(db, invoiceId, {}, AT)).rejects.toBeInstanceOf(
      InvoiceError,
    );
  });

  it("assigns a number and snapshots both parties at issue", async () => {
    await approveInvoice(db, invoiceId, "ingvar@betal.fo", AT);
    const number = await issueInvoice(db, invoiceId, {}, AT);

    expect(number).toBe("BETAL-2026-0001");

    const rendered = await renderInvoice(db, invoiceId);
    expect(rendered.invoice.state).toBe("issued");
    expect(rendered.merchant.vTal).toBe("654321");
    expect(rendered.merchant.name).toBe("Handil P/F");
    expect(rendered.issuer.name).toBe("Betal P/F");
    expect(rendered.invoice.currency).toBe("DKK");
  });

  it("keeps the snapshot even after the merchant's details change", async () => {
    await approveInvoice(db, invoiceId, "ingvar@betal.fo", AT);
    await issueInvoice(db, invoiceId, {}, AT);

    db.raw
      .prepare("UPDATE merchant SET legal_name = 'Nýggja Navn P/F', city = 'Rúnavík'")
      .run();

    // The document must still render as it did when it was sent.
    const rendered = await renderInvoice(db, invoiceId);
    expect(rendered.merchant.name).toBe("Handil P/F");
    expect(rendered.merchant.city).toBe("Klaksvík");
  });

  it("sets a due date from the merchant's payment terms", async () => {
    await approveInvoice(db, invoiceId, "ingvar@betal.fo", AT);
    await issueInvoice(db, invoiceId, {}, AT);

    const row = db.query<{ issued_at: string; due_at: string }>(
      "SELECT issued_at, due_at FROM invoice",
    )[0]!;
    const days = (Date.parse(row.due_at) - Date.parse(row.issued_at)) / 86_400_000;
    expect(days).toBe(14);
  });

  it("refuses to issue the same invoice twice", async () => {
    await approveInvoice(db, invoiceId, "ingvar@betal.fo", AT);
    await issueInvoice(db, invoiceId, {}, AT);
    await expect(issueInvoice(db, invoiceId, {}, AT)).rejects.toBeInstanceOf(
      InvoiceError,
    );
  });

  it("moves through paid", async () => {
    await approveInvoice(db, invoiceId, "ingvar@betal.fo", AT);
    await issueInvoice(db, invoiceId, {}, AT);
    await markPaid(db, invoiceId, AT);

    expect(db.query<{ state: string }>("SELECT state FROM invoice")[0]!.state).toBe(
      "paid",
    );
  });

  it("flags an issued invoice past its due date", async () => {
    await approveInvoice(db, invoiceId, "ingvar@betal.fo", AT);
    await issueInvoice(db, invoiceId, {}, AT);

    const later = () => Date.parse("2026-10-01T00:00:00Z");
    const changed = await markOverdue(db, later);

    expect(changed).toBe(1);
    expect(db.query<{ state: string }>("SELECT state FROM invoice")[0]!.state).toBe(
      "overdue",
    );
  });

  it("does not flag one that has been paid", async () => {
    await approveInvoice(db, invoiceId, "ingvar@betal.fo", AT);
    await issueInvoice(db, invoiceId, {}, AT);
    await markPaid(db, invoiceId, AT);

    expect(await markOverdue(db, () => Date.parse("2026-10-01T00:00:00Z"))).toBe(0);
  });
});

describe("credit notes", () => {
  let db: TestDatabase;
  let invoiceId: string;

  beforeEach(async () => {
    const setupResult = await setup();
    db = setupResult.db;
    const rating = ratePeriod(plan, transactions(100), context);
    invoiceId = await createDraftInvoice(
      db,
      { merchantId: "m1", billingPeriodId: setupResult.periodId, rating },
      AT,
    );
    await approveInvoice(db, invoiceId, "ingvar@betal.fo", AT);
    await issueInvoice(db, invoiceId, {}, AT);
  });

  it("issues a negative document referencing the original", async () => {
    const credit = await creditInvoice(
      db,
      invoiceId,
      { reason: "Skeiv prísskipan", createdBy: "ingvar@betal.fo" },
      AT,
    );

    expect(credit.number).toBe("BETAL-2026-0002");

    const row = db.query<{
      kind: string;
      credits_invoice_id: string;
      net_minor: number;
      gross_minor: number;
      state: string;
    }>("SELECT kind, credits_invoice_id, net_minor, gross_minor, state FROM invoice WHERE id = ?", credit.id)[0]!;

    expect(row.kind).toBe("credit_note");
    expect(row.credits_invoice_id).toBe(invoiceId);
    expect(row.net_minor).toBeLessThan(0);
    expect(row.gross_minor).toBeLessThan(0);
    expect(row.state).toBe("issued");
  });

  it("leaves the original untouched and marks it credited", async () => {
    const before = db.query<{ number: string; net_minor: number }>(
      "SELECT number, net_minor FROM invoice WHERE id = ?",
      invoiceId,
    )[0]!;

    await creditInvoice(db, invoiceId, { reason: "Skeiv prísskipan" }, AT);

    const after = db.query<{ number: string; net_minor: number; state: string }>(
      "SELECT number, net_minor, state FROM invoice WHERE id = ?",
      invoiceId,
    )[0]!;

    // An issued invoice is never edited; only its status changes.
    expect(after.number).toBe(before.number);
    expect(after.net_minor).toBe(before.net_minor);
    expect(after.state).toBe("credited");
  });

  it("leaves the original standing after a partial credit", async () => {
    await creditInvoice(
      db,
      invoiceId,
      { reason: "Partvís rætting", amountMinor: 50_00 },
      AT,
    );

    expect(
      db.query<{ state: string }>("SELECT state FROM invoice WHERE id = ?", invoiceId)[0]!
        .state,
    ).toBe("issued");
  });

  it("uses the rate the original carried, not today's", async () => {
    // Guards against a future MVG change silently repricing historical corrections.
    db.raw
      .prepare("UPDATE invoice SET vat_rate_basis_points = 2000 WHERE id = ?")
      .run(invoiceId);

    const credit = await creditInvoice(db, invoiceId, { reason: "Rætting" }, AT);
    const row = db.query<{ vat_rate_basis_points: number; net_minor: number; vat_minor: number }>(
      "SELECT vat_rate_basis_points, net_minor, vat_minor FROM invoice WHERE id = ?",
      credit.id,
    )[0]!;

    expect(row.vat_rate_basis_points).toBe(2000);
    expect(row.vat_minor).toBe(Math.round((row.net_minor * 2000) / 10000));
  });

  it("refuses to credit a draft or a credit note", async () => {
    // A separate period, because one invoice per period is enforced by the schema.
    db.raw
      .prepare(
        `INSERT INTO billing_period (id, merchant_id, year, month, state, starts_at_ms,
                                     ends_at_ms, created_at, updated_at)
         VALUES ('p2','m1',2026,9,'reconciled',0,1,'2026-10-01','2026-10-01')`,
      )
      .run();

    const rating = ratePeriod(plan, transactions(1), context);
    const draftId = await createDraftInvoice(
      db,
      { merchantId: "m1", billingPeriodId: "p2", rating },
      AT,
    );
    await expect(
      creditInvoice(db, draftId, { reason: "nei" }, AT),
    ).rejects.toBeInstanceOf(InvoiceError);

    const credit = await creditInvoice(db, invoiceId, { reason: "Rætting" }, AT);
    await expect(
      creditInvoice(db, credit.id, { reason: "aftur" }, AT),
    ).rejects.toBeInstanceOf(InvoiceError);
  });

  it("keeps numbering gapless across invoices and credit notes", async () => {
    await creditInvoice(db, invoiceId, { reason: "Rætting" }, AT);

    const numbers = db
      .query<{ number: string }>(
        "SELECT number FROM invoice WHERE number IS NOT NULL ORDER BY number",
      )
      .map((r) => r.number);

    expect(numbers).toEqual(["BETAL-2026-0001", "BETAL-2026-0002"]);
  });
});
