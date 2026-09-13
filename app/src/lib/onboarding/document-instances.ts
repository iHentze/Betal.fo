import type { Database, ObjectBucket } from "../db/types";
import { sha256 } from "./documents";

export interface DocumentInstance {
  id: string;
  application_id: string;
  template_id: string | null;
  snapshot_id: string | null;
  kind: string;
  state: string;
  r2_key: string;
  sha256: string;
  byte_size: number;
  generated_at_ms: number;
  signed_at_ms: number | null;
  created_by: string | null;
}

export async function createDocumentInstance(
  db: Database,
  bucket: ObjectBucket | undefined,
  input: {
    applicationId: string;
    templateId: string;
    snapshotId: string;
    kind: string;
    state: "preview" | "final";
    bytes: Uint8Array;
    createdBy: string;
  },
  now: () => number = () => Date.now(),
): Promise<DocumentInstance> {
  if (!bucket) throw new Error("Skjalagoymslan er ikki sett upp");
  const id = crypto.randomUUID();
  const digest = await sha256(input.bytes);
  const key = `onboarding/${input.applicationId}/instances/${id}.pdf`;
  const at = now();
  await bucket.put(key, input.bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: {
      applicationId: input.applicationId,
      kind: input.kind,
      state: input.state,
      sha256: digest,
    },
  });
  try {
    await db
      .prepare(
        `INSERT INTO document_instance (
           id, application_id, template_id, snapshot_id, kind, state, r2_key,
           sha256, byte_size, generated_at_ms, created_by
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(
        id,
        input.applicationId,
        input.templateId,
        input.snapshotId,
        input.kind,
        input.state,
        key,
        digest,
        input.bytes.byteLength,
        at,
        input.createdBy,
      )
      .run();
  } catch (error) {
    await bucket.delete(key);
    throw error;
  }
  const row = await db
    .prepare(`SELECT * FROM document_instance WHERE id = ?1`)
    .bind(id)
    .first<DocumentInstance>();
  if (!row) throw new Error("Skjalið kundi ikki goymast");
  return row;
}

export async function storeSignedDocumentInstance(
  db: Database,
  bucket: ObjectBucket | undefined,
  instanceId: string,
  bytes: Uint8Array,
  now: () => number = () => Date.now(),
): Promise<DocumentInstance> {
  if (!bucket) throw new Error("Skjalagoymslan er ikki sett upp");
  const row = await db
    .prepare(`SELECT * FROM document_instance WHERE id = ?1`)
    .bind(instanceId)
    .first<DocumentInstance>();
  if (!row) throw new Error("Skjalið varð ikki funnið");
  const digest = await sha256(bytes);
  const key = row.r2_key.replace(/\.pdf$/, "-signed.pdf");
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: {
      applicationId: row.application_id,
      kind: row.kind,
      state: "signed",
      sha256: digest,
    },
  });
  try {
    await db
      .prepare(
        `UPDATE document_instance
         SET state = 'signed', r2_key = ?2, sha256 = ?3, byte_size = ?4,
             signed_at_ms = ?5
         WHERE id = ?1`,
      )
      .bind(instanceId, key, digest, bytes.byteLength, now())
      .run();
  } catch (error) {
    await bucket.delete(key);
    throw error;
  }
  if (row.r2_key !== key) await bucket.delete(row.r2_key);
  const updated = await db
    .prepare(`SELECT * FROM document_instance WHERE id = ?1`)
    .bind(instanceId)
    .first<DocumentInstance>();
  if (!updated) throw new Error("Undirskrivaða skjalið kundi ikki goymast");
  return updated;
}
