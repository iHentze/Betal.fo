/// <reference types="astro/client" />

import type { Env } from "~/lib/db/types";
import type { Actor } from "~/lib/auth";

declare global {
  namespace App {
    interface Locals {
      runtime: {
        env: Env;
        ctx: { waitUntil(promise: Promise<unknown>): void };
      };
      /** Set by middleware; null on the public routes. */
      actor: Actor | null;
    }
  }
}

export {};
