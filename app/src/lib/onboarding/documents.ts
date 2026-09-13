import type { Database } from "../db/types";
import { recordEvent } from "./application";

/** D1 BLOB cap. Larger files wait on an R2 binding that is not in wrangler yet. */
export const MAX_DOCUMENT_BYTES = 1_500_000;

export const DOCUMENT_KINDS = [
  "agreement",
  "photo_id",
  "company_registration",
  "owners_book",
  "bank_confirmation",
  "annual_accounts",
  "industry_answers",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

export async function putDocument(
  db: Database,
  input: {
    applicationId: string;
    kind: DocumentKind;
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
    uploadedBy: string;
    required?: boolean;
  },
  now: () => number = () => Date.now(),
): Promise<void> {
  if (input.bytes.byteLength === 0) throw new Error("Fílan er tóm");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("Fílan er ov stór (í mesta lagi 1,5 MB)");
  }

  const existing = await db
    .prepare(
      `SELECT id FROM onboarding_document WHERE application_id = ?1 AND kind = ?2`,
    )
    .bind(input.applicationId, input.kind)
    .first<{ id: string }>();

  const id = existing?.id ?? crypto.randomUUID();
  const at = now();

  if (existing) {
    await db
      .prepare(
        `UPDATE onboarding_document
            SET file_name = ?2, content_type = ?3, byte_size = ?4, bytes = ?5,
                uploaded_by = ?6, uploaded_at_ms = ?7, required = ?8
          WHERE id = ?1`,
      )
      .bind(
        id,
        input.fileName,
        input.contentType,
        input.bytes.byteLength,
        input.bytes,
        input.uploadedBy,
        at,
        input.required === false ? 0 : 1,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO onboarding_document (
           id, application_id, kind, required, file_name, content_type, byte_size,
           bytes, uploaded_by, uploaded_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        id,
        input.applicationId,
        input.kind,
        input.required === false ? 0 : 1,
        input.fileName,
        input.contentType,
        input.bytes.byteLength,
        input.bytes,
        input.uploadedBy,
        at,
      )
      .run();
  }

  await db
    .prepare(`UPDATE onboarding_application SET updated_at_ms = ?2 WHERE id = ?1`)
    .bind(input.applicationId, at)
    .run();

  await recordEvent(
    db,
    input.applicationId,
    "document_uploaded",
    input.uploadedBy,
    { kind: input.kind, fileName: input.fileName, bytes: input.bytes.byteLength },
    now,
  );
}

export async function getDocumentBytes(
  db: Database,
  applicationId: string,
  kind: string,
): Promise<{
  file_name: string | null;
  content_type: string | null;
  bytes: ArrayBuffer | Uint8Array;
} | null> {
  return db
    .prepare(
      `SELECT file_name, content_type, bytes
         FROM onboarding_document
        WHERE application_id = ?1 AND kind = ?2`,
    )
    .bind(applicationId, kind)
    .first<{
      file_name: string | null;
      content_type: string | null;
      bytes: ArrayBuffer | Uint8Array;
    }>();
}

export async function getDocumentById(
  db: Database,
  applicationId: string,
  documentId: string,
): Promise<{
  file_name: string | null;
  content_type: string | null;
  bytes: ArrayBuffer | Uint8Array;
} | null> {
  return db
    .prepare(
      `SELECT file_name, content_type, bytes
         FROM onboarding_document
        WHERE application_id = ?1 AND id = ?2`,
    )
    .bind(applicationId, documentId)
    .first<{
      file_name: string | null;
      content_type: string | null;
      bytes: ArrayBuffer | Uint8Array;
    }>();
}
