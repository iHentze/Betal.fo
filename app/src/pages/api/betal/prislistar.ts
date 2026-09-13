import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { AuthorizationError, requireCapability } from "~/lib/audit";
import { officialRatesFromForm } from "~/lib/onboarding/official-rates";
import { approvePriceList, savePriceListDraft } from "~/lib/onboarding/price-lists";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.actor;
  if (!actor || actor.kind !== "staff") {
    return new Response("forbidden", { status: 403 });
  }

  try {
    await requireCapability(env.DB, actor, "manage_billing", {
      action: "create_price_list",
      subjectType: "acquiring_price_list",
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("forbidden", { status: 403 });
    }
    throw error;
  }

  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const back = "/betal/prislistar";
  const fail = (message: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${back}?feilur=${encodeURIComponent(message)}` },
    });

  try {
    if (action === "draft") {
      const kind = String(form.get("kind") ?? "");
      if (kind !== "standard" && kind !== "sector2") {
        return fail("Vel standard ella geiri 2");
      }
      await savePriceListDraft(env.DB, {
        kind,
        rates: officialRatesFromForm(form),
        sourceNote: String(form.get("source_note") ?? ""),
        actor,
      });
    } else if (action === "approve") {
      const id = String(form.get("id") ?? "");
      if (!id) return fail("Príslistin manglar");
      await approvePriceList(env.DB, {
        id,
        sourceNote: String(form.get("source_note") ?? ""),
        actor,
      });
    } else {
      return fail("Ókend gerð");
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  return new Response(null, {
    status: 303,
    headers: { Location: `${back}?ok=1` },
  });
};
