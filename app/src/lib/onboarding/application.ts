import type { Database } from "../db/types";
import { recordAudit } from "../audit";
import { upsertAcquiringApplication } from "../ops";
import { screenApplication, type Acquirer, type FinanceFlag } from "./screening";
import { verticalByKey } from "./verticals";
import { firstIncompleteStep, missingDocKinds, type StepSlug } from "./steps";
import type { EygaCompany } from "./eyga";

export interface OnboardingApplication {
  id: string;
  merchant_id: string;
  lead_id: string | null;
  state: string;
  recommended_acquirer: string | null;
  chosen_acquirer: string | null;
  country_code: string;
  legal_name: string | null;
  v_tal: string | null;
  address_line_one: string | null;
  address_line_two: string | null;
  postal_code: string | null;
  city: string | null;
  company_type: string | null;
  registry_source: string | null;
  registry_id: string | null;
  registry_status: string | null;
  registry_checked_at_ms: number | null;
  registry_snapshot: string | null;
  company_details_confirmed: number;
  policy_id: string | null;
  final_snapshot_id: string | null;
  locked_at_ms: number | null;
  website: string | null;
  sells: string | null;
  vertical_key: string | null;
  vertical_sector: number | null;
  equity: string | null;
  operations: string | null;
  bank_account: string | null;
  screening_reason: string | null;
  screening_at_ms: number | null;
  screening_by: string | null;
  extra_docs_required: number;
  reject_reason: string | null;
  request_note: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface OnboardingOwner {
  id: string;
  application_id: string;
  name: string;
  email: string | null;
  p_tal: string | null;
  role: string | null;
  ownership_bps: number | null;
  is_signatory: number;
  sort_order: number;
}

export interface OnboardingDocumentMeta {
  id: string;
  application_id: string;
  kind: string;
  required: number;
  file_name: string | null;
  content_type: string | null;
  byte_size: number | null;
  uploaded_by: string | null;
  uploaded_at_ms: number | null;
  storage: string;
  r2_key: string | null;
  sha256: string | null;
  scan_status: string;
  quarantined_at_ms: number | null;
}

export interface OnboardingSigning {
  id: string;
  application_id: string;
  provider: string;
  environment: string | null;
  signing_request_id: string | null;
  signer_token: string | null;
  signing_url: string | null;
  p_tal: string | null;
  status: string;
  last_polled_at_ms: number | null;
  created_at_ms: number;
  owner_id: string | null;
  signing_person_id: number | null;
  document_instance_id: string | null;
  provider_status_json: string | null;
  expires_at_ms: number | null;
  p_tal_ciphertext: string | null;
  p_tal_last4: string | null;
}

export interface OnboardingEvent {
  id: string;
  application_id: string;
  kind: string;
  actor_email: string | null;
  payload: string | null;
  at_ms: number;
}

export interface OnboardingAnswer {
  application_id: string;
  key: string;
  value_json: string;
  source: string;
  confirmed_at_ms: number | null;
  updated_at_ms: number;
}

export interface ApplicationPack {
  application: OnboardingApplication;
  owners: OnboardingOwner[];
  documents: OnboardingDocumentMeta[];
  signings: OnboardingSigning[];
  events: OnboardingEvent[];
  answers: OnboardingAnswer[];
}

export interface PriceList {
  id: string;
  kind: string;
  version: number;
  currency: string;
  country_code: string;
  rates_json: string;
}

export async function getApplication(
  db: Database,
  id: string,
): Promise<OnboardingApplication | null> {
  return db
    .prepare(`SELECT * FROM onboarding_application WHERE id = ?1`)
    .bind(id)
    .first<OnboardingApplication>();
}

export async function getApplicationForMerchant(
  db: Database,
  merchantId: string,
): Promise<OnboardingApplication | null> {
  return db
    .prepare(`SELECT * FROM onboarding_application WHERE merchant_id = ?1`)
    .bind(merchantId)
    .first<OnboardingApplication>();
}

export async function loadPack(db: Database, id: string): Promise<ApplicationPack | null> {
  const application = await getApplication(db, id);
  if (!application) return null;

  const [owners, documents, signings, events, answers] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM onboarding_owner WHERE application_id = ?1 ORDER BY sort_order, name`,
      )
      .bind(id)
      .all<OnboardingOwner>(),
    db
      .prepare(
        `SELECT id, application_id, kind, required, file_name, content_type, byte_size,
                uploaded_by, uploaded_at_ms, storage, r2_key, sha256, scan_status,
                quarantined_at_ms
           FROM onboarding_document WHERE application_id = ?1`,
      )
      .bind(id)
      .all<OnboardingDocumentMeta>(),
    db
      .prepare(
        `SELECT * FROM onboarding_signing WHERE application_id = ?1 ORDER BY created_at_ms DESC`,
      )
      .bind(id)
      .all<OnboardingSigning>(),
    db
      .prepare(
        `SELECT * FROM onboarding_event WHERE application_id = ?1 ORDER BY at_ms DESC LIMIT 40`,
      )
      .bind(id)
      .all<OnboardingEvent>(),
    db
      .prepare(
        `SELECT application_id, key, value_json, source, confirmed_at_ms, updated_at_ms
         FROM onboarding_answer WHERE application_id = ?1 ORDER BY key`,
      )
      .bind(id)
      .all<OnboardingAnswer>(),
  ]);

  return {
    application,
    owners: owners.results,
    documents: documents.results,
    signings: signings.results,
    events: events.results,
    answers: answers.results,
  };
}

export function answerValue<T>(
  pack: Pick<ApplicationPack, "answers">,
  key: string,
): T | null {
  const row = pack.answers.find((answer) => answer.key === key);
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

export async function saveAnswers(
  db: Database,
  applicationId: string,
  values: Record<string, unknown>,
  source = "merchant",
  now: () => number = () => Date.now(),
): Promise<void> {
  const at = now();
  const statements = Object.entries(values).map(([key, value]) =>
    db
      .prepare(
        `INSERT INTO onboarding_answer (
           application_id, key, value_json, source, confirmed_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(application_id, key) DO UPDATE SET
           value_json = excluded.value_json,
           source = excluded.source,
           confirmed_at_ms = excluded.confirmed_at_ms,
           updated_at_ms = excluded.updated_at_ms`,
      )
      .bind(applicationId, key, JSON.stringify(value), source, at)
  );
  if (statements.length > 0) await db.batch(statements);
  await touch(db, applicationId, now);
}

export async function recordEvent(
  db: Database,
  applicationId: string,
  kind: string,
  actorEmail: string | null,
  payload?: unknown,
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO onboarding_event (id, application_id, kind, actor_email, payload, at_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      crypto.randomUUID(),
      applicationId,
      kind,
      actorEmail,
      payload === undefined ? null : JSON.stringify(payload),
      now(),
    )
    .run();
}

export async function getOrCreateApplication(
  db: Database,
  merchantId: string,
  actorEmail: string | null = null,
  now: () => number = () => Date.now(),
): Promise<OnboardingApplication> {
  const existing = await getApplicationForMerchant(db, merchantId);
  if (existing) return existing;

  const merchant = await db
    .prepare(
      `SELECT legal_name, name, v_tal, address_line_one, address_line_two, postal_code,
              city, country_code, domain
         FROM merchant WHERE id = ?1`,
    )
    .bind(merchantId)
    .first<{
      legal_name: string | null;
      name: string;
      v_tal: string | null;
      address_line_one: string | null;
      address_line_two: string | null;
      postal_code: string | null;
      city: string | null;
      country_code: string | null;
      domain: string | null;
    }>();

  if (!merchant) throw new Error("Merchant not found");

  const id = crypto.randomUUID();
  const at = now();
  await db
    .prepare(
      `INSERT INTO onboarding_application (
         id, merchant_id, state, country_code, legal_name, v_tal, address_line_one,
         address_line_two, postal_code, city, website, created_at_ms, updated_at_ms
       ) VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
    )
    .bind(
      id,
      merchantId,
      merchant.country_code ?? "FO",
      merchant.legal_name ?? merchant.name,
      merchant.v_tal,
      merchant.address_line_one,
      merchant.address_line_two,
      merchant.postal_code,
      merchant.city,
      merchant.domain ? `https://${merchant.domain}` : null,
      at,
    )
    .run();

  await recordEvent(db, id, "created", actorEmail, { merchantId }, now);
  const created = await getApplication(db, id);
  if (!created) throw new Error("Failed to create application");
  return created;
}

async function touch(
  db: Database,
  id: string,
  now: () => number,
): Promise<void> {
  await db
    .prepare(`UPDATE onboarding_application SET updated_at_ms = ?2 WHERE id = ?1`)
    .bind(id, now())
    .run();
}

export async function applyScreening(
  db: Database,
  applicationId: string,
  actorEmail: string | null = "system",
  now: () => number = () => Date.now(),
): Promise<void> {
  const app = await getApplication(db, applicationId);
  if (!app) return;

  const result = screenApplication({
    sector: app.vertical_sector,
    equity: app.equity as FinanceFlag | null,
    operations: app.operations as FinanceFlag | null,
  });

  await db
    .prepare(
      `UPDATE onboarding_application
          SET recommended_acquirer = ?2,
              extra_docs_required = ?3,
              screening_reason = ?4,
              screening_at_ms = ?5,
              screening_by = ?6,
              updated_at_ms = ?5
        WHERE id = ?1`,
    )
    .bind(
      applicationId,
      result.recommended,
      result.extraDocs ? 1 : 0,
      result.reason,
      now(),
      actorEmail,
    )
    .run();

  await recordEvent(
    db,
    applicationId,
    "screened",
    actorEmail,
    { recommended: result.recommended, reason: result.reason },
    now,
  );
}

export async function saveCompany(
  db: Database,
  id: string,
  fields: {
    legal_name: string;
    v_tal: string;
    company_type: string;
    address_line_one: string;
    address_line_two?: string;
    postal_code: string;
    city: string;
  },
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE onboarding_application
          SET legal_name = ?2, v_tal = ?3, address_line_one = ?4, address_line_two = ?5,
              postal_code = ?6, city = ?7, company_type = ?8, country_code = 'FO',
              registry_source = 'manual', registry_id = NULL, registry_status = NULL,
              registry_checked_at_ms = NULL, registry_snapshot = NULL,
              company_details_confirmed = 1, updated_at_ms = ?9
        WHERE id = ?1`,
    )
    .bind(
      id,
      fields.legal_name.trim(),
      fields.v_tal.trim(),
      fields.address_line_one.trim(),
      fields.address_line_two?.trim() || null,
      fields.postal_code.trim(),
      fields.city.trim(),
      fields.company_type.trim(),
      now(),
    )
    .run();
}

/** Persist the public registry record exactly as it was confirmed. */
export async function saveEygaCompany(
  db: Database,
  id: string,
  company: EygaCompany,
  vTal: string,
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE onboarding_application
          SET legal_name = ?2, v_tal = ?3, address_line_one = ?4,
              address_line_two = NULL, postal_code = ?5, city = ?6,
              company_type = ?7, country_code = 'FO',
              registry_source = 'eyga', registry_id = ?8, registry_status = ?9,
              registry_checked_at_ms = ?10, registry_snapshot = ?11,
              company_details_confirmed = 1, updated_at_ms = ?10
        WHERE id = ?1`,
    )
    .bind(
      id,
      company.name,
      vTal.trim(),
      company.address || null,
      company.postalCode,
      company.city,
      company.companyType,
      company.id,
      company.status,
      now(),
      JSON.stringify(company),
    )
    .run();
}

