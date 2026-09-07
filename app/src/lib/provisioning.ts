import type { Database } from "./db/types";
import type { Epay } from "./epay";
import { generateWebhookSecret } from "./ingest/verify";
import { recordAudit } from "./audit";

/**
 * Merchant onboarding.
 *
 * Runs as a sequence of recorded steps rather than one transaction, because it spans
 * several ePay calls that cannot be rolled back. `POST /partner/accounts` documents no
 * idempotency support, so a naive retry would create a second merchant account with no
 * way to tell which one is real. Every step is therefore recorded the moment it
 * succeeds, and a resumed run skips what is already done.
 *
 * Two steps cannot be automated, and both are recorded as `manual` rather than
 * pretended away:
 *
 *   * **acquiring** — EasyOnboard has no API. It is a portal flow, white-labelled only
 *     by agreement with ePay.
 *   * **acquirer routing** — `processor` is deprecated and routing rules live in the
 *     ePay backoffice with no API replacement, so placing a merchant with the acquirer
 *     that suits them is a human step.
 */

export type StepName =
  | "epay_account"
  | "point_of_sale"
  | "webhook"
  | "price_plan"
  | "acquiring"
  | "test_payment";

export type StepState = "pending" | "running" | "done" | "failed" | "manual";

export const ONBOARDING_STEPS: Array<{
  step: StepName;
  label: string;
  automatic: boolean;
}> = [
  { step: "epay_account", label: "ePay-konta stovnað", automatic: true },
  { step: "point_of_sale", label: "Sølustað sett upp", automatic: true },
  { step: "webhook", label: "Hendingar skrásettar", automatic: true },
  { step: "price_plan", label: "Prísskipan knýtt", automatic: true },
  // Manual: EasyOnboard has no API, and acquirer routing is backoffice-only.
  { step: "acquiring", label: "Innloysingaravtala", automatic: false },
  { step: "test_payment", label: "Roynd gjalding", automatic: true },
];

export interface ProvisionInput {
  name: string;
  email: string;
  domain: string;
  vTal?: string;
  legalName?: string;
  currency?: string;
  timezone?: string;
  environment?: "test" | "live";
  pricePlanTemplateId?: string;
  actorEmail?: string;
}

export interface StepResult {
  step: StepName;
  state: StepState;
  result?: Record<string, unknown>;
  error?: string;
}

