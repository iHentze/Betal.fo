import type { Database, ObjectBucket } from "../db/types";
import { loadPack, recordEvent } from "./application";
import { putDocument } from "./documents";
import { storeSignedDocumentInstance } from "./document-instances";
import { encryptPersonalIdentificationNumber } from "./identity-crypto";
import {
  SkrivaClient,
  SkrivaError,
  skrivaConfig,
  type SkrivaConfig,
} from "./skriva";

export interface SigningRuntime {
  DB: Database;
  DOCUMENTS?: ObjectBucket;
  IDENTITY_ENCRYPTION_KEY?: string;
  SKRIVA_BASE_URL?: string;
  SKRIVA_EMAIL?: string;
  SKRIVA_PASSWORD?: string;
  SKRIVA_TENANT_ID?: string;
}

export async function refreshSkrivaApplication(
  runtime: SigningRuntime,
  applicationId: string,
  actorEmail: string,
  clientFactory: (config: SkrivaConfig) => SkrivaClient =
    (config) => new SkrivaClient(config),
): Promise<{ state: "pending" | "signed"; pending: number }> {
  const pack = await loadPack(runtime.DB, applicationId);
  if (!pack) throw new SkrivaError("Umsóknin varð ikki funnin", 404);
  const latestRequestId = pack.signings.find(
    (row) => row.provider === "skriva" && row.signing_request_id,
  )?.signing_request_id;
  const rows = pack.signings.filter(
    (row) =>
      row.provider === "skriva" &&
      row.signing_request_id === latestRequestId &&
      row.signer_token,
  );
  if (rows.length === 0) throw new SkrivaError("Eingin Skriva-undirskrift er stovnað");

  const client = clientFactory(skrivaConfig(runtime));
  const statuses = [];
  for (const row of rows) {
    const status = await client.signingStatus(row.signer_token!);
    statuses.push({ row, status });
    let identity: { ciphertext: string; last4: string } | null = null;
    if (status.personalIdentificationNumber) {
      if (!runtime.IDENTITY_ENCRYPTION_KEY) {
        throw new Error("Dátulykil til Samleikan manglar");
      }
      identity = await encryptPersonalIdentificationNumber(
        status.personalIdentificationNumber,
        runtime.IDENTITY_ENCRYPTION_KEY,
      );
    }
    await runtime.DB
      .prepare(
        `UPDATE onboarding_signing
         SET status = ?2, p_tal = NULL, p_tal_ciphertext = COALESCE(?3, p_tal_ciphertext),
             p_tal_last4 = COALESCE(?4, p_tal_last4), last_polled_at_ms = ?5,
             provider_status_json = ?6
         WHERE id = ?1`,
      )
      .bind(
        row.id,
        status.state,
        identity?.ciphertext,
        identity?.last4,
        Date.now(),
        JSON.stringify(status.raw),
      )
      .run();
  }

  const selectedOwnerIds = new Set(
    pack.owners.filter((owner) => owner.is_signatory).map((owner) => owner.id),
  );
  const fullySigned =
    statuses.length === selectedOwnerIds.size &&
    statuses.every(
      ({ row, status }) =>
        status.state === "signed" &&
        Boolean(row.owner_id) &&
        selectedOwnerIds.has(row.owner_id!),
    );
  const alreadyStored = pack.events.some((event) => event.kind === "skriva_signed");
  if (fullySigned && !alreadyStored) {
    const first = rows[0]!;
    const requestId = Number(first.signing_request_id);
    if (!Number.isInteger(requestId)) throw new SkrivaError("Ógilt Skriva-nummar");
    if (!first.document_instance_id) {
      throw new SkrivaError("Skjalatilvísingin hjá Skriva manglar");
    }
    const pdf = await client.downloadSignedPdf(requestId, first.signer_token!);
    await storeSignedDocumentInstance(
      runtime.DB,
      runtime.DOCUMENTS,
      first.document_instance_id,
      pdf,
    );
    await putDocument(runtime.DB, {
      applicationId,
      kind: "agreement",
      fileName: "kortinnloysing-fo-undirskrivad.pdf",
      contentType: "application/pdf",
      bytes: pdf,
      uploadedBy: "skriva",
      scanStatus: "provider_verified",
    }, { bucket: runtime.DOCUMENTS });
    const at = Date.now();
    await runtime.DB
      .prepare(
        `UPDATE onboarding_application
         SET state = 'pack_ready', updated_at_ms = ?2 WHERE id = ?1`,
      )
      .bind(applicationId, at)
      .run();
    await recordEvent(runtime.DB, applicationId, "skriva_signed", actorEmail, {
      signingRequestId: requestId,
    }, () => at);
    return { state: "signed", pending: 0 };
  }

  const pending = statuses.filter(
    ({ status }) => status.state === "sent" || status.state === "viewed",
  ).length;
  if (pending === 0 && !fullySigned) {
    await runtime.DB
      .prepare(
        `UPDATE onboarding_application
         SET state = 'ready_for_signing', updated_at_ms = ?2
         WHERE id = ?1 AND state = 'signing'`,
      )
      .bind(applicationId, Date.now())
      .run();
  }
  return {
    state: fullySigned ? "signed" : "pending",
    pending,
  };
}
