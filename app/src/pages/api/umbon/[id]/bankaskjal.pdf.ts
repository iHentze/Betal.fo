import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack } from "~/lib/onboarding/access";
import { fillBankFormPdf } from "~/lib/onboarding/pdf";
import { toArrayBuffer } from "~/lib/onboarding/bytes";
import { getOfficialTemplate } from "~/lib/onboarding/swedbank";

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

  try {
    const official = await getOfficialTemplate(env.DB, env.DOCUMENTS, "bank_confirmation");
    const bytes = await fillBankFormPdf(pack, official.bytes);
    return new Response(toArrayBuffer(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="bankastadfesting.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Bankaskjalið fekst ikki", {
      status: 409,
    });
  }
};
