import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { requirePack, wizardPath } from "~/lib/onboarding/access";
import {
  acknowledgeReroute,
  markWetInk,
  saveBank,
  saveCompany,
  saveFinances,
  saveOwners,
  saveVertical,
} from "~/lib/onboarding/application";
import { firstIncompleteStep, isStepSlug, STEP_SLUGS } from "~/lib/onboarding/steps";
import type { FinanceFlag } from "~/lib/onboarding/screening";

export const prerender = false;

function redirectTo(location: string) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function fail(path: string, message: string) {
  return redirectTo(`${path}${path.includes("?") ? "&" : "?"}feilur=${encodeURIComponent(message)}`);
}

export const POST: APIRoute = async ({ params, request, locals, url }) => {
  const actor = locals.actor;
  if (!actor) return new Response("unauthorized", { status: 401 });

  const id = params.id;
  if (!id) return new Response("not found", { status: 404 });

  let pack;
  try {
    pack = await requirePack(env.DB, actor, id, url.searchParams.get("handil"));
  } catch (error) {
    const code = error instanceof Error ? error.message : "forbidden";
    return new Response(code, { status: code === "not_found" ? 404 : 403 });
  }

  const form = await request.formData();
  const step = String(form.get("step") ?? "");
  const stay = form.get("stay") === "1";
  const merchantId = pack.application.merchant_id;
  const here = (slug: string) => wizardPath(id, slug, actor, merchantId);

  if (!isStepSlug(step)) return fail(here("felag"), "Ókent stig");

  try {
    if (step === "felag") {
      const legal_name = String(form.get("legal_name") ?? "").trim();
      const v_tal = String(form.get("v_tal") ?? "").trim();
      const address_line_one = String(form.get("address_line_one") ?? "").trim();
      const postal_code = String(form.get("postal_code") ?? "").trim();
      const city = String(form.get("city") ?? "").trim();
      const sells = String(form.get("sells") ?? "").trim();
      if (!legal_name || !v_tal || !address_line_one || !postal_code || !city || !sells) {
        return fail(here(step), "Útfyll navn, V-tal, adressu og hvat tit selja");
      }
      await saveCompany(env.DB, id, {
        legal_name,
        v_tal,
        address_line_one,
        address_line_two: String(form.get("address_line_two") ?? ""),
        postal_code,
        city,
        website: String(form.get("website") ?? ""),
        sells,
      });
    } else if (step === "vinnugrein") {
      const key = String(form.get("vertical_key") ?? "").trim();
      if (!key) return fail(here(step), "Vel eina vinnugrein");
      await saveVertical(env.DB, id, key, actor.email);
    } else if (step === "eigarar") {
      const names = form.getAll("owner_name").map((v) => String(v));
      const emails = form.getAll("owner_email").map((v) => String(v));
      const ptals = form.getAll("owner_p_tal").map((v) => String(v));
      const roles = form.getAll("owner_role").map((v) => String(v));
      const bps = form.getAll("owner_bps").map((v) => String(v));
      const signatory = new Set(form.getAll("owner_signatory").map((v) => String(v)));
      const owners = names.map((name, index) => ({
        name,
        email: emails[index],
        p_tal: ptals[index],
        role: roles[index],
        ownership_bps: bps[index] ? Math.round(Number(bps[index]) * 100) : null,
        is_signatory: signatory.has(String(index)),
      }));
      if (!owners.some((owner) => owner.name.trim())) {
        return fail(here(step), "Skráset í minsta lagi ein eigara");
      }
      if (!owners.some((owner) => owner.name.trim() && owner.is_signatory)) {
        return fail(here(step), "Í minsta lagi ein eigari má kunna undirskriva");
      }
      await saveOwners(env.DB, id, owners);
    } else if (step === "roknskapur") {
      const equity = String(form.get("equity") ?? "") as FinanceFlag;
      const operations = String(form.get("operations") ?? "") as FinanceFlag;
      if (!equity || !operations) return fail(here(step), "Svara báðum spurningunum");
      await saveFinances(env.DB, id, equity, operations, actor.email);
    } else if (step === "banki") {
      const account = String(form.get("bank_account") ?? "").trim();
      if (!account) return fail(here(step), "Skriva kontunummar");
      await saveBank(env.DB, id, account);
    } else if (step === "skjol") {
      // Documents upload on their own route; continue just advances.
    } else if (step === "undirskriva") {
      const mode = String(form.get("mode") ?? "");
      if (mode === "acknowledge") {
        await acknowledgeReroute(env.DB, id, actor.email);
      } else if (mode === "wet_ink") {
        const hasAgreement = pack.documents.some((d) => d.kind === "agreement" && d.byte_size);
        const hasId = pack.documents.some((d) => d.kind === "photo_id" && d.byte_size);
        if (!hasAgreement || !hasId) {
          return fail(here(step), "Legg undirskrivaðu avtaluna og persónsprógv upp, ella bíða eftir Samleikin");
        }
        await markWetInk(env.DB, id, actor.email);
      }
    }
  } catch (error) {
    return fail(here(step), error instanceof Error ? error.message : String(error));
  }

  const nextPack = await requirePack(env.DB, actor, id, url.searchParams.get("handil"));
  if (stay) return redirectTo(here(step));

  const index = STEP_SLUGS.indexOf(step);
  const next = STEP_SLUGS[index + 1] ?? firstIncompleteStep(nextPack);
  return redirectTo(here(next));
};
