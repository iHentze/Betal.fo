import type { Env } from "../db/types";

/**
 * Skriva is how Samleikin lands on the FO agreement. Staging send waits on a tenant
 * user *and* a successful fill with a versioned price list. Credentials are Worker
 * secrets, never in the repo.
 */
export function skrivaConfigured(env: Pick<Env, "SKRIVA_EMAIL" | "SKRIVA_PASSWORD" | "SKRIVA_BASE_URL">): boolean {
  return Boolean(env.SKRIVA_EMAIL && env.SKRIVA_PASSWORD && env.SKRIVA_BASE_URL);
}
