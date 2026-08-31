import { defineMiddleware } from "astro:middleware";
import { resolveSession, SESSION_COOKIE } from "~/lib/auth";

/**
 * Resolves the session once per request and puts the actor on locals.
 *
 * Webhook and auth routes are exempt: ePay authenticates with its own per-merchant
 * secret and has no session, and the login pages are what you use before you have one.
 */
const PUBLIC_PREFIXES = ["/api/hooks/", "/innrita", "/api/auth/"];

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const env = context.locals.runtime?.env;

  if (env?.DB) {
    const sessionId = context.cookies.get(SESSION_COOKIE)?.value;
    context.locals.actor = await resolveSession(env.DB, sessionId);
  } else {
    context.locals.actor = null;
  }

  const isPublic = PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
  if (!isPublic && !context.locals.actor) {
    return context.redirect(`/innrita?next=${encodeURIComponent(path)}`);
  }

  return next();
});
