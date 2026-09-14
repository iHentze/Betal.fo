/**
 * Wraps the static asset serving to do three things.
 *
 * 1. Redirect http to https and send HSTS. Cloudflare's zone settings would do
 *    this, but they are dashboard toggles that never show up in a diff.
 * 2. Serve POST /api/samband, the contact form's intake.
 * 3. Otherwise hand the request to the static assets.
 *
 * The intake lives here rather than on app.betal.fo because it is same-origin:
 * no CORS preflight, and none of the platform's session middleware in the way.
 */

interface Env {
  // Structural type rather than Cloudflare's `Fetcher`, so this needs no
  // @cloudflare/workers-types dependency just for one field.
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Set with: npx wrangler secret put RESEND_API_KEY */
  RESEND_API_KEY?: string;
  /** Must be on a domain verified in Resend — the key is domain-restricted. */
  CONTACT_FROM?: string;
  CONTACT_TO?: string;
}

// Six months. Deliberately without `includeSubDomains` or `preload`: app.betal.fo
// is not deployed yet, and preload is painful to reverse.
const HSTS = "max-age=15552000";

/** Long enough for a real enquiry, short enough that the endpoint is not a pipe. */
const LIMITS = { name: 120, company: 160, phone: 40, email: 160, product: 80, message: 4000 };

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function field(form: FormData, key: string): string {
  const raw = String(form.get(key) ?? "").trim();
  return raw.slice(0, LIMITS[key as keyof typeof LIMITS] ?? 200);
}

async function handleContact(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  // Bots fill every field they find; people never see this one.
  if (String(form.get("website") ?? "")) return json({ ok: true }, 202);

  const name = field(form, "name");
  const email = field(form, "email");
  const message = field(form, "message");

  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "invalid" }, 400);
  }

  // Without a key there is nothing to send with. Say so plainly so the form can
  // fall back to mailto rather than pretending the message was delivered.
  if (!env.RESEND_API_KEY) return json({ ok: false, error: "not_configured" }, 503);

  const company = field(form, "company");
  const phone = field(form, "phone");
  const product = field(form, "product");

  const body = [
    `Navn: ${name}`,
    company && `Fyritøka: ${company}`,
    phone && `Telefon: ${phone}`,
    `Teldupostur: ${email}`,
    product && `Tænasta: ${product}`,
    "",
    message,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.CONTACT_FROM ?? "Betal <samband@send.betal.fo>",
      to: [env.CONTACT_TO ?? "hey@betal.fo"],
      reply_to: email,
      subject: product ? `betal.fo: ${product}` : "betal.fo: samband",
      text: body,
    }),
  });

  if (!res.ok) {
    // Logged rather than dropped, so a failure is recoverable from the logs
    // even though the sender is told only that it did not go through.
    console.log(JSON.stringify({ event: "contact_send_failed", status: res.status }));
    return json({ ok: false, error: "send_failed" }, 502);
  }

  return json({ ok: true }, 202);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CF-Visitor carries the scheme the client actually used, which survives
    // cases where request.url has already been normalised to https.
    let scheme = url.protocol.replace(":", "");
    const visitor = request.headers.get("cf-visitor");
    if (visitor) {
      try {
        const parsed = JSON.parse(visitor) as { scheme?: string };
        if (parsed.scheme) scheme = parsed.scheme;
      } catch {
        // Malformed header: fall back to the URL's own scheme.
      }
    }

    if (scheme === "http") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/api/samband") {
      if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
      return handleContact(request, env);
    }

    const response = await env.ASSETS.fetch(request);

    // Headers on the asset response are immutable, so clone to add HSTS.
    const headers = new Headers(response.headers);
    headers.set("Strict-Transport-Security", HSTS);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
