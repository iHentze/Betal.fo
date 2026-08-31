import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountingExport, createMultiLink, createPaymentLink, exportSummary } from "~/lib/products";
import type { EpayMerchantClient } from "~/lib/epay";
import { freshDatabase, seedMerchant, type TestDatabase } from "./helpers/sqlite";

function insertTransaction(
  db: TestDatabase,
  id: string,
  createdAtMs: number,
  overrides: Record<string, unknown> = {},
) {
  db.raw
    .prepare(
      `INSERT INTO txn (id, merchant_id, state, type, amount, surcharge, currency,
                        reference, card_scheme, acquirer, amount_captured,
                        amount_refunded, payment_method_type,
                        created_at, created_at_ms, synced_at_ms)
       VALUES (?, 'm1', ?, 'PAYMENT', ?, ?, 'DKK', ?, 'Visa', 'clearhaus', ?, ?,
               'CARD', ?, ?, ?)`,
    )
    .run(
      id,
      (overrides.state as string) ?? "SUCCESS",
      (overrides.amount as number) ?? 10_000,
      (overrides.surcharge as number) ?? 0,
      (overrides.reference as string) ?? null,
      (overrides.captured as number) ?? 10_000,
      (overrides.refunded as number) ?? 0,
      new Date(createdAtMs).toISOString(),
      createdAtMs,
      createdAtMs,
    );
}

describe("payment links", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db);
  });

  it("creates a link and audits it", async () => {
    const createPaymentLinkMock = vi.fn(async (_request: Record<string, unknown>, _key?: string) => ({
      id: "LNK1",
      sessionId: "s1",
      url: "https://payments.epay.eu/link/LNK1",
    }));
    const client = { createPaymentLink: createPaymentLinkMock } as unknown as EpayMerchantClient;

    const result = await createPaymentLink(db, client, {
      merchantId: "m1",
      pointOfSaleId: "pos1",
      amountMinor: 24_950,
      reference: "ordur-1",
      description: "Viðgerð",
      actorEmail: "kundi@handil.fo",
    });

    expect(result.url).toContain("LNK1");
    const request = createPaymentLinkMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.amount).toBe(24_950);
    expect(request.currency).toBe("DKK");
    expect(request.generateQrCode).toBe(true);

    const audit = db.query<{ action: string; amount_minor: number }>(
      "SELECT action, amount_minor FROM audit_log",
    )[0]!;
    expect(audit.action).toBe("create_payment_link");
    expect(audit.amount_minor).toBe(24_950);
  });

  it("keys idempotency on the merchant reference so a double submit makes one link", async () => {
    const createPaymentLinkMock = vi.fn(async (_request: Record<string, unknown>, _key?: string) => ({
      id: "LNK1",
      sessionId: "s1",
      url: "https://payments.epay.eu/link/LNK1",
    }));
    const client = { createPaymentLink: createPaymentLinkMock } as unknown as EpayMerchantClient;

    await createPaymentLink(db, client, {
      merchantId: "m1",
      pointOfSaleId: "pos1",
      amountMinor: 100,
      reference: "ordur-1",
      actorEmail: "a@b.fo",
    });

    expect(createPaymentLinkMock.mock.calls[0]![1]).toBe("link:m1:ordur-1");
  });

  it("truncates the statement text to what ePay accepts", async () => {
    const createPaymentLinkMock = vi.fn(async (_request: Record<string, unknown>, _key?: string) => ({
      id: "L",
      sessionId: "s",
      url: "https://x",
    }));
    const client = { createPaymentLink: createPaymentLinkMock } as unknown as EpayMerchantClient;

    await createPaymentLink(db, client, {
      merchantId: "m1",
      pointOfSaleId: "pos1",
      amountMinor: 100,
      description: "x".repeat(80),
      actorEmail: "a@b.fo",
    });

    const request = createPaymentLinkMock.mock.calls[0]![0] as { textOnStatement: string };
    expect(request.textOnStatement).toHaveLength(39);
  });

  it("creates a reusable QR that lets the payer choose the amount", async () => {
    const createMultiLinkMock = vi.fn(async (_request: Record<string, unknown>) => ({
      id: "ML1",
      url: "https://payments.epay.eu/ml/ML1",
      qrUrl: "https://payments.epay.eu/multi-links/ML1/qr.png",
      state: "ACTIVE" as const,
      createdAt: "2026-08-01T00:00:00Z",
    }));
    const client = { createMultiLink: createMultiLinkMock } as unknown as EpayMerchantClient;

    const result = await createMultiLink(db, client, {
      merchantId: "m1",
      pointOfSaleId: "pos1",
      amountMinor: 0,
      label: "Drikkipeningar",
      dynamicAmount: true,
      actorEmail: "kundi@handil.fo",
    });

    // A hosted PNG rather than a base64 blob, which is what printing needs.
    expect(result.qrUrl).toContain("qr.png");
    const request = createMultiLinkMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.dynamicAmount).toBe(true);
  });
});

