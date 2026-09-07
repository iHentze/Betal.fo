import type { Database, IngestMessage, QueueProducer } from "~/lib/db/types";
import type { EventWebhook, NotificationWebhook } from "~/lib/epay";
import { deliveryFingerprint, secretsMatch } from "./verify";
import {
  projectEvent,
  projectNotification,
  recomputeAggregates,
  type ProjectionResult,
} from "./project";

/**
 * Webhook ingest.
 *
 * ePay allows five seconds per delivery and moves slow endpoints to a low-priority
 * queue, so this path does the minimum: authenticate, record the raw body, hand off,
 * respond. All projection happens asynchronously.
 *
 * The endpoint is per-merchant (`/api/hooks/{merchantId}`) so each merchant's secret
 * can be looked up and compared in isolation. Note that ePay only accepts webhook URLs
 * on a domain already approved for one of the merchant's points of sale, so the app
 * domain has to be registered at provisioning time.
 */

export interface IngestDependencies {
  db: Database;
  queue?: QueueProducer<IngestMessage> | undefined;
  now?: () => number;
  newId?: () => string;
}

export interface IngestOutcome {
  status: number;
  body: string;
  /** Set when the delivery was stored and needs processing. */
  deliveryId?: string;
  duplicate?: boolean;
}

interface SecretRow {
  merchant_id: string;
  webhook_secret: string | null;
}

/**
 * Authenticates and records one delivery.
 *
 * Returns 200 for a duplicate as well as a new delivery: ePay retries up to 25 times
 * and a retry means it did not believe our previous acknowledgement, so replying 200
 * without reprocessing is the correct answer.
 */
export async function receiveWebhook(
  deps: IngestDependencies,
  merchantId: string,
  authorization: string | null,
  rawBody: string,
  channel: "notification" | "event",
): Promise<IngestOutcome> {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  // A merchant may have several points of sale, each with its own secret, and any of
  // them is a valid signer for this merchant's deliveries.
  const secrets = await deps.db
    .prepare(
      `SELECT merchant_id, webhook_secret FROM point_of_sale
         WHERE merchant_id = ?1 AND webhook_secret IS NOT NULL`,
    )
    .bind(merchantId)
    .all<SecretRow>();

  let authenticated = false;
  for (const row of secrets.results) {
    // Deliberately not short-circuiting: every candidate is compared so the work done
    // does not depend on which secret matched.
    const matched = await secretsMatch(authorization, row.webhook_secret);
    authenticated = authenticated || matched;
  }

  if (!authenticated) {
    return { status: 401, body: "unauthorized" };
  }

  let fingerprint: string;
  try {
    fingerprint = await deliveryFingerprint(merchantId, rawBody);
  } catch {
    return { status: 400, body: "bad request" };
  }

  let event: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as { event?: string };
    event = typeof parsed.event === "string" ? parsed.event : null;
  } catch {
    return { status: 400, body: "invalid json" };
  }

  const deliveryId = newId();
  const inserted = await deps.db
    .prepare(
      `INSERT INTO webhook_delivery (
         id, merchant_id, fingerprint, event, channel, payload, received_at_ms
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (fingerprint) DO NOTHING`,
    )
    .bind(deliveryId, merchantId, fingerprint, event, channel, rawBody, now())
    .run();

  const isDuplicate = (inserted.meta.changes ?? 0) === 0;
  if (isDuplicate) {
    return { status: 200, body: "ok", duplicate: true };
  }

  // Queues are the happy path. If the binding is absent or the send fails, the row is
  // already durable and the scheduled drain will pick it up, so we still acknowledge.
  if (deps.queue) {
    try {
      await deps.queue.send({ deliveryId });
    } catch {
      // Intentionally swallowed: the cron drain is the fallback.
    }
  }

  return { status: 200, body: "ok", deliveryId };
}

interface DeliveryRow {
  id: string;
  merchant_id: string | null;
  channel: string;
  payload: string;
  attempts: number;
}

/**
 * Projects one stored delivery into the mirror.
 *
 * Safe to run more than once: every projection statement is an upsert, so a redelivery
 * or a retried queue message converges on the same state.
 */
