import type { Database, ObjectBucket } from "../db/types";
import { recordEvent } from "./application";

export const MAX_D1_DOCUMENT_BYTES = 1_500_000;
export const MAX_DOCUMENT_BYTES = 10_000_000;

export const DOCUMENT_KINDS = [
  "agreement",
  "photo_id",
  "company_registration",
  "owners_book",
  "bank_confirmation",
  "annual_accounts",
  "industry_answers",
  "additional",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

export type AllowedDocumentContentType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png";

export function detectDocumentContentType(
  value: Uint8Array,
): AllowedDocumentContentType | null {
  if (
    value.byteLength >= 5 &&
    new TextDecoder().decode(value.slice(0, 5)) === "%PDF-"
  ) return "application/pdf";
  if (
    value.byteLength >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => value[index] === byte)
  ) return "image/png";
  if (
    value.byteLength >= 3 &&
    value[0] === 0xff &&
    value[1] === 0xd8 &&
    value[2] === 0xff
  ) return "image/jpeg";
  return null;
}

export function validateDocumentUpload(
  fileName: string,
  claimedContentType: string,
  value: Uint8Array,
): AllowedDocumentContentType {
  const detected = detectDocumentContentType(value);
  if (!detected) throw new Error("Fílan er ikki ein PDF-, JPG- ella PNG-fíla");
  const extensions: Record<AllowedDocumentContentType, RegExp> = {
    "application/pdf": /\.pdf$/i,
    "image/jpeg": /\.(jpe?g)$/i,
    "image/png": /\.png$/i,
  };
  if (!extensions[detected].test(fileName)) {
    throw new Error("Fílunavn og innihald samsvara ikki");
  }
  if (
    claimedContentType &&
    claimedContentType !== "application/octet-stream" &&
    claimedContentType !== detected
  ) {
    throw new Error("Fíluslag og innihald samsvara ikki");
  }
  return detected;
}

function bytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export async function sha256(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function objectKey(applicationId: string, kind: string, id: string): string {
  return `onboarding/${applicationId}/${kind}/${id}`;
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
    scanStatus?: "basic_validated" | "provider_verified";
  },
  options: {
    now?: () => number;
    bucket?: ObjectBucket;
  } = {},
): Promise<void> {
  if (input.bytes.byteLength === 0) throw new Error("Fílan er tóm");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("Fílan er ov stór (í mesta lagi 10 MB)");
  }
  if (!options.bucket && input.bytes.byteLength > MAX_D1_DOCUMENT_BYTES) {
    throw new Error("Fílan er ov stór uttan skjalagoymslu (í mesta lagi 1,5 MB)");
  }

  const now = options.now ?? (() => Date.now());
  const existing = await db
    .prepare(
      `SELECT id, r2_key FROM onboarding_document
       WHERE application_id = ?1 AND kind = ?2`,
    )
    .bind(input.applicationId, input.kind)
    .first<{ id: string; r2_key: string | null }>();

  const id = existing?.id ?? crypto.randomUUID();
  const at = now();
  const digest = await sha256(input.bytes);
  const r2Key = options.bucket ? objectKey(input.applicationId, input.kind, id) : null;

  if (options.bucket && r2Key) {
    await options.bucket.put(r2Key, input.bytes, {
      httpMetadata: { contentType: input.contentType },
      customMetadata: {
        applicationId: input.applicationId,
        kind: input.kind,
        sha256: digest,
      },
    });
  }

  try {
    if (existing) {
      await db
        .prepare(
          `UPDATE onboarding_document
           SET file_name = ?2, content_type = ?3, byte_size = ?4, bytes = ?5,
               uploaded_by = ?6, uploaded_at_ms = ?7, required = ?8,
               storage = ?9, r2_key = ?10, sha256 = ?11, scan_status = ?12,
               quarantined_at_ms = NULL
           WHERE id = ?1`,
        )
        .bind(
          id,
          input.fileName,
          input.contentType,
          input.bytes.byteLength,
          options.bucket ? null : input.bytes,
          input.uploadedBy,
          at,
          input.required === false ? 0 : 1,
          options.bucket ? "r2" : "d1",
          r2Key,
          digest,
          input.scanStatus ?? "basic_validated",
        )
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO onboarding_document (
             id, application_id, kind, required, file_name, content_type, byte_size,
             bytes, uploaded_by, uploaded_at_ms, storage, r2_key, sha256, scan_status
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        )
        .bind(
          id,
          input.applicationId,
          input.kind,
          input.required === false ? 0 : 1,
          input.fileName,
          input.contentType,
          input.bytes.byteLength,
          options.bucket ? null : input.bytes,
          input.uploadedBy,
          at,
          options.bucket ? "r2" : "d1",
          r2Key,
          digest,
          input.scanStatus ?? "basic_validated",
        )
        .run();
    }
  } catch (error) {
    if (options.bucket && r2Key) await options.bucket.delete(r2Key);
    throw error;
  }

  if (
    options.bucket &&
    existing?.r2_key &&
    existing.r2_key !== r2Key
  ) {
    await options.bucket.delete(existing.r2_key);
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
    {
      kind: input.kind,
      fileName: input.fileName,
      bytes: input.bytes.byteLength,
      storage: options.bucket ? "r2" : "d1",
      sha256: digest,
    },
    now,
  );
}