async function recordStep(
  db: Database,
  merchantId: string,
  step: StepName,
  state: StepState,
  payload: { result?: unknown; error?: string } = {},
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO onboarding_step (id, merchant_id, step, state, result, error,
                                    started_at_ms, done_at_ms, attempts)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
       ON CONFLICT (merchant_id, step) DO UPDATE SET
         state = excluded.state,
         result = COALESCE(excluded.result, onboarding_step.result),
         error = excluded.error,
         done_at_ms = excluded.done_at_ms,
         attempts = onboarding_step.attempts + 1`,
    )
    .bind(
      `${merchantId}:${step}`,
      merchantId,
      step,
      state,
      payload.result === undefined ? null : JSON.stringify(payload.result),
      payload.error ?? null,
      now(),
      state === "done" || state === "manual" ? now() : null,
    )
    .run();
}

async function stepDone(
  db: Database,
  merchantId: string,
  step: StepName,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(
      `SELECT state, result FROM onboarding_step
        WHERE merchant_id = ?1 AND step = ?2 AND state IN ('done', 'manual')`,
    )
    .bind(merchantId, step)
    .first<{ state: string; result: string | null }>();

  if (!row) return null;
  return row.result ? (JSON.parse(row.result) as Record<string, unknown>) : {};
}

/**
 * Creates the merchant record and its ePay account.
 *
 * The local record is written first and the returned ePay account id stored
 * immediately, so a crash between the two leaves an obvious orphan to reconcile rather
 * than an untraceable account under our partner profile.
 */
export async function createMerchant(
  db: Database,
  epay: Epay,
  input: ProvisionInput,
  now: () => number = () => Date.now(),
): Promise<{ merchantId: string; steps: StepResult[] }> {
  const merchantId = crypto.randomUUID();
  const environment = input.environment ?? "test";
  const timestamp = new Date(now()).toISOString();

  const account = await epay.partner.createAccount({
    name: input.name,
    email: input.email,
    currencyCode: input.currency ?? "DKK",
    timezone: input.timezone ?? "Atlantic/Faroe",
    domain: input.domain,
    language: "fo",
  });

  await db
    .prepare(
      `INSERT INTO merchant (id, epay_account_id, name, legal_name, environment,
                             epay_status, status, currency, timezone, domain,
                             v_tal, country_code, created_at, created_at_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'onboarding', ?7, ?8, ?9, ?10, 'FO', ?11, ?12)`,
    )
    .bind(
      merchantId,
      account.id,
      input.name,
      input.legalName ?? input.name,
      environment,
      account.status,
      input.currency ?? "DKK",
      input.timezone ?? "Atlantic/Faroe",
      input.domain,
      input.vTal ?? null,
      timestamp,
      now(),
    )
    .run();

  await recordStep(
    db,
    merchantId,
    "epay_account",
    "done",
    { result: { accountId: account.id } },
    now,
  );

  await recordAudit(
    db,
    {
      actorEmail: input.actorEmail ?? "system",
      merchantId,
      action: "create_merchant",
      subjectType: "merchant",
      subjectId: merchantId,
      detail: { epayAccountId: account.id, environment },
    },
    now,
  );

  const steps = await provisionMerchant(db, epay, merchantId, input, now);
  return { merchantId, steps };
}

/**
 * Runs the remaining provisioning steps, skipping any already done.
 *
 * Safe to call repeatedly: this is both the continuation of a fresh onboarding and the
 * retry path when a step failed.
 */
export async function provisionMerchant(
  db: Database,
  epay: Epay,
  merchantId: string,
  input: Pick<ProvisionInput, "domain" | "pricePlanTemplateId" | "actorEmail">,
  now: () => number = () => Date.now(),
): Promise<StepResult[]> {
  const merchant = await db
    .prepare(
      `SELECT epay_account_id, environment, domain FROM merchant WHERE id = ?1`,
    )
    .bind(merchantId)
    .first<{ epay_account_id: string; environment: string; domain: string | null }>();

  if (!merchant) throw new Error(`Unknown merchant ${merchantId}`);

  const environment = merchant.environment === "live" ? "live" : "test";
  const client = epay.forMerchant(merchant.epay_account_id, environment);
  const steps: StepResult[] = [];

  // --- Point of sale -------------------------------------------------------
  let pointOfSaleId: string | undefined;
  const existingPos = await stepDone(db, merchantId, "point_of_sale");

  if (existingPos) {
    pointOfSaleId = existingPos.pointOfSaleId as string;
    steps.push({ step: "point_of_sale", state: "done", result: existingPos });
  } else {
    try {
      // A distinct secret per merchant: ePay explicitly warns partners not to share
      // one, and it is write-once via the API, so it has to be right first time.
      const secret = generateWebhookSecret();
      const created = await client.createPointOfSale({
        // ePay recommends partners name the point of sale after themselves, so both
        // the merchant and ePay support can tell where it came from.
        name: "Betal",
        domain: input.domain ?? merchant.domain ?? "betal.fo",
        webhookAuthentication: secret,
      });

      pointOfSaleId = created.pointOfSale.id;

      await db
        .prepare(
          `INSERT INTO point_of_sale (id, merchant_id, name, descriptor, domain,
                                      webhook_secret, hosted_configuration,
                                      created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT (id) DO UPDATE SET webhook_secret = excluded.webhook_secret`,
        )
        .bind(
          created.pointOfSale.id,
          merchantId,
          created.pointOfSale.name,
          created.pointOfSale.descriptor ?? null,
          input.domain ?? merchant.domain ?? null,
          secret,
          JSON.stringify(created.hostedConfiguration ?? {}),
          created.pointOfSale.createdAt,
          created.pointOfSale.updatedAt ?? null,
        )
        .run();

      await recordStep(
        db,
        merchantId,
        "point_of_sale",
        "done",
        { result: { pointOfSaleId } },
        now,
      );
      steps.push({ step: "point_of_sale", state: "done", result: { pointOfSaleId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordStep(db, merchantId, "point_of_sale", "failed", { error: message }, now);
      steps.push({ step: "point_of_sale", state: "failed", error: message });
      return steps;
    }
  }

  // --- Webhook -------------------------------------------------------------
  if (await stepDone(db, merchantId, "webhook")) {
    steps.push({ step: "webhook", state: "done" });
  } else {
    try {
      const secretRow = await db
        .prepare(`SELECT webhook_secret FROM point_of_sale WHERE id = ?1`)
        .bind(pointOfSaleId!)
        .first<{ webhook_secret: string }>();

      const webhook = await client.createWebhook({
        url: `https://app.betal.fo/api/hooks/${merchantId}?channel=event`,
        events: [
          "transaction.success.v1",
          "transaction.failed.v1",
          "transaction.captured.v1",
          "transaction.refunded.v1",
          "transaction.voided.v1",
          "settlement.transfer-ready.v1",
        ],
        secret: secretRow?.webhook_secret ?? generateWebhookSecret(),
      });

      await recordStep(
        db,
        merchantId,
        "webhook",
        "done",
        { result: { webhookId: webhook.id } },
        now,
      );
      steps.push({ step: "webhook", state: "done" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordStep(db, merchantId, "webhook", "failed", { error: message }, now);
      steps.push({ step: "webhook", state: "failed", error: message });
    }
  }

  // --- Price plan ----------------------------------------------------------
  if (await stepDone(db, merchantId, "price_plan")) {
    steps.push({ step: "price_plan", state: "done" });
  } else if (input.pricePlanTemplateId) {
    const planId = await clonePricePlan(
      db,
      input.pricePlanTemplateId,
      merchantId,
      now,
    );
    await recordStep(db, merchantId, "price_plan", "done", { result: { planId } }, now);
    steps.push({ step: "price_plan", state: "done", result: { planId } });
  } else {
    steps.push({ step: "price_plan", state: "pending" });
  }

  // --- Acquiring -----------------------------------------------------------
  // Cannot be automated: EasyOnboard has no API and acquirer routing is a backoffice
  // step. Recorded so it appears on the checklist rather than being forgotten.
  if (!(await stepDone(db, merchantId, "acquiring"))) {
    await recordStep(db, merchantId, "acquiring", "manual", {}, now);
  }
  steps.push({ step: "acquiring", state: "manual" });

  return steps;
}

