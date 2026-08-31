import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertReadyToRate,
  billableTransactions,
  canTransition,
  ensurePeriod,
  freezePeriod,
  markIssued,
  markRated,
  monthBounds,
  PeriodStateError,
  reconcilePeriod,
  resolveDiscrepancy,
  type PeriodRow,
} from "~/lib/billing/period";
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
    notificationUrl: "",
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

function insertMirrored(
  db: TestDatabase,
  id: string,
  createdAtMs: number,
  overrides: { amount?: number; state?: string; type?: string } = {},
) {
  db.raw
    .prepare(
      `INSERT INTO txn (id, merchant_id, point_of_sale_id, state, type, amount,
                        surcharge, currency, created_at, created_at_ms, synced_at_ms)
       VALUES (?, 'm1', 'pos1', ?, ?, ?, 0, 'DKK', ?, ?, ?)`,
    )
    .run(
      id,
      overrides.state ?? "SUCCESS",
      overrides.type ?? "PAYMENT",
      overrides.amount ?? 10_000,
      new Date(createdAtMs).toISOString(),
      createdAtMs,
      createdAtMs,
    );
}

function clientReturning(pages: Array<{ items: Transaction[]; next: string | null }>) {
  let call = 0;
  const listTransactions = vi.fn(async () => {
    const page = pages[Math.min(call++, pages.length - 1)]!;
    return {
      currentOffset: "",
      nextOffset: page.next,
      perPage: 500,
      hasMore: page.next !== null,
      items: page.items.map((t) => ({ transaction: t })),
    };
  });
  return { client: { listTransactions } as unknown as EpayMerchantClient, listTransactions };
}

const AUGUST = { year: 2026, month: 8 };
const midAugust = Date.UTC(2026, 7, 15, 12, 0, 0);

describe("monthBounds", () => {
  it("returns an inclusive start and exclusive end", () => {
    const { startsAtMs, endsAtMs } = monthBounds(2026, 8);
    expect(new Date(startsAtMs).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(new Date(endsAtMs).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("handles the December rollover", () => {
    const { endsAtMs } = monthBounds(2026, 12);
    expect(new Date(endsAtMs).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("handles a leap February", () => {
    const { startsAtMs, endsAtMs } = monthBounds(2028, 2);
    expect((endsAtMs - startsAtMs) / 86_400_000).toBe(29);
  });
});

describe("state machine", () => {
  it("permits only the documented transitions", () => {
    expect(canTransition("open", "frozen")).toBe(true);
    expect(canTransition("frozen", "reconciling")).toBe(true);
    expect(canTransition("reconciling", "reconciled")).toBe(true);
    expect(canTransition("reconciled", "rated")).toBe(true);
    expect(canTransition("rated", "issued")).toBe(true);
  });

  it("refuses to skip reconciliation", () => {
    // The entire point of the close: an unreconciled period cannot be rated.
    expect(canTransition("open", "rated")).toBe(false);
    expect(canTransition("frozen", "reconciled")).toBe(false);
    expect(canTransition("discrepancy", "reconciled")).toBe(false);
  });

  it("sends a resolved discrepancy back through reconciliation", () => {
    expect(canTransition("discrepancy", "reconciling")).toBe(true);
  });

  it("treats issued as terminal", () => {
    expect(canTransition("issued", "rated")).toBe(false);
    expect(canTransition("issued", "open")).toBe(false);
  });
});

describe("ensurePeriod", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db);
  });

  it("creates the period once and returns it thereafter", async () => {
    const first = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);
    const second = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);

    expect(first.id).toBe(second.id);
    expect(first.state).toBe("open");
    expect(db.query("SELECT * FROM billing_period")).toHaveLength(1);
  });
});

describe("freezePeriod", () => {
  it("captures the mirror count at the moment of freezing", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    insertMirrored(db, "T1", midAugust);
    insertMirrored(db, "T2", midAugust + 1000);
    // Outside the window, so it must not be counted.
    insertMirrored(db, "T3", Date.UTC(2026, 8, 2));

    const period = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);
    await freezePeriod(db, period);

    const row = db.query<{ state: string; mirror_count: number }>(
      "SELECT state, mirror_count FROM billing_period",
    )[0]!;
    expect(row.state).toBe("frozen");
    expect(row.mirror_count).toBe(2);
  });

  it("refuses to freeze twice", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const period = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);
    await freezePeriod(db, period);

    await expect(freezePeriod(db, { ...period, state: "frozen" })).rejects.toBeInstanceOf(
      PeriodStateError,
    );
  });
});

