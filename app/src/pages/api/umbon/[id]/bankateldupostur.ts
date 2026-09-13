import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack } from "~/lib/onboarding/access";
import {
  bankEmailFileName,
  buildBankRequestEmail,
  cleanEmailAddress,
} from "~/lib/onboarding/bank-email";
import { fillBankFormPdf } from "~/lib/onboarding/pdf";
import { toArrayBuffer } from "~/lib/onboarding/bytes";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals, url }) => {
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

  const app = pack.application;
  if (!app.bank_account || !app.legal_name || !app.v_tal) {
    return new Response("Goym kontunummar og felagsupplýsingar fyrst", { status: 409 });
  }

  try {
    const form = await request.formData();
    const to = cleanEmailAddress(String(form.get("bank_email") ?? ""), "bankan");
    const cc = cleanEmailAddress(String(form.get("cc_email") ?? ""), "CC");
    const attachment = await fillBankFormPdf(pack);
    const message = buildBankRequestEmail({
      to,
      cc,
      companyName: app.legal_name,
      vTal: app.v_tal,
      attachment,
    });

    return new Response(toArrayBuffer(message), {
      headers: {
        "Content-Type": "message/rfc822",
        "Content-Disposition": `attachment; filename="${bankEmailFileName(app.v_tal)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Telduposturin kundi ikki gerast", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
};
