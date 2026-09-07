import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  backfillTransactions,
  splitWindow,
  syncSettlementTransfer,
} from "~/lib/sync/backfill";
import {
  listTransactions,
  transactionTotals,
  getTransaction,
  settlementFeeBreakdown,
} from "~/lib/db/queries";
import type { EpayMerchantClient, Transaction } from "~/lib/epay";
import { freshDatabase, seedMerchant, type TestDatabase } from "./helpers/sqlite";

function transaction(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    subscriptionId: null,
    billingAgreementChargeId: null,
    state: "SUCCESS",
    errorCode: null,
    externalStatusCodes: null,
    createdAt: "2026-08-15T12:00:00Z",
    sessionId: null,
    paymentMethodId: "pm1",
    paymentMethodType: "CARD",
    paymentMethodSubType: "Visa",
    paymentMethodExpiry: null,
    paymentMethodDisplayText: "40000000XXXX0003",
    paymentMethodHolderName: null,
    scaMode: "NORMAL",
    customerId: null,
    amount: 10_000,
    fee: 0,
    currency: "DKK",
    instantCapture: "OFF",
    notificationUrl: "https://app.betal.fo/api/hooks/m1",
    pointOfSaleId: "pos1",
    reference: null,
    textOnStatement: null,
    exemptions: [],
    attributes: {},
    clientIp: "",
    clientCountry: "FO",
    type: "PAYMENT",
    ...overrides,
  };
}