export async function saveBusinessProfile(
  db: Database,
  id: string,
  verticalKey: string,
  sells: string,
  website: string,
  actorEmail: string | null,
  now: () => number = () => Date.now(),
): Promise<void> {
  const vertical = verticalByKey(verticalKey);
  if (!vertical) throw new Error("Ókend vinnugrein");

  await db
    .prepare(
      `UPDATE onboarding_application
          SET vertical_key = ?2, vertical_sector = ?3, sells = ?4, website = ?5,
              updated_at_ms = ?6
        WHERE id = ?1`,
    )
    .bind(
      id,
      vertical.key,
      vertical.sector,
      sells.trim(),
      website.trim() || null,
      now(),
    )
    .run();

  await applyScreening(db, id, actorEmail, now);
}

/** Kept for staff/tests that only change the screening category. */
export async function saveVertical(
  db: Database,
  id: string,
  verticalKey: string,
  actorEmail: string | null,
  now: () => number = () => Date.now(),
): Promise<void> {
  const app = await getApplication(db, id);
  if (!app) throw new Error("Umsókn ikki funnin");
  await saveBusinessProfile(
    db,
    id,
    verticalKey,
    app.sells ?? "",
    app.website ?? "",
    actorEmail,
    now,
  );
}

export async function saveOwners(
  db: Database,
  applicationId: string,
  owners: Array<{
    name: string;
    email?: string;
    p_tal?: string;
    role?: string;
    ownership_bps?: number | null;
    is_signatory?: boolean;
  }>,
  now: () => number = () => Date.now(),
): Promise<void> {
  const cleaned = owners.filter((owner) => owner.name.trim());
  await db
    .prepare(`DELETE FROM onboarding_owner WHERE application_id = ?1`)
    .bind(applicationId)
    .run();

  for (const [index, owner] of cleaned.entries()) {
    await db
      .prepare(
        `INSERT INTO onboarding_owner (
           id, application_id, name, email, p_tal, role, ownership_bps,
           is_signatory, sort_order
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        crypto.randomUUID(),
        applicationId,
        owner.name.trim(),
        owner.email?.trim() || null,
        owner.p_tal?.trim() || null,
        owner.role?.trim() || null,
        owner.ownership_bps ?? null,
        owner.is_signatory ? 1 : 0,
        index,
      )
      .run();
  }

  await touch(db, applicationId, now);
}

export async function saveFinances(
  db: Database,
  id: string,
  equity: FinanceFlag,
  operations: FinanceFlag,
  actorEmail: string | null,
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE onboarding_application
          SET equity = ?2, operations = ?3, updated_at_ms = ?4
        WHERE id = ?1`,
    )
    .bind(id, equity, operations, now())
    .run();

  await applyScreening(db, id, actorEmail, now);
}

export async function saveBank(
  db: Database,
  id: string,
  account: string,
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE onboarding_application SET bank_account = ?2, updated_at_ms = ?3 WHERE id = ?1`,
    )
    .bind(id, account.trim(), now())
    .run();
}

export async function acknowledgeReroute(
  db: Database,
  id: string,
  actorEmail: string | null,
  now: () => number = () => Date.now(),
): Promise<void> {
  await recordEvent(db, id, "acknowledged_reroute", actorEmail, undefined, now);
  await db
    .prepare(
      `UPDATE onboarding_application SET state = 'pack_ready', updated_at_ms = ?2 WHERE id = ?1`,
    )
    .bind(id, now())
    .run();
}

export async function markWetInk(
  db: Database,
  id: string,
  actorEmail: string | null,
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO onboarding_signing (
         id, application_id, provider, status, created_at_ms
       ) VALUES (?1, ?2, 'wet_ink', 'wet_ink', ?3)`,
    )
    .bind(crypto.randomUUID(), id, now())
    .run();

  await db
    .prepare(
      `UPDATE onboarding_application SET state = 'pack_ready', updated_at_ms = ?2 WHERE id = ?1`,
    )
    .bind(id, now())
    .run();

  await recordEvent(db, id, "wet_ink", actorEmail, undefined, now);
}

