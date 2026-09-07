/// <reference types="astro/client" />

import type { Actor } from "~/lib/auth";

declare global {
  namespace App {
    interface Locals {
      /**
       * The Worker's execution context. Bindings are no longer here — Astro v6 moved
       * them to the `cloudflare:workers` import, wrapped in `~/lib/env`.
       */
      cfContext: { waitUntil(promise: Promise<unknown>): void };
      /** Set by middleware; null on the public routes. */
      actor: Actor | null;
    }
  }
}

export {};
