import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateMerchant,
  clonePricePlan,
  createMerchant,
  onboardingProgress,
  provisionMerchant,
} from "~/lib/provisioning";
import type { Epay } from "~/lib/epay";
import { freshDatabase, type TestDatabase } from "./helpers/sqlite";

function fakeEpay(overrides: Record<string, unknown> = {}) {
  const createAccount = vi.fn(async (_request: Record<string, unknown>) => ({
    id: "acct-new",
    status: "created",
    name: "Handil",
  }));
  const activateAccount = vi.fn(async () => undefined);
  const createPointOfSale = vi.fn(async (_request: Record<string, unknown>) => ({
    pointOfSale: {
      id: "pos-new",
      name: "Betal",
      descriptor: "BETAL",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    },
    hostedConfiguration: { scaMode: "NORMAL" },
  }));
  const createWebhook = vi.fn(async (_request: Record<string, unknown>) => ({ id: "wh-new" }));

  const epay = {
    partner: { createAccount, activateAccount },
    forMerchant: () => ({ createPointOfSale, createWebhook }),
    ...overrides,
  } as unknown as Epay;

  return { epay, createAccount, activateAccount, createPointOfSale, createWebhook };
}

function seedTemplate(db: TestDatabase): string {
  db.raw
    .prepare(
      `INSERT INTO price_plan (id, merchant_id, name, version, is_template, currency,
                               billable_states, billable_types, bill_refunds,
                               effective_from, created_at)
       VALUES ('tpl', NULL, 'Standard', 1, 1, 'DKK', '["SUCCESS"]', '["PAYMENT"]', 0,
               '2026-01-01', '2026-01-01')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO price_plan_rule (id, price_plan_id, position, kind, label, params,
                                    created_at)
       VALUES ('tr1', 'tpl', 1, 'per_transaction', 'Gjald per gjalding',
               '{"amountMinor":50}', '2026-01-01')`,
    )
    .run();
  return "tpl";
}

describe("createMerchant", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
  });

  it("creates the ePay account and records it before anything else", async () => {
    const { epay, createAccount } = fakeEpay();

    const { merchantId } = await createMerchant(db, epay, {
      name: "Handil P/F",
      email: "eigari@handil.fo",
      domain: "handil.fo",
      vTal: "123456",
    });

    expect(createAccount).toHaveBeenCalledOnce();
    const merchant = db.query<Record<string, any>>("SELECT * FROM merchant")[0]!;
    expect(merchant.epay_account_id).toBe("acct-new");
    expect(merchant.v_tal).toBe("123456");
    // Faroese defaults rather than Danish ones.
    expect(merchant.country_code).toBe("FO");
    expect(merchant.timezone).toBe("Atlantic/Faroe");
    // Not live until someone decides it is.
    expect(merchant.status).toBe("onboarding");
    expect(merchantId).toBeTruthy();
  });

  it("requests the checkout in Faroese", async () => {
    const { epay, createAccount } = fakeEpay();
    await createMerchant(db, epay, {
      name: "Handil",
      email: "e@handil.fo",
      domain: "handil.fo",
    });

    expect(createAccount.mock.calls[0]![0]).toMatchObject({ language: "fo" });
  });

  it("gives each merchant its own webhook secret", async () => {
    const { epay } = fakeEpay();
    await createMerchant(db, epay, {
      name: "A",
      email: "a@a.fo",
      domain: "a.fo",
    });

    const secret = db.query<{ webhook_secret: string }>(
      "SELECT webhook_secret FROM point_of_sale",
    )[0]!;

    // ePay warns partners never to share one secret across merchants, and it cannot
    // be changed via the API afterwards.
    expect(secret.webhook_secret).toMatch(/^Bearer [0-9a-f]{64}$/);
  });

  it("names the point of sale after Betal, as ePay recommends for partners", async () => {
    const { epay, createPointOfSale } = fakeEpay();
    await createMerchant(db, epay, {
      name: "Handil",
      email: "e@handil.fo",
      domain: "handil.fo",
    });

    expect(createPointOfSale.mock.calls[0]![0]).toMatchObject({ name: "Betal" });
  });

  it("registers webhooks for the events the mirror depends on", async () => {
    const { epay, createWebhook } = fakeEpay();
    await createMerchant(db, epay, {
      name: "Handil",
      email: "e@handil.fo",
      domain: "handil.fo",
    });

    const request = createWebhook.mock.calls[0]![0] as { events: string[] };
    expect(request.events).toContain("transaction.success.v1");
    expect(request.events).toContain("settlement.transfer-ready.v1");
  });

  it("attaches a price plan cloned from the template", async () => {
    const templateId = seedTemplate(db);
    const { epay } = fakeEpay();

    const { merchantId } = await createMerchant(db, epay, {
      name: "Handil",
      email: "e@handil.fo",
      domain: "handil.fo",
      pricePlanTemplateId: templateId,
    });

    const plan = db.query<Record<string, any>>(
      "SELECT * FROM price_plan WHERE merchant_id = ?",
      merchantId,
    )[0]!;
    expect(plan.is_template).toBe(0);
    expect(plan.version).toBe(1);

    const rules = db.query("SELECT * FROM price_plan_rule WHERE price_plan_id = ?", plan.id);
    expect(rules).toHaveLength(1);
  });

  it("marks acquiring manual rather than pretending it is automated", async () => {
    const { epay } = fakeEpay();
    const { merchantId } = await createMerchant(db, epay, {
      name: "Handil",
      email: "e@handil.fo",
      domain: "handil.fo",
    });

    const progress = await onboardingProgress(db, merchantId);
    const acquiring = progress.find((s) => s.step === "acquiring")!;

    // EasyOnboard has no API, and acquirer routing is backoffice-only.
    expect(acquiring.state).toBe("manual");
    expect(acquiring.automatic).toBe(false);
  });
});

