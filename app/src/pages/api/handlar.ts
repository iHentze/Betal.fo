import type { APIRoute } from "astro";
import { env, epayConfigured, EPAY_NOT_CONFIGURED } from "~/lib/env";
import { Epay } from "~/lib/epay";
import { createMerchant } from "~/lib/provisioning";
import { AuthorizationError, requireCapability } from "~/lib/audit";

export const prerender = false;

/** Creates a merchant and runs the automatable part of provisioning. */
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.actor;
  if (!actor || actor.kind !== "staff") {
    return new Response("forbidden", { status: 403 });
  }

  const db = env.DB;

  try {
    await requireCapability(db, actor, "manage_merchant", {
      action: "create_merchant",
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("forbidden", { status: 403 });
    }
    throw error;
  }

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const domain = String(form.get("domain") ?? "").trim();
  const vTal = String(form.get("vTal") ?? "").trim() || undefined;
  const pricePlanTemplateId =
    String(form.get("pricePlanTemplateId") ?? "").trim() || undefined;

  const fail = (message: string) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: `/betal/handlar/nyggjur?feilur=${encodeURIComponent(message)}`,
      },
    });

  if (!name || !email || !domain) return fail("Útfyll navn, teldupost og økisnavn");
  // Provisioning is entirely ePay calls; without a key none of it can start.
  if (!epayConfigured()) return fail(EPAY_NOT_CONFIGURED);

  const epay = new Epay({ partnerKey: env.EPAY_PARTNER_KEY, tokens: env.TOKENS });

  try {
    const { merchantId } = await createMerchant(db, epay, {
      name,
      email,
      domain,
      vTal,
      pricePlanTemplateId,
      actorEmail: actor.email,
    });

    return new Response(null, {
      status: 303,
      headers: { Location: `/stillingar?handil=${merchantId}` },
    });
  } catch (error) {
    // Provisioning records its own steps, so a partial failure is resumable; the
    // operator just needs to be told what went wrong.
    return fail(error instanceof Error ? error.message : String(error));
  }
};
