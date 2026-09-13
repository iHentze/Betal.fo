import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { AuthorizationError, requireCapability } from "~/lib/audit";
import { staffAction, staffSetSector } from "~/lib/onboarding/application";
import type { Acquirer } from "~/lib/onboarding/screening";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = locals.actor;
  if (!actor || actor.kind !== "staff") {
    return new Response("forbidden", { status: 403 });
  }

  const id = params.id;
  if (!id) return new Response("not found", { status: 404 });

  try {
    await requireCapability(env.DB, actor, "manage_merchant", {
      action: "review_application",
      subjectType: "onboarding_application",
      subjectId: id,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("forbidden", { status: 403 });
    }
    throw error;
  }

  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const reason = String(form.get("reason") ?? "").trim() || undefined;
  const acquirer = (String(form.get("acquirer") ?? "").trim() || undefined) as
    | Acquirer
    | undefined;
  const externalRef = String(form.get("external_ref") ?? "").trim() || undefined;

  const back = `/betal/umbonir/${id}`;
  const fail = (message: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${back}?feilur=${encodeURIComponent(message)}` },
    });

  try {
    if (action === "sector") {
      const sector = Number(form.get("sector"));
      if (![0, 1, 2].includes(sector)) return fail("Ógildugt geiri");
      await staffSetSector(env.DB, id, sector, actor.email);
    } else if (
      action === "submit" ||
      action === "reroute" ||
      action === "reject" ||
      action === "request_docs"
    ) {
      await staffAction(env.DB, {
        applicationId: id,
        actor,
        action,
        acquirer,
        reason,
        externalRef,
      });
    } else {
      return fail("Ókend gerð");
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  return new Response(null, { status: 303, headers: { Location: back } });
};
