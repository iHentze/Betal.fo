import { describe, expect, it } from "vitest";
import { can, recordAudit, requireCapability, AuthorizationError } from "~/lib/audit";
import { freshDatabase, seedMerchant } from "./helpers/sqlite";

describe("business schema", () => {
  it("applies both migrations cleanly", () => {
    const db = freshDatabase();
    const tables = db
      .query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .map((row) => row.name);

    for (const expected of [
      "merchant",
      "txn",
      "operation",
      "settlement_transfer",
      "settlement_adjustment",
      "price_plan",
      "price_plan_rule",
      "cost_plan",
      "billing_period",
      "period_discrepancy",
      "invoice",
      "invoice_line",
      "invoice_line_input",
      "app_user",
      "audit_log",
      "onboarding_application",
      "onboarding_owner",
      "onboarding_document",
      "onboarding_signing",
      "onboarding_event",
      "acquiring_price_list",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("extends merchant with the Faroese business fields", () => {
    const db = freshDatabase();
    seedMerchant(db);
    db.raw
      .prepare(`UPDATE merchant SET v_tal = '123456', legal_name = 'Handil P/F'`)
      .run();

    const row = db.query<{ v_tal: string; country_code: string }>(
      "SELECT v_tal, country_code FROM merchant",
    )[0]!;
    expect(row.v_tal).toBe("123456");
    // Faroe Islands rather than Denmark by default.
    expect(row.country_code).toBe("FO");
  });

  it("seeds the invoice sequence so numbering starts at 1", () => {
    const db = freshDatabase();
    const row = db.query<{ next_number: number }>(
      "SELECT next_number FROM invoice_sequence WHERE series = 'BETAL'",
    )[0]!;
    expect(row.next_number).toBe(1);
  });

  it("refuses two invoices for the same period", () => {
    const db = freshDatabase();
    seedMerchant(db);
    db.raw
      .prepare(
        `INSERT INTO billing_period (id, merchant_id, year, month, starts_at_ms,
                                     ends_at_ms, created_at, updated_at)
         VALUES ('p1','m1',2026,8,0,1,'2026-08-01','2026-08-01')`,
      )
      .run();

    const insert = () =>
      db.raw
        .prepare(
          `INSERT INTO invoice (id, merchant_id, billing_period_id, created_at)
           VALUES (?, 'm1', 'p1', '2026-09-01')`,
        )
        .run(crypto.randomUUID());

    insert();
    // A period must never be billed twice.
    expect(insert).toThrow();
  });

  it("refuses two periods for the same merchant month", () => {
    const db = freshDatabase();
    seedMerchant(db);
    const insert = () =>
      db.raw
        .prepare(
          `INSERT INTO billing_period (id, merchant_id, year, month, starts_at_ms,
                                       ends_at_ms, created_at, updated_at)
           VALUES (?, 'm1', 2026, 8, 0, 1, '2026-08-01', '2026-08-01')`,
        )
        .run(crypto.randomUUID());

    insert();
    expect(insert).toThrow();
  });

  it("enforces unique invoice numbers", () => {
    const db = freshDatabase();
    seedMerchant(db);
    const insert = () =>
      db.raw
        .prepare(
          `INSERT INTO invoice (id, merchant_id, number, created_at)
           VALUES (?, 'm1', 'BETAL-2026-0001', '2026-09-01')`,
        )
        .run(crypto.randomUUID());

    insert();
    expect(insert).toThrow();
  });
});

describe("role capabilities", () => {
  it("lets operators move money but not viewers", () => {
    expect(can("operator", "move_money")).toBe(true);
    expect(can("viewer", "move_money")).toBe(false);
    expect(can("viewer", "read")).toBe(true);
  });

  it("reserves billing management for the owner", () => {
    expect(can("owner", "manage_billing")).toBe(true);
    expect(can("admin", "manage_billing")).toBe(false);
  });

  it("denies an unknown role everything", () => {
    expect(can("nonsense", "read")).toBe(false);
  });
});

describe("audit log", () => {
  it("records a money-moving action with its amount", async () => {
    const db = freshDatabase();
    seedMerchant(db);

    await recordAudit(db, {
      actorUserId: "u1",
      actorEmail: "ingvar@betal.fo",
      merchantId: "m1",
      action: "refund",
      subjectType: "transaction",
      subjectId: "T1",
      amountMinor: 24_950,
      currency: "DKK",
    });

    const row = db.query<Record<string, unknown>>("SELECT * FROM audit_log")[0]!;
    expect(row.action).toBe("refund");
    expect(row.amount_minor).toBe(24_950);
    expect(row.outcome).toBe("success");
  });

  it("records a denial and throws when a role lacks the capability", async () => {
    const db = freshDatabase();
    seedMerchant(db);

    await expect(
      requireCapability(
        db,
        { id: "u2", email: "vitni@handil.fo", role: "viewer", merchantId: "m1" },
        "move_money",
        { action: "refund", subjectType: "transaction", subjectId: "T1" },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // The denied attempt has to leave a trace; that is the point of logging it.
    const row = db.query<{ outcome: string; action: string }>(
      "SELECT outcome, action FROM audit_log",
    )[0]!;
    expect(row.outcome).toBe("denied");
    expect(row.action).toBe("refund");
  });

  it("allows a permitted action without writing a denial", async () => {
    const db = freshDatabase();
    seedMerchant(db);

    await requireCapability(
      db,
      { id: "u1", email: "ingvar@betal.fo", role: "operator", merchantId: "m1" },
      "move_money",
      { action: "refund" },
    );

    expect(db.query("SELECT * FROM audit_log")).toHaveLength(0);
  });
});
