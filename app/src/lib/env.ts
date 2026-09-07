import { env as workerEnv } from "cloudflare:workers";
import type { Env } from "./db/types";

/**
 * Access to the Worker's bindings.
 *
 * Astro v6 removed `Astro.locals.runtime.env` in favour of importing from
 * `cloudflare:workers`. Routing every access through here means the binding surface is
 * typed in one place and a future adapter change is a single edit rather than one per
 * page.
 *
 * Per-request context is separate: `waitUntil` now comes from
 * `Astro.locals.cfContext`, so it stays a value the caller passes in.
 */
export const env = workerEnv as unknown as Env;

/**
 * Whether a usable ePay partner key is configured.
 *
 * Without one, every call to ePay comes back 401 or 403 and the failure surfaces deep
 * inside the client, far from anything a person can act on. Checking up front lets the
 * UI say "this needs an ePay connection" and skip offering actions that cannot work —
 * which is the normal state locally and on a fresh deploy.
 */
export function epayConfigured(): boolean {
  const key = env.EPAY_PARTNER_KEY;
  return (
    typeof key === "string" &&
    key.length > 8 &&
    !/^0+$/.test(key.replaceAll("-", ""))
  );
}

/** Message shown wherever an ePay-backed action is unavailable. */
export const EPAY_NOT_CONFIGURED =
  "Eingin ePay-lykil er settur upp, so hendan gerðin er ikki tøk enn.";
