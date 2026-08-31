/// <reference types="astro/client" />

import type { Env } from "~/lib/db/types";

declare global {
  namespace App {
    interface Locals {
      runtime: {
        env: Env;
        ctx: { waitUntil(promise: Promise<unknown>): void };
      };
    }
  }
}

export {};
