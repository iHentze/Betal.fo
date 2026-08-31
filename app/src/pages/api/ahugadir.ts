import type { APIRoute } from "astro";
import { captureLead } from "~/lib/ops";

export const prerender = false;

/**
 * Intake for the betal.fo contact form.
 *
 * The marketing site currently opens a mailto: link, so an enquiry exists only in
 * somebody's inbox. Posting here instead means it lands in the pipeline and can be
 * chased.
 *
 * Public by design — anyone can submit an enquiry — so it validates input and reveals
 * nothing back.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const contentType = request.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await request.json()) as Record<string, unknown>)
    : Object.fromEntries(await request.formData());

  const name = String(payload.name ?? "").trim();
  const email = String(payload.email ?? "").trim();
  const message = String(payload.message ?? "").trim();

  if (!name || !email || !message || !email.includes("@")) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  await captureLead(locals.runtime.env.DB, {
    name,
    email,
    company: payload.company ? String(payload.company) : null,
    phone: payload.phone ? String(payload.phone) : null,
    product: payload.product ? String(payload.product) : null,
    message,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
};