describe("reconcilePeriod", () => {
  let db: TestDatabase;
  let period: PeriodRow;

  beforeEach(async () => {
    db = freshDatabase();
    seedMerchant(db);
    period = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);
  });

  async function frozen(): Promise<PeriodRow> {
    await freezePeriod(db, period);
    return db.query<PeriodRow>("SELECT * FROM billing_period")[0]!;
  }

  it("reconciles cleanly when the mirror matches ePay", async () => {
    insertMirrored(db, "T1", midAugust);
    insertMirrored(db, "T2", midAugust + 1000);
    const p = await frozen();

    const { client } = clientReturning([
      { items: [transaction("T1"), transaction("T2")], next: null },
    ]);

    const result = await reconcilePeriod(db, client, p);

    expect(result.complete).toBe(true);
    expect(result.discrepancies).toBe(0);
    expect(result.epayCount).toBe(2);

    const row = db.query<{ state: string; epay_count: number; reconciled_at: string }>(
      "SELECT state, epay_count, reconciled_at FROM billing_period",
    )[0]!;
    expect(row.state).toBe("reconciled");
    expect(row.epay_count).toBe(2);
    expect(row.reconciled_at).not.toBeNull();
  });

  it("flags a transaction ePay has that we are missing", async () => {
    // The exact failure the close exists to catch: a webhook that never arrived.
    insertMirrored(db, "T1", midAugust);
    const p = await frozen();

    const { client } = clientReturning([
      { items: [transaction("T1"), transaction("T2")], next: null },
    ]);

    const result = await reconcilePeriod(db, client, p);

    expect(result.discrepancies).toBe(1);
    const row = db.query<{ kind: string; transaction_id: string }>(
      "SELECT kind, transaction_id FROM period_discrepancy",
    )[0]!;
    expect(row.kind).toBe("missing_locally");
    expect(row.transaction_id).toBe("T2");

    // And the period is parked, not advanced.
    expect(
      db.query<{ state: string }>("SELECT state FROM billing_period")[0]!.state,
    ).toBe("discrepancy");
  });

  it("flags an amount that differs from ePay", async () => {
    insertMirrored(db, "T1", midAugust, { amount: 9_000 });
    const p = await frozen();

    const { client } = clientReturning([
      { items: [transaction("T1", { amount: 10_000 })], next: null },
    ]);

    await reconcilePeriod(db, client, p);

    const row = db.query<{ kind: string; detail: string }>(
      "SELECT kind, detail FROM period_discrepancy",
    )[0]!;
    expect(row.kind).toBe("amount_mismatch");
    expect(JSON.parse(row.detail)).toEqual({ mirror: 9_000, epay: 10_000 });
  });

  it("flags a state that differs from ePay", async () => {
    insertMirrored(db, "T1", midAugust, { state: "PENDING" });
    const p = await frozen();

    const { client } = clientReturning([
      { items: [transaction("T1", { state: "SUCCESS" })], next: null },
    ]);

    await reconcilePeriod(db, client, p);
    expect(
      db.query<{ kind: string }>("SELECT kind FROM period_discrepancy")[0]!.kind,
    ).toBe("state_mismatch");
  });

  it("asks ePay for an inclusive window one millisecond short of our exclusive end", async () => {
    const p = await frozen();
    const { client, listTransactions } = clientReturning([{ items: [], next: null }]);

    await reconcilePeriod(db, client, p);

    const query = listTransactions.mock.calls[0]![0] as {
      createdAfter: string;
      createdBefore: string;
    };
    expect(query.createdAfter).toBe("2026-08-01T00:00:00.000Z");
    // Not 2026-09-01, which would pull in the next month's first transaction because
    // ePay treats createdBefore as inclusive.
    expect(query.createdBefore).toBe("2026-08-31T23:59:59.999Z");
  });

  it("resumes from the stored cursor instead of restarting", async () => {
    insertMirrored(db, "T1", midAugust);
    insertMirrored(db, "T2", midAugust + 1000);
    const p = await frozen();

    const { client, listTransactions } = clientReturning([
      { items: [transaction("T1")], next: "CUR2" },
      { items: [transaction("T2")], next: null },
    ]);

    const first = await reconcilePeriod(db, client, p, { maxPages: 1 });
    expect(first.complete).toBe(false);
    expect(first.nextCursor).toBe("CUR2");

    const current = db.query<PeriodRow>("SELECT * FROM billing_period")[0]!;
    const second = await reconcilePeriod(db, client, current, { maxPages: 5 });

    expect(second.complete).toBe(true);
    expect(second.epayCount).toBe(2);
    expect(listTransactions.mock.calls[1]![0]).toMatchObject({ offset: "CUR2" });
  });

  it("refuses to re-reconcile while discrepancies are unresolved", async () => {
    insertMirrored(db, "T1", midAugust);
    const p = await frozen();
    const { client } = clientReturning([
      { items: [transaction("T1"), transaction("T2")], next: null },
    ]);
    await reconcilePeriod(db, client, p);

    const parked = db.query<PeriodRow>("SELECT * FROM billing_period")[0]!;
    await expect(reconcilePeriod(db, client, parked)).rejects.toThrow(
      /unresolved discrepancies/,
    );
  });

  it("reconciles once the discrepancies are resolved", async () => {
    insertMirrored(db, "T1", midAugust);
    const p = await frozen();
    const { client } = clientReturning([
      { items: [transaction("T1"), transaction("T2")], next: null },
    ]);
    await reconcilePeriod(db, client, p);

    // Operator investigates and backfills the missing row.
    insertMirrored(db, "T2", midAugust + 500);
    const discrepancy = db.query<{ id: string }>(
      "SELECT id FROM period_discrepancy",
    )[0]!;
    await resolveDiscrepancy(db, discrepancy.id, "ingvar@betal.fo", "Backfilled from ePay");

    // Reset the walk so it re-reads from the start.
    db.raw.prepare("DELETE FROM sync_cursor").run();
    const parked = db.query<PeriodRow>("SELECT * FROM billing_period")[0]!;
    const result = await reconcilePeriod(db, client, parked);

    expect(result.discrepancies).toBe(0);
    expect(
      db.query<{ state: string }>("SELECT state FROM billing_period")[0]!.state,
    ).toBe("reconciled");
  });
});