/** Copies a template plan and its rules onto a merchant as version 1. */
export async function clonePricePlan(
  db: Database,
  templateId: string,
  merchantId: string,
  now: () => number = () => Date.now(),
): Promise<string> {
  const template = await db
    .prepare(`SELECT * FROM price_plan WHERE id = ?1`)
    .bind(templateId)
    .first<Record<string, any>>();

  if (!template) throw new Error(`Unknown price plan template ${templateId}`);

  const rules = await db
    .prepare(
      `SELECT position, kind, label, params FROM price_plan_rule
        WHERE price_plan_id = ?1 ORDER BY position`,
    )
    .bind(templateId)
    .all<{ position: number; kind: string; label: string; params: string }>();

  const planId = crypto.randomUUID();
  const timestamp = new Date(now()).toISOString();

  const statements = [
    db
      .prepare(
        `INSERT INTO price_plan (id, merchant_id, name, version, is_template, currency,
                                 billable_states, billable_types, bill_refunds,
                                 effective_from, created_at)
         VALUES (?1, ?2, ?3, 1, 0, ?4, ?5, ?6, ?7, ?8, ?8)`,
      )
      .bind(
        planId,
        merchantId,
        template.name,
        template.currency,
        template.billable_states,
        template.billable_types,
        template.bill_refunds,
        timestamp,
      ),
  ];

  for (const rule of rules.results) {
    statements.push(
      db
        .prepare(
          `INSERT INTO price_plan_rule (id, price_plan_id, position, kind, label,
                                        params, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(
          crypto.randomUUID(),
          planId,
          rule.position,
          rule.kind,
          rule.label,
          rule.params,
          timestamp,
        ),
    );
  }

  await db.batch(statements);
  return planId;
}

export interface OnboardingProgress {
  step: StepName;
  label: string;
  automatic: boolean;
  state: StepState;
  error: string | null;
}

/** The onboarding checklist, for the merchant detail screen. */
export async function onboardingProgress(
  db: Database,
  merchantId: string,
): Promise<OnboardingProgress[]> {
  const rows = await db
    .prepare(
      `SELECT step, state, error FROM onboarding_step WHERE merchant_id = ?1`,
    )
    .bind(merchantId)
    .all<{ step: string; state: StepState; error: string | null }>();

  const byStep = new Map(rows.results.map((row) => [row.step, row]));

  return ONBOARDING_STEPS.map((definition) => {
    const row = byStep.get(definition.step);
    return {
      ...definition,
      state: row?.state ?? "pending",
      error: row?.error ?? null,
    };
  });
}

/**
 * Marks the merchant live.
 *
 * Deliberately separate from provisioning: ePay begins billing at activation, so it is
 * a decision rather than a step that happens automatically once the plumbing works.
 */
export async function activateMerchant(
  db: Database,
  epay: Epay,
  merchantId: string,
  actorEmail: string,
  now: () => number = () => Date.now(),
): Promise<void> {
  const merchant = await db
    .prepare(`SELECT epay_account_id FROM merchant WHERE id = ?1`)
    .bind(merchantId)
    .first<{ epay_account_id: string }>();

  if (!merchant) throw new Error(`Unknown merchant ${merchantId}`);

  await epay.partner.activateAccount(merchant.epay_account_id);

  await db
    .prepare(
      `UPDATE merchant SET status = 'active', environment = 'live' WHERE id = ?1`,
    )
    .bind(merchantId)
    .run();

  await recordAudit(
    db,
    {
      actorEmail,
      merchantId,
      action: "activate_merchant",
      subjectType: "merchant",
      subjectId: merchantId,
      detail: { note: "ePay billing starts at activation" },
    },
    now,
  );
}
