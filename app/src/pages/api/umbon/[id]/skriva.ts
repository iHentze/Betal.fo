import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack, wizardPath } from "~/lib/onboarding/access";
import { getActivePriceList, recordEvent } from "~/lib/onboarding/application";
import { canSendToSkriva, fillAgreementPdf } from "~/lib/onboarding/pdf";
import { priceListKind, screenApplication } from "~/lib/onboarding/screening";
import { skrivaConfigured } from "~/lib/onboarding/skriva";

export const prerender = false;

export const POST: APIRoute = async ({ params, locals, url }) => {
  const actor = locals.actor;
  if (!actor) return new Response("unauthorized", { status: 401 });
  const id = params.id;
  if (!id) return new Response("not found", { status: 404 });

  let pack;
  try {
    pack = await requirePack(env.DB, actor, id, url.searchParams.get("handil"));
  } catch {
    return new Response("forbidden", { status: 403 });
  }

  const back = wizardPath(id, "undirskriva", actor, pack.application.merchant_id);
  const fail = (message: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${back}${back.includes("?") ? "&" : "?"}feilur=${encodeURIComponent(message)}` },
    });

  const screening = screenApplication({
    sector: pack.application.vertical_sector,
    equity: pack.application.equity as "positive" | "negative" | "unknown" | null,
    operations: pack.application.operations as "positive" | "negative" | "unknown" | null,
  });
  const list = await getActivePriceList(env.DB, priceListKind(screening));
  const allowed = canSendToSkriva(pack, list, skrivaConfigured(env));
  if (!allowed.ok) return fail(allowed.reason);

  // Fill must succeed before any Skriva call — that is the step that can ship the wrong contract.
  try {
    await fillAgreementPdf(pack, list);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  await recordEvent(env.DB, id, "skriva_blocked_no_tenant", actor.email, {
    reason: "Staging user not provisioned",
  });
  return fail("Skriva-brúkari er ikki settur. Staging bíðar eftir Klintra-tenanti.");
};