export async function processDelivery(
  deps: IngestDependencies,
  deliveryId: string,
): Promise<{ processed: boolean; error?: string }> {
  const now = deps.now ?? (() => Date.now());

  const delivery = await deps.db
    .prepare(
      `SELECT id, merchant_id, channel, payload, attempts FROM webhook_delivery
         WHERE id = ?1 AND processed_at_ms IS NULL`,
    )
    .bind(deliveryId)
    .first<DeliveryRow>();

  if (!delivery) return { processed: false };
  if (!delivery.merchant_id) {
    return { processed: false, error: "delivery has no merchant" };
  }

  try {
    const payload = JSON.parse(delivery.payload) as unknown;
    const projection: ProjectionResult =
      delivery.channel === "notification"
        ? projectNotification(
            deps.db,
            delivery.merchant_id,
            payload as NotificationWebhook,
          )
        : projectEvent(deps.db, delivery.merchant_id, payload as EventWebhook);

    const statements = [...projection.statements];

    // The event envelope carries no aggregates, so derive them from our operation rows
    // once the operation itself has landed.
    if (projection.transactionId && delivery.channel === "event") {
      statements.push(recomputeAggregates(deps.db, projection.transactionId));
    }

    statements.push(
      deps.db
        .prepare(
          `UPDATE webhook_delivery
              SET processed_at_ms = ?2, attempts = attempts + 1, error = NULL
            WHERE id = ?1`,
        )
        .bind(delivery.id, now()),
    );

    await deps.db.batch(statements);
    return { processed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.db
      .prepare(
        `UPDATE webhook_delivery SET attempts = attempts + 1, error = ?2 WHERE id = ?1`,
      )
      .bind(delivery.id, message)
      .run();
    return { processed: false, error: message };
  }
}

/**
 * Drains deliveries that were stored but never processed.
 *
 * Covers the two ways the queue path can fail: the binding being unavailable, and a
 * message exhausting its retries. Run from the scheduled handler.
 */
export async function drainPendingDeliveries(
  deps: IngestDependencies,
  limit = 100,
): Promise<{ processed: number; failed: number }> {
  const pending = await deps.db
    .prepare(
      `SELECT id FROM webhook_delivery
         WHERE processed_at_ms IS NULL AND attempts < 10
         ORDER BY received_at_ms
         LIMIT ?1`,
    )
    .bind(limit)
    .all<{ id: string }>();

  let processed = 0;
  let failed = 0;
  for (const row of pending.results) {
    const result = await processDelivery(deps, row.id);
    if (result.processed) processed += 1;
    else failed += 1;
  }
  return { processed, failed };
}

/**
 * Refreshes webhook health from ePay.
 *
 * ePay pauses an endpoint that fails more than half the time over a week, and a paused
 * webhook stops a merchant's data silently — no error reaches us, the events simply
 * stop. Recording pausedAt lets the UI raise it before anyone notices missing data.
 */
export async function recordWebhookHealth(
  db: Database,
  merchantId: string,
  webhooks: Array<{
    id: string;
    url: string;
    events: string[];
    pausedAt: string | null;
    pauseReason: string | null;
    createdAt: string;
  }>,
): Promise<void> {
  if (webhooks.length === 0) return;

  await db.batch(
    webhooks.map((webhook) =>
      db
        .prepare(
          `INSERT INTO webhook_endpoint (
             id, merchant_id, epay_webhook_id, url, events, paused_at, pause_reason,
             last_checked_ms, created_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT (id) DO UPDATE SET
             url = excluded.url,
             events = excluded.events,
             paused_at = excluded.paused_at,
             pause_reason = excluded.pause_reason,
             last_checked_ms = excluded.last_checked_ms`,
        )
        .bind(
          `${merchantId}:${webhook.id}`,
          merchantId,
          webhook.id,
          webhook.url,
          JSON.stringify(webhook.events),
          webhook.pausedAt,
          webhook.pauseReason,
          Date.now(),
          webhook.createdAt,
        ),
    ),
  );
}
