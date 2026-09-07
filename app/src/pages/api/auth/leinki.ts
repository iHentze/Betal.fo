import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { createLoginToken } from "~/lib/auth";

export const prerender = false;

/**
 * Requests a magic link.
 *
 * Always redirects to the same confirmation regardless of whether the address is
 * known. Responding differently would turn this form into an oracle for which email
 * addresses have Betal accounts.
 *
 * Email delivery is not wired to a provider yet. In development the link is handed
 * back to the confirmation page so the flow is usable end to end; that branch is
 * behind `import.meta.env.DEV`, which is resolved at build time, so it cannot exist
 * in a deployed bundle even if someone misconfigures the environment.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const next = String(form.get("next") ?? "/");

  const token = await createLoginToken(env.DB, email);

  let devLink: string | null = null;

  if (token) {
    const link = new URL(
      `/api/auth/vatta?token=${token}&next=${encodeURIComponent(next)}`,
      url.origin,
    ).href;

    if (import.meta.env.DEV) {
      devLink = link;
    } else {
      // TODO: send through an email provider. Logged rather than dropped so a
      // deployed environment without a provider is still recoverable from the logs.
      console.log(JSON.stringify({ event: "login_link", email, link }));
    }
  }

  const target = devLink
    ? `/innrita?sent=1&leinki=${encodeURIComponent(devLink)}`
    : "/innrita?sent=1";

  return new Response(null, { status: 303, headers: { Location: target } });
};
