import type { APIRoute } from "astro";
import { Resend } from "resend";
import { env } from "~/lib/env";
import { requirePack, wizardPath } from "~/lib/onboarding/access";
import {
  bankRequestIdempotencyKey,
  buildBankRequestEmail,
  cleanEmailAddress,
} from "~/lib/onboarding/bank-email";
import { recordEvent } from "~/lib/onboarding/application";
import { fillBankFormPdf } from "~/lib/onboarding/pdf";

export const prerender = false;

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function withMessage(path: string, key: "sent" | "feilur", message: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
}

export const POST: APIRoute = async ({ params, request, locals, url }) => {
  const actor = locals.actor;
  if (!actor) return new Response("unauthorized", { status: 401 });
  const id = params.id;
  if (!id) return new Response("not found", { status: 404 });

  let pack;
  try {
    pack = await requirePack(env.DB, actor, id, url.searchParams.get("handil"));
  } catch {
    return new Response("forbidden", { status: 403 });
  }

  const back = wizardPath(id, "banki", actor, pack.application.merchant_id);
  const fail = (message: string) => redirect(withMessage(back, "feilur", message));
  const app = pack.application;

  if (!app.bank_account || !app.legal_name || !app.v_tal) {
    return fail("Goym kontunummar og felagsupplýsingar fyrst");
  }
  if (!env.RESEND_API_KEY) {
    return fail("Teldupostur frá Betal er ikki settur upp enn");
  }

  try {
    const form = await request.formData();
    const to = cleanEmailAddress(String(form.get("bank_email") ?? ""), "bankan");
    const cc = cleanEmailAddress(String(form.get("cc_email") ?? ""), "CC");
    let clientEmail = actor.email;
    if (actor.kind === "staff") {
      const contact = await env.DB
        .prepare(
          `SELECT email FROM app_user
           WHERE kind = 'merchant' AND merchant_id = ?1
           ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at
           LIMIT 1`,
        )
        .bind(app.merchant_id)
        .first<{ email: string }>();
      clientEmail = contact?.email ?? "";
    }
    if (!clientEmail || cc.toLocaleLowerCase() !== clientEmail.toLocaleLowerCase()) {
      return fail("CC skal vera telduposturin hjá innritaða viðskiftafólkinum");
    }

    const attachment = await fillBankFormPdf(pack);
    const input = {
      from: env.BANK_EMAIL_FROM ?? "Betal <banki@betal.fo>",
      to,
      cc,
      companyName: app.legal_name,
      vTal: app.v_tal,
      applicationId: id,
      attachment,
    };
    const idempotencyKey = await bankRequestIdempotencyKey(input);

    const existing = await env.DB
      .prepare(
        `SELECT provider_id FROM onboarding_bank_email WHERE idempotency_key = ?1`,
      )
      .bind(idempotencyKey)
      .first<{ provider_id: string }>();
    if (existing) return redirect(withMessage(back, "sent", "banki"));

    const sentToday = await env.DB
      .prepare(
        `SELECT COUNT(*) AS count
         FROM onboarding_bank_email
         WHERE application_id = ?1 AND sent_at_ms >= ?2`,
      )
      .bind(id, Date.now() - 86_400_000)
      .first<{ count: number }>();
    if ((sentToday?.count ?? 0) >= 5) {
      return fail("Ov nógvir bankafyrispurningar eru sendir í dag. Skriva til Betal.");
    }

    const resend = new Resend(
      env.RESEND_API_KEY,
      env.RESEND_BASE_URL ? { baseUrl: env.RESEND_BASE_URL } : undefined,
    );
    const { data, error } = await resend.emails.send(
      buildBankRequestEmail(input),
      { idempotencyKey },
    );
    if (error || !data?.id) {
      console.error(JSON.stringify({
        event: "bank_request_email_failed",
        applicationId: id,
        error: error?.name ?? "missing_provider_id",
      }));
      return fail("Telduposturin varð ikki sendur. Royn aftur um eina løtu.");
    }

    const at = Date.now();
    const inserted = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO onboarding_bank_email (
           idempotency_key, application_id, bank_email, cc_email, provider_id,
           sent_by, sent_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(idempotencyKey, id, to, cc, data.id, actor.email, at)
      .run();

    if ((inserted.meta.changes ?? 0) > 0) {
      await recordEvent(env.DB, id, "bank_request_sent", actor.email, {
        provider: "resend",
        providerId: data.id,
      }, () => at);
    }

    return redirect(withMessage(back, "sent", "banki"));
  } catch (error) {
    console.error(JSON.stringify({
      event: "bank_request_email_error",
      applicationId: id,
      error: error instanceof Error ? error.name : "unknown",
    }));
    return fail(
      error instanceof Error && error.message.startsWith("Skriva ein gildugan")
        ? error.message
        : "Telduposturin varð ikki sendur. Royn aftur um eina løtu.",
    );
  }
};