async function resolveDocument(
  row: {
    file_name: string | null;
    content_type: string | null;
    bytes: ArrayBuffer | Uint8Array | null;
    storage: string;
    r2_key: string | null;
    sha256: string | null;
  } | null,
  bucket?: ObjectBucket,
): Promise<{
  file_name: string | null;
  content_type: string | null;
  bytes: Uint8Array;
  sha256: string | null;
} | null> {
  if (!row) return null;
  if (row.storage === "r2") {
    if (!bucket || !row.r2_key) throw new Error("Skjalagoymslan er ikki tøk");
    const object = await bucket.get(row.r2_key);
    if (!object) throw new Error("Skjalið finst ikki í goymsluni");
    const value = new Uint8Array(await object.arrayBuffer());
    if (row.sha256 && await sha256(value) !== row.sha256) {
      throw new Error("Skjalið samsvarar ikki við skrásetta hash-virðið");
    }
    return {
      file_name: row.file_name,
      content_type: row.content_type ?? object.httpMetadata?.contentType ?? null,
      bytes: value,
      sha256: row.sha256,
    };
  }
  if (!row.bytes) return null;
  return {
    file_name: row.file_name,
    content_type: row.content_type,
    bytes: bytes(row.bytes),
    sha256: row.sha256,
  };
}

export async function getDocumentBytes(
  db: Database,
  applicationId: string,
  kind: string,
  bucket?: ObjectBucket,
): Promise<{
  file_name: string | null;
  content_type: string | null;
  bytes: Uint8Array;
  sha256: string | null;
} | null> {
  const row = await db
    .prepare(
      `SELECT file_name, content_type, bytes, storage, r2_key, sha256
       FROM onboarding_document
       WHERE application_id = ?1 AND kind = ?2`,
    )
    .bind(applicationId, kind)
    .first<{
      file_name: string | null;
      content_type: string | null;
      bytes: ArrayBuffer | Uint8Array | null;
      storage: string;
      r2_key: string | null;
      sha256: string | null;
    }>();
  return resolveDocument(row, bucket);
}

export async function getDocumentById(
  db: Database,
  applicationId: string,
  documentId: string,
  bucket?: ObjectBucket,
): Promise<{
  file_name: string | null;
  content_type: string | null;
  bytes: Uint8Array;
  sha256: string | null;
} | null> {
  const row = await db
    .prepare(
      `SELECT file_name, content_type, bytes, storage, r2_key, sha256
       FROM onboarding_document
       WHERE application_id = ?1 AND id = ?2`,
    )
    .bind(applicationId, documentId)
    .first<{
      file_name: string | null;
      content_type: string | null;
      bytes: ArrayBuffer | Uint8Array | null;
      storage: string;
      r2_key: string | null;
      sha256: string | null;
    }>();
  return resolveDocument(row, bucket);
}
