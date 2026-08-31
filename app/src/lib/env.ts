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
