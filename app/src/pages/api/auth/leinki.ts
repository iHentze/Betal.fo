import type { APIRoute } from "astro";
import { createLoginToken } from "~/lib/auth";

export const prerender = false;

/**
 * Requests a magic link.
 *
 * Always redirects to the same confirmation regardless of whether the address is
 * known. Responding differently would turn this form into an oracle for which email
 * addresses have Betal accounts.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const next = String(form.get("next") ?? "/");

  const token = await createLoginToken(locals.runtime.env.DB, email);

  if (token) {
    const link = new URL(
      `/api/auth/vatta?token=${token}&next=${encodeURIComponent(next)}`,
      url.origin,
    ).href;

    // Delivery is not wired up yet. Logged rather than silently dropped so the flow
    // is testable end to end before an email provider is chosen.
    console.log(JSON.stringify({ event: "login_link", email, link }));
  }

  return new Response(null, {
    status: 303,
    headers: { Location: "/innrita?sent=1" },
  });
};
