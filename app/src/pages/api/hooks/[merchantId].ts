import type { APIRoute } from "astro";
import { receiveWebhook, processDelivery } from "~/lib/ingest/handler";

export const prerender = false;

/**
 * Webhook ingest endpoint, one path per merchant so each merchant's secret is looked
 * up and compared in isolation.
 *
 * ePay allows five seconds and demotes slow endpoints to a low-priority queue, so this
 * does the minimum inline: authenticate, store the raw body, hand off, respond.
 *
 * `?channel=event` distinguishes the `{event, data}` envelope sent to a registered
 * webhook from the flat NotificationWebhook sent to a session's notificationUrl. The
 * two payloads have different shapes and only the latter carries card and SCA detail.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const merchantId = params.merchantId;
  if (!merchantId) {
    return new Response("not found", { status: 404 });
  }

  const env = locals.runtime.env;
  const channel =
    new URL(request.url).searchParams.get("channel") === "event"
      ? "event"
      : "notification";

  const rawBody = await request.text();

  const outcome = await receiveWebhook(
    { db: env.DB, queue: env.INGEST_QUEUE },
    merchantId,
    request.headers.get("authorization"),
    rawBody,
    channel,
  );

  // Without a queue binding, project in the background rather than making ePay wait.
  // The response is already committed, so a failure here just leaves the row for the
  // scheduled drain to retry.
  if (outcome.deliveryId && !env.INGEST_QUEUE) {
    locals.runtime.ctx.waitUntil(
      processDelivery({ db: env.DB }, outcome.deliveryId).catch(() => undefined),
    );
  }

  return new Response(outcome.body, {
    status: outcome.status,
    headers: { "content-type": "text/plain" },
  });
};