export async function resumeStep(pack: ApplicationPack): Promise<StepSlug> {
  return firstIncompleteStep(pack);
}

export interface QueueRow {
  id: string;
  merchant_id: string;
  merchant_name: string;
  state: string;
  recommended_acquirer: string | null;
  equity: string | null;
  operations: string | null;
  vertical_sector: number | null;
  created_at_ms: number;
  updated_at_ms: number;
  missing_docs: number;
}

export async function listApplications(db: Database): Promise<QueueRow[]> {
  const rows = await db
    .prepare(
      `SELECT a.id, a.merchant_id, m.name AS merchant_name, a.state,
              a.recommended_acquirer, a.equity, a.operations, a.vertical_sector,
              a.created_at_ms, a.updated_at_ms
         FROM onboarding_application a
         JOIN merchant m ON m.id = a.merchant_id
        ORDER BY a.updated_at_ms DESC`,
    )
    .all<Omit<QueueRow, "missing_docs">>();

  const packs = await Promise.all(rows.results.map((row) => loadPack(db, row.id)));
  return rows.results.map((row, index) => {
    const pack = packs[index];
    return {
      ...row,
      missing_docs: pack ? missingDocKinds(pack).length : 0,
    };
  });
}

export async function staffSetSector(
  db: Database,
  id: string,
  sector: number,
  actorEmail: string,
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE onboarding_application SET vertical_sector = ?2, updated_at_ms = ?3 WHERE id = ?1`,
    )
    .bind(id, sector, now())
    .run();
  await applyScreening(db, id, actorEmail, now);
  await recordEvent(db, id, "staff_sector", actorEmail, { sector }, now);
}

export async function staffAction(
  db: Database,
  input: {
    applicationId: string;
    actor: { id: string; email: string; role: string };
    action: "submit" | "reroute" | "reject" | "request_docs";
    acquirer?: Acquirer;
    reason?: string;
    externalRef?: string;
  },
  now: () => number = () => Date.now(),
): Promise<void> {
  const app = await getApplication(db, input.applicationId);
  if (!app) throw new Error("Umsókn ikki funnin");

  const at = now();

  if (input.action === "submit") {
    if (app.state !== "pack_ready") {
      throw new Error("Pakkin er ikki klárur at senda");
    }
    const acquirer = (input.acquirer ?? app.chosen_acquirer ?? app.recommended_acquirer ??
      "swedbank") as string;
    await db
      .prepare(
        `UPDATE onboarding_application
            SET state = 'submitted', chosen_acquirer = ?2, updated_at_ms = ?3
          WHERE id = ?1`,
      )
      .bind(input.applicationId, acquirer, at)
      .run();
    await upsertAcquiringApplication(db, {
      merchantId: app.merchant_id,
      acquirer,
      state: "submitted",
      externalRef: input.externalRef,
      notes: input.reason,
    }, now);
    await recordEvent(db, input.applicationId, "submitted", input.actor.email, {
      acquirer,
      externalRef: input.externalRef,
    }, now);
  } else if (input.action === "reroute") {
    const acquirer = input.acquirer ?? "clearhaus";
    await db
      .prepare(
        `UPDATE onboarding_application
            SET state = 'routed', chosen_acquirer = ?2, recommended_acquirer = ?2,
                updated_at_ms = ?3
          WHERE id = ?1`,
      )
      .bind(input.applicationId, acquirer, at)
      .run();
    await upsertAcquiringApplication(db, {
      merchantId: app.merchant_id,
      acquirer,
      state: "collecting",
      notes: input.reason,
    }, now);
    await recordEvent(db, input.applicationId, "rerouted", input.actor.email, {
      acquirer,
      reason: input.reason,
    }, now);
  } else if (input.action === "reject") {
    await db
      .prepare(
        `UPDATE onboarding_application
            SET state = 'rejected', reject_reason = ?2, updated_at_ms = ?3
          WHERE id = ?1`,
      )
      .bind(input.applicationId, input.reason ?? null, at)
      .run();
    await upsertAcquiringApplication(db, {
      merchantId: app.merchant_id,
      acquirer: app.chosen_acquirer ?? app.recommended_acquirer ?? "swedbank",
      state: "rejected",
      notes: input.reason,
    }, now);
    await recordEvent(db, input.applicationId, "rejected", input.actor.email, {
      reason: input.reason,
    }, now);
  } else {
    await db
      .prepare(
        `UPDATE onboarding_submission_snapshot
         SET state = 'superseded'
         WHERE application_id = ?1 AND state = 'final'`,
      )
      .bind(input.applicationId)
      .run();
    await db
      .prepare(
        `UPDATE onboarding_application
            SET state = 'more_info', request_note = ?2, updated_at_ms = ?3,
                final_snapshot_id = NULL, locked_at_ms = NULL
          WHERE id = ?1`,
      )
      .bind(input.applicationId, input.reason ?? null, at)
      .run();
    await recordEvent(db, input.applicationId, "docs_requested", input.actor.email, {
      reason: input.reason,
    }, now);
  }

  await recordAudit(db, {
    actorUserId: input.actor.id,
    actorEmail: input.actor.email,
    merchantId: app.merchant_id,
    action: "review_application",
    subjectType: "onboarding_application",
    subjectId: input.applicationId,
    detail: { action: input.action, reason: input.reason },
  }, now);
}

export async function getActivePriceList(
  db: Database,
  kind: "standard" | "sector2",
): Promise<PriceList | null> {
  return db
    .prepare(
      `SELECT * FROM acquiring_price_list
        WHERE kind = ?1
        ORDER BY version DESC
        LIMIT 1`,
    )
    .bind(kind)
    .first<PriceList>();
}

export function priceListHasRates(list: PriceList | null): boolean {
  if (!list) return false;
  try {
    const rates = JSON.parse(list.rates_json) as unknown;
    if (Array.isArray(rates)) return rates.length > 0;
    if (!rates || typeof rates !== "object") return false;
    const cardRates = (rates as Record<string, unknown>).cardRates;
    return Boolean(
      cardRates &&
      typeof cardRates === "object" &&
      Object.keys(cardRates as Record<string, unknown>).length > 0,
    );
  } catch {
    return false;
  }
}

export function parsePriceRates(
  list: PriceList | null,
): Array<{ label: string; rate_bps?: number; text?: string }> {
  if (!list) return [];
  try {
    const rates = JSON.parse(list.rates_json) as Array<{
      label: string;
      rate_bps?: number;
      text?: string;
    }>;
    return Array.isArray(rates) ? rates : [];
  } catch {
    return [];
  }
}
