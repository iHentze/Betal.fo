/**
 * Wraps the static asset serving to do two things Cloudflare's zone settings
 * would otherwise handle ("Always Use HTTPS" and HSTS), so they live in the
 * repo rather than in a dashboard toggle nobody can see in a diff.
 *
 * If those zone settings are ever turned on, this becomes redundant and the
 * `main` entry can be dropped from wrangler.jsonc — the edge redirects before
 * a request ever reaches the Worker.
 */

interface Env {
  ASSETS: Fetcher;
}

// Six months. Deliberately without `includeSubDomains` or `preload`: app.betal.fo
// is not deployed yet, and preload is painful to reverse.
const HSTS = "max-age=15552000";

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