describe("resumability", () => {
  it("does not repeat a step that already succeeded", async () => {
    const db = freshDatabase();
    const { epay, createPointOfSale, createWebhook } = fakeEpay();

    const { merchantId } = await createMerchant(db, epay, {
      name: "Handil",
      email: "e@handil.fo",
      domain: "handil.fo",
    });

    await provisionMerchant(db, epay, merchantId, { domain: "handil.fo" });

    // Creating a second point of sale or webhook would leave orphans at ePay.
    expect(createPointOfSale).toHaveBeenCalledOnce();
    expect(createWebhook).toHaveBeenCalledOnce();
  });

  it("records a failure and retries it on the next run", async () => {
    const db = freshDatabase();
    const createPointOfSale = vi
      .fn()
      .mockRejectedValueOnce(new Error("ePay unavailable"))
      .mockResolvedValueOnce({
        pointOfSale: {
          id: "pos-1",
          name: "Betal",
          descriptor: null,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: null,
        },
        hostedConfiguration: {},
      });

    const epay = {
      partner: {
        createAccount: vi.fn(async () => ({ id: "acct-1", status: "created" })),
      },
      forMerchant: () => ({
        createPointOfSale,
        createWebhook: vi.fn(async () => ({ id: "wh-1" })),
      }),
    } as unknown as Epay;

    const { merchantId, steps } = await createMerchant(db, epay, {
      name: "Handil",
      email: "e@handil.fo",
      domain: "handil.fo",
    });

    expect(steps.find((s) => s.step === "point_of_sale")?.state).toBe("failed");

    const retry = await provisionMerchant(db, epay, merchantId, {
      domain: "handil.fo",
    });
    expect(retry.find((s) => s.step === "point_of_sale")?.state).toBe("done");
    expect(db.query("SELECT * FROM point_of_sale")).toHaveLength(1);
  });
});

describe("activateMerchant", () => {
  it("marks the account live and audits it, since ePay starts billing here", async () => {
    const db = freshDatabase();
    const { epay, activateAccount } = fakeEpay();
    const { merchantId } = await createMerchant(db, epay, {
      name: "Handil",
      email: "e@handil.fo",
      domain: "handil.fo",
    });

    await activateMerchant(db, epay, merchantId, "ingvar@betal.fo");

    expect(activateAccount).toHaveBeenCalledWith("acct-new");
    const merchant = db.query<{ status: string; environment: string }>(
      "SELECT status, environment FROM merchant",
    )[0]!;
    expect(merchant.status).toBe("active");
    expect(merchant.environment).toBe("live");

    const audit = db.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'activate_merchant'",
    );
    expect(audit).toHaveLength(1);
  });
});

describe("clonePricePlan", () => {
  it("copies rules and detaches the clone from the template", async () => {
    const db = freshDatabase();
    seedTemplate(db);
    db.raw
      .prepare(
        `INSERT INTO merchant (id, epay_account_id, name, created_at, created_at_ms)
         VALUES ('m1', 'acct-1', 'Handil', '2026-01-01', 1)`,
      )
      .run();

    const planId = await clonePricePlan(db, "tpl", "m1");
    const plan = db.query<Record<string, any>>(
      "SELECT * FROM price_plan WHERE id = ?",
      planId,
    )[0]!;

    expect(plan.merchant_id).toBe("m1");
    expect(plan.is_template).toBe(0);
    // Editing the template later must not change a merchant's agreed pricing.
    expect(planId).not.toBe("tpl");
  });
});
