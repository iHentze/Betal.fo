import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack } from "~/lib/onboarding/access";
import { fillBankFormPdf } from "~/lib/onboarding/pdf";
import { toArrayBuffer } from "~/lib/onboarding/bytes";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals, url }) => {
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

  const bytes = await fillBankFormPdf(pack);
  return new Response(toArrayBuffer(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="bankastadfesting.pdf"`,
    },
  });
};
