import type { Database } from "../db/types";

const FAILURE_TYPES = new Set([
  "email.bounced",
  "email.complained",
  "email.suppressed",
]);

export async function applyBankEmailDeliveryEvent(
  db: Database,
  input: {
    eventId: string;
    type: string;
    providerEmailId: string;
    receivedAtMs?: number;
  },
): Promise<"applied" | "duplicate" | "unknown_email"> {
  const email = await db
    .prepare(
      `SELECT idempotency_key FROM onboarding_bank_email WHERE provider_id = ?1`,
    )
    .bind(input.providerEmailId)
    .first<{ idempotency_key: string }>();
  if (!email) return "unknown_email";

  const at = input.receivedAtMs ?? Date.now();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO email_delivery_event (
         provider_event_id, bank_email_idempotency, type, received_at_ms
       ) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(input.eventId, email.idempotency_key, input.type, at)
    .run();
  if ((inserted.meta.changes ?? 0) === 0) return "duplicate";

  const delivered = input.type === "email.delivered";
  const failed = FAILURE_TYPES.has(input.type);
  const status = delivered
    ? "delivered"
    : failed
      ? "failed"
      : input.type === "email.delivery_delayed"
        ? "delayed"
        : "sent";
  await db
    .prepare(
      `UPDATE onboarding_bank_email
       SET status = ?2,
           delivered_at_ms = CASE WHEN ?3 = 1 THEN ?4 ELSE delivered_at_ms END,
           failed_at_ms = CASE WHEN ?5 = 1 THEN ?4 ELSE failed_at_ms END,
           failure_reason = CASE WHEN ?5 = 1 THEN ?6 ELSE failure_reason END
       WHERE idempotency_key = ?1`,
    )
    .bind(
      email.idempotency_key,
      status,
      delivered ? 1 : 0,
      at,
      failed ? 1 : 0,
      failed ? input.type : null,
    )
    .run();
  return "applied";
}