describe("assertReadyToRate", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = freshDatabase();
    seedMerchant(db);
  });

  it("blocks a period that has not been reconciled", async () => {
    const period = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);
    await expect(assertReadyToRate(db, period.id)).rejects.toBeInstanceOf(
      PeriodStateError,
    );
  });

  it("blocks a reconciled period that still has an open discrepancy", async () => {
    const period = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);
    db.raw
      .prepare("UPDATE billing_period SET state = 'reconciled' WHERE id = ?")
      .run(period.id);
    db.raw
      .prepare(
        `INSERT INTO period_discrepancy (id, billing_period_id, merchant_id,
                                         transaction_id, kind, created_at)
         VALUES ('d1', ?, 'm1', 'T9', 'missing_locally', '2026-09-01')`,
      )
      .run(period.id);

    await expect(assertReadyToRate(db, period.id)).rejects.toThrow(
      /unresolved discrepancies/,
    );
  });

  it("passes a clean reconciled period", async () => {
    const period = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);
    db.raw
      .prepare("UPDATE billing_period SET state = 'reconciled' WHERE id = ?")
      .run(period.id);

    const ready = await assertReadyToRate(db, period.id);
    expect(ready.state).toBe("reconciled");
  });

  it("advances through rated to issued", async () => {
    const period = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);
    db.raw
      .prepare("UPDATE billing_period SET state = 'reconciled' WHERE id = ?")
      .run(period.id);

    const ready = await assertReadyToRate(db, period.id);
    await markRated(db, ready, 120, 12_000);
    const rated = db.query<PeriodRow>("SELECT * FROM billing_period")[0]!;
    expect(rated.state).toBe("rated");
    expect(rated.billable_count).toBe(120);

    await markIssued(db, rated);
    expect(
      db.query<{ state: string }>("SELECT state FROM billing_period")[0]!.state,
    ).toBe("issued");
  });
});

describe("billableTransactions", () => {
  it("returns only the states, types and window the plan allows", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    insertMirrored(db, "OK1", midAugust);
    insertMirrored(db, "OK2", midAugust + 1000);
    insertMirrored(db, "FAILED", midAugust + 2000, { state: "FAILED" });
    insertMirrored(db, "PAYOUT", midAugust + 3000, { type: "PAYOUT" });
    insertMirrored(db, "SEPTEMBER", Date.UTC(2026, 8, 1));

    const period = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);
    const billable = await billableTransactions(db, period, ["SUCCESS"], ["PAYMENT"]);

    expect(billable.map((t) => t.id)).toEqual(["OK1", "OK2"]);
  });

  it("orders deterministically so rating replays identically", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    for (const id of ["C", "A", "B"]) insertMirrored(db, id, midAugust);

    const period = await ensurePeriod(db, "m1", AUGUST.year, AUGUST.month);
    const first = await billableTransactions(db, period, ["SUCCESS"], ["PAYMENT"]);
    const second = await billableTransactions(db, period, ["SUCCESS"], ["PAYMENT"]);

    expect(first.map((t) => t.id)).toEqual(["A", "B", "C"]);
    expect(first).toEqual(second);
  });
});
