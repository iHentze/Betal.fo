import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { consumeLoginToken, sessionCookie } from "~/lib/auth";
import { recordAudit } from "~/lib/audit";

export const prerender = false;

/** Exchanges a magic-link token for a session cookie. Tokens are single use. */
export const GET: APIRoute = async ({ request, locals, url }) => {
  const token = url.searchParams.get("token");
  const next = url.searchParams.get("next") ?? "/";

  if (!token) {
    return new Response(null, { status: 303, headers: { Location: "/innrita" } });
  }

  const sessionId = await consumeLoginToken(env.DB, token, {
    userAgent: request.headers.get("user-agent"),
    ip: request.headers.get("cf-connecting-ip"),
  });

  if (!sessionId) {
    return new Response(null, {
      status: 303,
      headers: { Location: "/innrita?expired=1" },
    });
  }

  await recordAudit(env.DB, {
    action: "login",
    detail: { method: "magic_link" },
  });

  return new Response(null, {
    status: 303,
    headers: {
      Location: next.startsWith("/") ? next : "/",
      "Set-Cookie": sessionCookie(sessionId, url.protocol === "https:"),
    },
  });
};