describe("accounting export", () => {
  let db: TestDatabase;
  const august = Date.UTC(2026, 7, 15);

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db);
  });

  it("writes a semicolon-delimited file with comma decimals", async () => {
    insertTransaction(db, "T1", august, { amount: 123_456, reference: "ordur-1" });

    const file = await accountingExport(db, {
      merchantId: "m1",
      fromMs: Date.UTC(2026, 7, 1),
      toMs: Date.UTC(2026, 8, 1),
    });

    const lines = file.body.split("\r\n");
    expect(lines[0]).toContain("Dagfesting;Tilvísing");
    // Comma decimals and semicolon separators, so a Faroese spreadsheet opens it
    // correctly rather than mangling every amount.
    expect(lines[1]).toContain("1234,56");
    expect(lines[1]).toContain("ordur-1");
    expect(file.filename).toBe("betal-2026-08-01-2026-08-31.csv");
  });

  it("starts with a byte order mark so Excel reads Faroese characters", async () => {
    insertTransaction(db, "T1", august);
    const file = await accountingExport(db, {
      merchantId: "m1",
      fromMs: Date.UTC(2026, 7, 1),
      toMs: Date.UTC(2026, 8, 1),
    });
    expect(file.body.startsWith("\uFEFF")).toBe(true);
  });

  it("includes acquirer fees so the books carry the real cost of each payment", async () => {
    insertTransaction(db, "T1", august, { amount: 100_00, captured: 100_00 });

    db.raw
      .prepare(
        `INSERT INTO settlement_transfer (id, merchant_id, net_amount, currency,
                                          created_at, created_at_ms)
         VALUES ('tr1','m1','98.00','DKK','2026-08-20',1)`,
      )
      .run();
    db.raw
      .prepare(
        `INSERT INTO settlement_transaction (id, settlement_transfer_id, merchant_id,
                                             transaction_id, net_amount, currency,
                                             posting_date, created_at)
         VALUES ('st1','tr1','m1','T1','98.00','DKK','2026-08-20','2026-08-20')`,
      )
      .run();
    db.raw
      .prepare(
        `INSERT INTO settlement_adjustment (id, merchant_id, settlement_transfer_id,
                                            settlement_transaction_id, scope, type,
                                            amount)
         VALUES ('a1','m1','tr1','st1','transaction','ACQUIRER_FEE','-2.00')`,
      )
      .run();

    const file = await accountingExport(db, {
      merchantId: "m1",
      fromMs: Date.UTC(2026, 7, 1),
      toMs: Date.UTC(2026, 8, 1),
    });

    const row = file.body.split("\r\n")[1]!;
    // Fee of -2,00 and therefore a net of 98,00 rather than the 100,00 gross.
    expect(row).toContain("-2,00");
    expect(row).toContain("98,00");
    expect(row).toContain("2026-08-20");
  });

  it("excludes failed payments and other months", async () => {
    insertTransaction(db, "OK", august);
    insertTransaction(db, "FAILED", august + 1, { state: "FAILED" });
    insertTransaction(db, "SEPTEMBER", Date.UTC(2026, 8, 2));

    const file = await accountingExport(db, {
      merchantId: "m1",
      fromMs: Date.UTC(2026, 7, 1),
      toMs: Date.UTC(2026, 8, 1),
    });

    expect(file.body).toContain("OK");
    expect(file.body).not.toContain("FAILED");
    expect(file.body).not.toContain("SEPTEMBER");
  });

  it("escapes a reference containing the delimiter", async () => {
    insertTransaction(db, "T1", august, { reference: "ordur;1" });
    const file = await accountingExport(db, {
      merchantId: "m1",
      fromMs: Date.UTC(2026, 7, 1),
      toMs: Date.UTC(2026, 8, 1),
    });
    expect(file.body).toContain('"ordur;1"');
  });

  it("leaves amounts unquoted, since the delimiter is a semicolon", async () => {
    // Quoting on the comma would wrap every amount in the file for no reason.
    insertTransaction(db, "T1", august, { amount: 123_456 });
    const file = await accountingExport(db, {
      merchantId: "m1",
      fromMs: Date.UTC(2026, 7, 1),
      toMs: Date.UTC(2026, 8, 1),
    });
    expect(file.body).toContain(";1234,56;");
    expect(file.body).not.toContain('"1234,56"');
  });

  it("offers JSON for systems that can consume it", async () => {
    insertTransaction(db, "T1", august);
    const file = await accountingExport(db, {
      merchantId: "m1",
      fromMs: Date.UTC(2026, 7, 1),
      toMs: Date.UTC(2026, 8, 1),
      format: "json",
    });

    expect(file.contentType).toBe("application/json");
    expect(JSON.parse(file.body)).toHaveLength(1);
  });

  it("summarises a period for the download screen", async () => {
    insertTransaction(db, "T1", august, { amount: 10_000 });
    insertTransaction(db, "T2", august + 1, { amount: 25_000 });

    const summary = await exportSummary(db, {
      merchantId: "m1",
      fromMs: Date.UTC(2026, 7, 1),
      toMs: Date.UTC(2026, 8, 1),
    });

    expect(summary.count).toBe(2);
    expect(summary.label).toBe("350,00 DKK");
  });
});
