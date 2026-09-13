import type { Database, ObjectBucket } from "../../src/lib/db/types";
import { refreshSkrivaApplication } from "../../src/lib/onboarding/signing-service";

interface Env {
  DB: Database;
  DOCUMENTS: ObjectBucket;
  IDENTITY_ENCRYPTION_KEY?: string;
  SKRIVA_BASE_URL?: string;
  SKRIVA_EMAIL?: string;
  SKRIVA_PASSWORD?: string;
  SKRIVA_TENANT_ID?: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const rows = await env.DB
      .prepare(
        `SELECT DISTINCT application_id
         FROM onboarding_signing
         WHERE provider = 'skriva' AND status IN ('sent', 'viewed')
         ORDER BY created_at_ms
         LIMIT 50`,
      )
      .all<{ application_id: string }>();

    for (let offset = 0; offset < rows.results.length; offset += 3) {
      const chunk = rows.results.slice(offset, offset + 3);
      await Promise.all(chunk.map(async (row) => {
        try {
          const result = await refreshSkrivaApplication(
            env,
            row.application_id,
            "system:skriva-poll",
          );
          console.log(JSON.stringify({
            event: "skriva_poll",
            applicationId: row.application_id,
            state: result.state,
            pending: result.pending,
          }));
        } catch (error) {
          console.error(JSON.stringify({
            event: "skriva_poll_failed",
            applicationId: row.application_id,
            error: error instanceof Error ? error.name : "unknown",
          }));
        }
      }));
    }
  },

  async fetch(): Promise<Response> {
    return Response.json({ service: "betal-onboarding", ok: true });
  },
};
