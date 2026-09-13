import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack, wizardPath } from "~/lib/onboarding/access";
import { refreshSkrivaApplication } from "~/lib/onboarding/signing-service";
import { SkrivaError } from "~/lib/onboarding/skriva";

export const prerender = false;

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function message(path: string, key: "sent" | "feilur", value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

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
  try {
    const result = await refreshSkrivaApplication(env, id, actor.email);
    return redirect(
      message(back, "sent", result.state === "signed" ? "skriva_signed" : "skriva_status"),
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "skriva_status_failed",
      applicationId: id,
      error: error instanceof Error ? error.name : "unknown",
    }));
    return redirect(
      message(
        back,
        "feilur",
        error instanceof SkrivaError
          ? error.message
          : "Støðan hjá Skriva fekst ikki. Royn aftur.",
      ),
    );
  }
};
