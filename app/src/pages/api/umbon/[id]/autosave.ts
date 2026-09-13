import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack } from "~/lib/onboarding/access";
import {
  applyScreening,
  answerValue,
  loadPack,
  saveAnswers,
  saveBank,
  saveFinances,
  saveOwners,
  saveVertical,
} from "~/lib/onboarding/application";
import { deriveSectorFromAnswers, type FinanceFlag } from "~/lib/onboarding/screening";
import { isStepSlug } from "~/lib/onboarding/steps";
import { verticalByKey } from "~/lib/onboarding/verticals";

export const prerender = false;

const STRING_ANSWERS = [
  "market_name",
  "contact_name",
  "contact_phone",
  "contact_email",
  "invoice_email",
  "product_type",
  "inventory",
  "delivery_method",
  "primary_customers",
  "payment_link_mode",
  "final_payment_when",
  "final_payment_method",
  "wallet_other",
] as const;

const NUMBER_ANSWERS = [
  "annual_card_turnover_dkk",
  "average_transaction_dkk",
  "delivery_days",
  "made_to_order_days",
  "made_to_order_share_percent",
  "deposit_share_percent",
] as const;

const BOOLEAN_ANSWERS = [
  "subscriptions",
  "donations",
  "donations_supervised",
  "gift_cards",
  "save_card",
  "save_card_in_app",
  "other_mit",
  "website_terms",
  "made_to_order",
  "deposit",
] as const;

export const POST: APIRoute = async ({ params, request, locals, url }) => {
  const actor = locals.actor;
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "not found" }, { status: 404 });

  let pack;
  try {
    pack = await requirePack(env.DB, actor, id, url.searchParams.get("handil"));
  } catch {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (
    pack.application.locked_at_ms &&
    pack.application.state !== "collecting" &&
    pack.application.state !== "more_info"
  ) {
    return Response.json({ error: "locked" }, { status: 423 });
  }

  const form = await request.formData();
  const step = String(form.get("step") ?? "");
  if (!isStepSlug(step)) return Response.json({ error: "unknown step" }, { status: 400 });

  try {
    if (step === "felag" && !String(form.get("registry_id") ?? "")) {
      const fields = [
        "legal_name",
        "v_tal",
        "company_type",
        "address_line_one",
        "address_line_two",
        "postal_code",
        "city",
      ] as const;
      const sets: string[] = [];
      const values: unknown[] = [id];
      for (const field of fields) {
        if (!form.has(field)) continue;
        values.push(String(form.get(field) ?? "").trim() || null);
        sets.push(`${field} = ?${values.length}`);
      }
      if (sets.length > 0) {
        values.push(Date.now());
        await env.DB
          .prepare(
            `UPDATE onboarding_application
             SET ${sets.join(", ")}, updated_at_ms = ?${values.length}
             WHERE id = ?1`,
          )
          .bind(...values)
          .run();
      }
    } else if (step === "felag" && form.has("v_tal")) {
      await env.DB
        .prepare(
          `UPDATE onboarding_application SET v_tal = ?2, updated_at_ms = ?3 WHERE id = ?1`,
        )
        .bind(id, String(form.get("v_tal") ?? "").trim() || null, Date.now())
        .run();
    } else if (step === "vinnugrein") {
      const sells = String(form.get("sells") ?? "").trim();
      const website = String(form.get("website") ?? "").trim();
      const vertical = String(form.get("vertical_key") ?? "").trim();
      await env.DB
        .prepare(
          `UPDATE onboarding_application
           SET sells = ?2, website = ?3, updated_at_ms = ?4 WHERE id = ?1`,
        )
        .bind(id, sells || null, website || null, Date.now())
        .run();
      if (
        vertical &&
        vertical !== pack.application.vertical_key &&
        verticalByKey(vertical)
      ) {
        await saveVertical(env.DB, id, vertical, actor.email);
      }

      const answers: Record<string, unknown> = {};
      for (const key of STRING_ANSWERS) {
        if (form.has(key)) answers[key] = String(form.get(key) ?? "").trim() || null;
      }
      for (const key of NUMBER_ANSWERS) {
        if (!form.has(key)) continue;
        const raw = String(form.get(key) ?? "").trim().replace(",", ".");
        answers[key] = raw && Number.isFinite(Number(raw)) ? Number(raw) : null;
      }
      for (const key of BOOLEAN_ANSWERS) {
        if (!form.has(key)) continue;
        const value = String(form.get(key));
        answers[key] = value === "yes" ? true : value === "no" ? false : null;
      }
      answers.wallets = form.getAll("wallets").map(String);
      const regionKeys = ["sales_denmark", "sales_nordics", "sales_eu", "sales_usa", "sales_other"];
      if (regionKeys.every((key) => form.has(key))) {
        answers.sales_regions = {
          denmark: Number(form.get("sales_denmark")) || 0,
          nordics: Number(form.get("sales_nordics")) || 0,
          eu: Number(form.get("sales_eu")) || 0,
          usa: Number(form.get("sales_usa")) || 0,
          other: Number(form.get("sales_other")) || 0,
        };
      }
      await saveAnswers(env.DB, id, answers);
      const saved = await loadPack(env.DB, id);
      if (saved) {
        const allAnswers = Object.fromEntries(
          saved.answers.map((answer) => [answer.key, answerValue(saved, answer.key)]),
        );
        const baseSector = verticalByKey(
          vertical || saved.application.vertical_key,
        )?.sector ?? 0;
        const derivedSector = deriveSectorFromAnswers(baseSector, allAnswers);
        if (derivedSector !== saved.application.vertical_sector) {
          await env.DB
            .prepare(
              `UPDATE onboarding_application
               SET vertical_sector = ?2, updated_at_ms = ?3 WHERE id = ?1`,
            )
            .bind(id, derivedSector, Date.now())
            .run();
          await applyScreening(env.DB, id, actor.email);
        }
      }
    } else if (step === "eigarar") {
      const names = form.getAll("owner_name").map(String);
      const emails = form.getAll("owner_email").map(String);
      const roles = form.getAll("owner_role").map(String);
      const percentages = form.getAll("owner_bps").map(String);
      const signatories = new Set(form.getAll("owner_signatory").map(String));
      await saveOwners(
        env.DB,
        id,
        names.map((name, index) => ({
          name,
          email: emails[index],
          role: roles[index],
          ownership_bps: percentages[index]
            ? Math.round(Number(percentages[index]) * 100)
            : null,
          is_signatory: signatories.has(String(index)),
        })),
      );
    } else if (step === "roknskapur") {
      const equity = String(form.get("equity") ?? "") as FinanceFlag;
      const operations = String(form.get("operations") ?? "") as FinanceFlag;
      if (
        ["positive", "negative", "unknown"].includes(equity) &&
        ["positive", "negative", "unknown"].includes(operations)
      ) {
        await saveFinances(env.DB, id, equity, operations, actor.email);
      }
    } else if (step === "banki" && form.has("bank_account")) {
      await saveBank(env.DB, id, String(form.get("bank_account") ?? ""));
    } else if (step === "skjol" && form.has("additional_comments")) {
      await saveAnswers(env.DB, id, {
        additional_comments: String(form.get("additional_comments") ?? "").trim() || null,
      });
    }

    const savedAt = Date.now();
    return Response.json(
      { savedAt },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json({ error: "save failed" }, { status: 422 });
  }
};
