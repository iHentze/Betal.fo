import type { APIRoute } from "astro";
import { Resend } from "resend";
import { env } from "~/lib/env";
import { applyBankEmailDeliveryEvent } from "~/lib/onboarding/email-delivery";

export const prerender = false;

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const POST: APIRoute = async ({ request }) => {
  if (!env.RESEND_WEBHOOK_SECRET) {
    return new Response("webhook not configured", { status: 503 });
  }
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return new Response("missing signature", { status: 400 });
  }

  const payload = await request.text();
  try {
    const event = new Resend(env.RESEND_API_KEY).webhooks.verify({
      payload,
      headers: {
        id,
        timestamp,
        signature,
      },
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
    });
    const data = event.data as unknown as Record<string, unknown>;
    const providerEmailId = string(data.email_id) || string(data.id);
    if (!providerEmailId) return new Response("ignored", { status: 202 });

    const result = await applyBankEmailDeliveryEvent(env.DB, {
      eventId: id,
      type: event.type,
      providerEmailId,
    });
    return Response.json({ received: true, result });
  } catch {
    return new Response("invalid signature", { status: 400 });
  }
};
