import type { Database } from "../db/types";
import {
  priceListHasRates,
  type ApplicationPack,
  type PriceList,
} from "./application";
import { sha256 } from "./documents";
import type { DocumentTemplate } from "./swedbank";
import { isStepComplete, type StepSlug } from "./steps";

export interface SubmissionSnapshot {
  id: string;
  application_id: string;
  policy_id: string;
  price_list_id: string | null;
  agreement_template_id: string;
  signer_set_json: string;
  payload_json: string;
  sha256: string;
  state: string;
  locked_by: string | null;
  created_at_ms: number;
  finalized_at_ms: number | null;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sorted(child)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sorted(value));
}

export async function getActivePolicy(db: Database): Promise<{
  id: string;
  version: number;
  requirements_json: string;
} | null> {
  return db
    .prepare(
      `SELECT id, version, requirements_json
       FROM onboarding_policy
       WHERE acquirer = 'swedbank' AND country_code = 'FO' AND active = 1
       ORDER BY version DESC LIMIT 1`,
    )
    .first();
}

export async function getFinalSnapshot(
  db: Database,
  applicationId: string,
): Promise<SubmissionSnapshot | null> {
  return db
    .prepare(
      `SELECT * FROM onboarding_submission_snapshot
       WHERE application_id = ?1 AND state = 'final'
       ORDER BY created_at_ms DESC LIMIT 1`,
    )
    .bind(applicationId)
    .first<SubmissionSnapshot>();
}

export async function createFinalSnapshot(
  db: Database,
  input: {
    pack: ApplicationPack;
    policyId: string;
    priceList: PriceList | null;
    agreementTemplate: DocumentTemplate;
    actorEmail: string;
  },
  now: () => number = () => Date.now(),
): Promise<SubmissionSnapshot> {
  const existing = await getFinalSnapshot(db, input.pack.application.id);
  if (existing) return existing;
  if (!priceListHasRates(input.priceList)) {
    throw new Error("Príslistin er ikki góðkendur");
  }
  const requiredSteps: StepSlug[] = [
    "felag",
    "vinnugrein",
    "eigarar",
    "roknskapur",
    "banki",
    "skjol",
  ];
  if (requiredSteps.some((step) => !isStepComplete(step, input.pack))) {
    throw new Error("Umsóknin manglar upplýsingar ella skjøl");
  }
  if (
    input.pack.documents.some(
      (document) =>
        document.required &&
        (
          !document.sha256 ||
          !["basic_validated", "provider_verified"].includes(document.scan_status) ||
          document.quarantined_at_ms
        ),
    )
  ) {
    throw new Error("Eitt kravt skjal er ikki góðkent í skjalagoymsluni");
  }

  const signers = input.pack.owners
    .filter((owner) => owner.is_signatory)
    .map((owner) => ({
      ownerId: owner.id,
      name: owner.name,
      email: owner.email,
      ownershipBps: owner.ownership_bps,
      role: owner.role,
    }));
  if (signers.length === 0 || signers.some((signer) => !signer.email)) {
    throw new Error("Undirskrivarar og teldupostar mangla");
  }

  const payload = {
    application: input.pack.application,
    answers: Object.fromEntries(
      input.pack.answers.map((answer) => {
        let value: unknown = null;
        try {
          value = JSON.parse(answer.value_json);
        } catch {
          value = null;
        }
        return [answer.key, { value, source: answer.source }];
      }),
    ),
    owners: input.pack.owners.map((owner) => ({
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: owner.role,
      ownershipBps: owner.ownership_bps,
      isSignatory: Boolean(owner.is_signatory),
    })),
    documents: input.pack.documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      sha256: document.sha256,
      byteSize: document.byte_size,
      scanStatus: document.scan_status,
    })),
    policyId: input.policyId,
    priceList: {
      id: input.priceList!.id,
      kind: input.priceList!.kind,
      version: input.priceList!.version,
      rates: JSON.parse(input.priceList!.rates_json),
    },
    agreementTemplate: {
      id: input.agreementTemplate.id,
      version: input.agreementTemplate.version,
      sha256: input.agreementTemplate.source_sha256,
    },
    signers,
  };
  const payloadJson = canonicalJson(payload);
  const digest = await sha256(new TextEncoder().encode(payloadJson));
  const id = crypto.randomUUID();
  const at = now();

  await db
    .prepare(
      `INSERT INTO onboarding_submission_snapshot (
         id, application_id, policy_id, price_list_id, agreement_template_id,
         signer_set_json, payload_json, sha256, state, locked_by,
         created_at_ms, finalized_at_ms
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'final', ?9, ?10, ?10)`,
    )
    .bind(
      id,
      input.pack.application.id,
      input.policyId,
      input.priceList!.id,
      input.agreementTemplate.id,
      canonicalJson(signers),
      payloadJson,
      digest,
      input.actorEmail,
      at,
    )
    .run();

  await db
    .prepare(
      `UPDATE onboarding_application
       SET policy_id = ?2, final_snapshot_id = ?3, locked_at_ms = ?4,
           state = 'ready_for_signing', updated_at_ms = ?4
       WHERE id = ?1`,
    )
    .bind(input.pack.application.id, input.policyId, id, at)
    .run();

  const created = await getFinalSnapshot(db, input.pack.application.id);
  if (!created) throw new Error("Umsóknin kundi ikki gerast klár");
  return created;
}

export async function supersedeFinalSnapshot(
  db: Database,
  applicationId: string,
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE onboarding_submission_snapshot
       SET state = 'superseded'
       WHERE application_id = ?1 AND state = 'final'`,
    )
    .bind(applicationId)
    .run();
  await db
    .prepare(
      `UPDATE onboarding_application
       SET final_snapshot_id = NULL, locked_at_ms = NULL, state = 'collecting',
           updated_at_ms = ?2
       WHERE id = ?1`,
    )
    .bind(applicationId, now())
    .run();
}