function insertTransaction(
  db: TestDatabase,
  id: string,
  createdAtMs: number,
  overrides: Record<string, unknown> = {},
) {
  const row = {
    state: "SUCCESS",
    amount: 10_000,
    reference: null,
    acquirer: "clearhaus",
    ...overrides,
  };
  db.raw
    .prepare(
      `INSERT INTO txn (id, merchant_id, point_of_sale_id, state, type, amount,
                        surcharge, currency, reference, acquirer, created_at,
                        created_at_ms, synced_at_ms)
       VALUES (?, 'm1', 'pos1', ?, 'PAYMENT', ?, 0, 'DKK', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      row.state as string,
      row.amount as number,
      row.reference as string | null,
      row.acquirer as string,
      new Date(createdAtMs).toISOString(),
      createdAtMs,
      createdAtMs,
    );
}

describe("splitWindow", () => {
  it("produces non-overlapping windows despite inclusive bounds", () => {
    // ePay treats createdAfter and createdBefore as inclusive, so chained windows must
    // not share a boundary instant or the transaction on it is counted twice.
    const windows = splitWindow(
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-22T00:00:00.000Z"),
      7,
    );

    expect(windows.length).toBeGreaterThan(1);
    for (let i = 1; i < windows.length; i += 1) {
      const previousEnd = Date.parse(windows[i - 1]!.createdBefore);
      const currentStart = Date.parse(windows[i]!.createdAfter);
      expect(currentStart).toBe(previousEnd + 1);
    }
  });

  it("covers the whole range", () => {
    const from = new Date("2026-08-01T00:00:00.000Z");
    const to = new Date("2026-08-31T23:59:59.999Z");
    const windows = splitWindow(from, to, 7);

    expect(Date.parse(windows[0]!.createdAfter)).toBe(from.getTime());
    expect(Date.parse(windows[windows.length - 1]!.createdBefore)).toBe(to.getTime());
  });

  it("returns a single window when the range is shorter than the step", () => {
    const windows = splitWindow(
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-03T00:00:00.000Z"),
      7,
    );
    expect(windows).toHaveLength(1);
  });
});

describe("backfillTransactions", () => {
  let db: TestDatabase;
  const window = {
    createdAfter: "2026-08-01T00:00:00.000Z",
    createdBefore: "2026-08-31T23:59:59.999Z",
  };

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db);
  });

  function clientReturning(pages: Array<{ items: Transaction[]; next: string | null }>) {
    let call = 0;
    const listTransactionsMock = vi.fn(async (_query: Record<string, unknown>) => {
      const page = pages[call++]!;
      return {
        currentOffset: "",
        nextOffset: page.next,
        perPage: 500,
        hasMore: page.next !== null,
        items: page.items.map((t) => ({ transaction: t })),
      };
    });
    return {
      client: { listTransactions: listTransactionsMock } as unknown as EpayMerchantClient,
      listTransactionsMock,
    };
  }

  it("writes transactions and marks the walk complete", async () => {
    const { client } = clientReturning([
      { items: [transaction("T1"), transaction("T2")], next: null },
    ]);

    const result = await backfillTransactions(db, client, { merchantId: "m1", window });

    expect(result.written).toBe(2);
    expect(result.complete).toBe(true);
    expect(db.query("SELECT * FROM txn")).toHaveLength(2);

    const cursor = db.query<{ state: string; items_seen: number }>(
      "SELECT state, items_seen FROM sync_cursor",
    )[0]!;
    expect(cursor.state).toBe("complete");
    expect(cursor.items_seen).toBe(2);
  });

  it("stops at maxPages and resumes from the stored cursor", async () => {
    const { client, listTransactionsMock } = clientReturning([
      { items: [transaction("T1")], next: "CUR2" },
      { items: [transaction("T2")], next: null },
    ]);

    const first = await backfillTransactions(db, client, {
      merchantId: "m1",
      window,
      maxPages: 1,
    });

    expect(first.complete).toBe(false);
    expect(first.nextCursor).toBe("CUR2");
    expect(db.query("SELECT * FROM txn")).toHaveLength(1);

    const second = await backfillTransactions(db, client, {
      merchantId: "m1",
      window,
      maxPages: 1,
    });

    expect(second.complete).toBe(true);
    expect(db.query("SELECT * FROM txn")).toHaveLength(2);
    // The resumed call must continue from the cursor, not restart and re-spend the
    // rate-limit budget on pages we already have.
    expect(listTransactionsMock.mock.calls[1]![0]).toMatchObject({ offset: "CUR2" });
  });

  it("does not repeat a completed window", async () => {
    const { client, listTransactionsMock } = clientReturning([
      { items: [transaction("T1")], next: null },
    ]);

    await backfillTransactions(db, client, { merchantId: "m1", window });
    const again = await backfillTransactions(db, client, { merchantId: "m1", window });

    expect(again.complete).toBe(true);
    expect(again.written).toBe(0);
    expect(listTransactionsMock).toHaveBeenCalledTimes(1);
  });

  it("records the error and keeps the cursor so a retry resumes", async () => {
    const client = {
      listTransactions: vi
        .fn()
        .mockResolvedValueOnce({
          currentOffset: "",
          nextOffset: "CUR2",
          perPage: 500,
          hasMore: true,
          items: [{ transaction: transaction("T1") }],
        })
        .mockRejectedValueOnce(new Error("rate limited")),
    } as unknown as EpayMerchantClient;

    await expect(
      backfillTransactions(db, client, { merchantId: "m1", window }),
    ).rejects.toThrow("rate limited");

    const cursor = db.query<{ state: string; cursor: string; error: string }>(
      "SELECT state, cursor, error FROM sync_cursor",
    )[0]!;
    expect(cursor.state).toBe("error");
    expect(cursor.cursor).toBe("CUR2");
    expect(cursor.error).toContain("rate limited");
  });

  it("marks backfilled rows so their provenance is visible", async () => {
    const { client } = clientReturning([{ items: [transaction("T1")], next: null }]);
    await backfillTransactions(db, client, { merchantId: "m1", window });

    const row = db.query<{ source: string }>("SELECT source FROM txn")[0]!;
    expect(row.source).toBe("backfill");
  });
});

describe("syncSettlementTransfer", () => {
  it("stores the transfer, its rows and the per-transaction fee breakdown", async () => {
    const db = freshDatabase();
    seedMerchant(db);

    const client = {
      getSettlementTransfer: vi.fn(async () => ({
        id: "st-1",
        acquirer: "clearhaus",
        settlementName: "settlement.csv",
        settlementIds: ["R01234"],
        postingDate: "2026-08-20",
        netAmount: "24671.05",
        currency: "DKK",
        acquirerReference: "acq-1",
        adjustments: [],
        adjustmentSums: [],
        createdAt: "2026-08-20T06:00:00Z",
      })),
      async *iterateSettlementTransactions() {
        yield {
          settlementTransaction: {
            id: "stx-1",
            settlementTransferId: "st-1",
            transactionId: "T1",
            agreementId: "R01234",
            merchantReference: "ordur-1",
            acquirerReference: "acq-tx-1",
            postingDate: "2026-08-20",
            settlementNetAmount: "97.55",
            settlementCurrency: "DKK",
            adjustments: [
              { type: "ACQUIRER_FEE", amount: "-1.20", description: "discount_rate" },
              { type: "INTERCHANGE_FEE", amount: "-0.85", description: "interchange" },
              { type: "SCHEME_FEE", amount: "-0.40", description: "scheme" },
            ],
            createdAt: "2026-08-20T06:00:00Z",
          },
          transaction: null,
        };
      },
    } as unknown as EpayMerchantClient;

    const result = await syncSettlementTransfer(db, client, "m1", "st-1");

    expect(result.rows).toBe(1);
    expect(db.query("SELECT * FROM settlement_transaction")).toHaveLength(1);

    const breakdown = await settlementFeeBreakdown(db, "st-1");
    const byType = Object.fromEntries(breakdown.map((r) => [r.type, r.total]));
    expect(byType.ACQUIRER_FEE).toBe("-1.20");
    expect(byType.INTERCHANGE_FEE).toBe("-0.85");
    expect(byType.SCHEME_FEE).toBe("-0.40");

    const transfer = db.query<{ transactions_synced: number }>(
      "SELECT transactions_synced FROM settlement_transfer",
    )[0]!;
    expect(transfer.transactions_synced).toBe(1);
  });
});

describe("listTransactions", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db);
    seedMerchant(db, "m2", "acct-2");
  });

  it("returns newest first and pages with a keyset cursor", async () => {
    const base = Date.parse("2026-08-01T00:00:00Z");
    for (let i = 0; i < 5; i += 1) {
      insertTransaction(db, `T${i}`, base + i * 1000);
    }

    const first = await listTransactions(db, { merchantId: "m1" }, 2);
    expect(first.rows.map((r) => r.id)).toEqual(["T4", "T3"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listTransactions(db, { merchantId: "m1" }, 2, first.nextCursor!);
    expect(second.rows.map((r) => r.id)).toEqual(["T2", "T1"]);

    const third = await listTransactions(db, { merchantId: "m1" }, 2, second.nextCursor!);
    expect(third.rows.map((r) => r.id)).toEqual(["T0"]);
    expect(third.nextCursor).toBeNull();
  });

  it("does not skip or repeat rows sharing a timestamp", async () => {
    const same = Date.parse("2026-08-01T00:00:00Z");
    for (const id of ["A", "B", "C", "D"]) insertTransaction(db, id, same);

    const seen: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await listTransactions(db, { merchantId: "m1" }, 2, cursor ?? undefined);
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen.sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("never leaks another merchant's transactions", async () => {
    insertTransaction(db, "MINE", Date.parse("2026-08-01T00:00:00Z"));
    db.raw
      .prepare(
        `INSERT INTO txn (id, merchant_id, state, type, amount, surcharge, currency,
                          created_at, created_at_ms, synced_at_ms)
         VALUES ('THEIRS', 'm2', 'SUCCESS', 'PAYMENT', 500, 0, 'DKK',
                 '2026-08-01T00:00:00Z', 1, 1)`,
      )
      .run();

    const page = await listTransactions(db, { merchantId: "m1" }, 50);
    expect(page.rows.map((r) => r.id)).toEqual(["MINE"]);
  });

  it("filters by state, amount range and reference search", async () => {
    const base = Date.parse("2026-08-01T00:00:00Z");
    insertTransaction(db, "OK", base, { state: "SUCCESS", amount: 5_000, reference: "ordur-1" });
    insertTransaction(db, "BIG", base + 1, { state: "SUCCESS", amount: 90_000 });
    insertTransaction(db, "BAD", base + 2, { state: "FAILED", amount: 5_000 });

    expect(
      (await listTransactions(db, { merchantId: "m1", state: "FAILED" }, 50)).rows.map(
        (r) => r.id,
      ),
    ).toEqual(["BAD"]);

    expect(
      (await listTransactions(db, { merchantId: "m1", minAmount: 10_000 }, 50)).rows.map(
        (r) => r.id,
      ),
    ).toEqual(["BIG"]);

    expect(
      (await listTransactions(db, { merchantId: "m1", search: "ordur" }, 50)).rows.map(
        (r) => r.id,
      ),
    ).toEqual(["OK"]);
  });

  it("treats the date range as inclusive start and exclusive end", async () => {
    const start = Date.parse("2026-08-01T00:00:00Z");
    const end = Date.parse("2026-09-01T00:00:00Z");
    insertTransaction(db, "FIRST", start);
    insertTransaction(db, "LAST", end - 1);
    insertTransaction(db, "NEXT_MONTH", end);

    const page = await listTransactions(
      db,
      { merchantId: "m1", from: start, to: end },
      50,
    );
    expect(page.rows.map((r) => r.id).sort()).toEqual(["FIRST", "LAST"]);
  });

  it("summarises the filtered set", async () => {
    const base = Date.parse("2026-08-01T00:00:00Z");
    insertTransaction(db, "A", base, { amount: 10_000 });
    insertTransaction(db, "B", base + 1, { amount: 25_000 });
    insertTransaction(db, "C", base + 2, { amount: 5_000, state: "FAILED" });

    const all = await transactionTotals(db, { merchantId: "m1" });
    expect(all.count).toBe(3);
    expect(all.gross).toBe(40_000);

    const successful = await transactionTotals(db, {
      merchantId: "m1",
      state: "SUCCESS",
    });
    expect(successful.count).toBe(2);
    expect(successful.gross).toBe(35_000);
  });
});

describe("getTransaction", () => {
  it("returns the transaction with its operations and settlement rows", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    insertTransaction(db, "T1", Date.parse("2026-08-01T00:00:00Z"));

    db.raw
      .prepare(
        `INSERT INTO operation (id, transaction_id, merchant_id, type, state, amount,
                                created_at, created_at_ms)
         VALUES ('op1', 'T1', 'm1', 'AUTHORIZATION', 'SUCCESS', 10000,
                 '2026-08-01T00:00:00Z', 1)`,
      )
      .run();

    const result = await getTransaction(db, "m1", "T1");
    expect(result.transaction?.id).toBe("T1");
    expect(result.operations).toHaveLength(1);
  });

  it("returns nothing for another merchant's transaction", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    seedMerchant(db, "m2", "acct-2");
    insertTransaction(db, "T1", Date.parse("2026-08-01T00:00:00Z"));

    const result = await getTransaction(db, "m2", "T1");
    expect(result.transaction).toBeNull();
  });
});
