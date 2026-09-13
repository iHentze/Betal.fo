import { answerValue, type ApplicationPack } from "./application";
import { BUSINESS_REQUIRED_ANSWERS, salesRegionsTotal, type SalesRegions } from "./questionnaire";
import { hasDocument, type StepSlug } from "./steps";

export interface StepProgress {
  slug: StepSlug;
  complete: number;
  total: number;
  missing: string[];
}

function result(slug: StepSlug, checks: Array<[string, boolean]>): StepProgress {
  return {
    slug,
    complete: checks.filter(([, complete]) => complete).length,
    total: checks.length,
    missing: checks.filter(([, complete]) => !complete).map(([key]) => key),
  };
}

export function progressForStep(slug: StepSlug, pack: ApplicationPack): StepProgress {
  const app = pack.application;
  switch (slug) {
    case "felag":
      return result(slug, [
        ["legal_name", Boolean(app.legal_name)],
        ["v_tal", Boolean(app.v_tal)],
        ["company_type", Boolean(app.company_type)],
        ["address", Boolean(app.address_line_one && app.postal_code && app.city)],
        ["country_fo", app.country_code === "FO"],
        ["company_confirmed", Boolean(app.company_details_confirmed)],
      ]);
    case "vinnugrein": {
      const checks: Array<[string, boolean]> = [
        ["sells", Boolean(app.sells)],
        ["website", Boolean(app.website)],
        ["vertical_key", Boolean(app.vertical_key)],
        ...BUSINESS_REQUIRED_ANSWERS.map((key) => [
          key,
          answerValue(pack, key) !== null,
        ] as [string, boolean]),
      ];
      const regions = answerValue<SalesRegions>(pack, "sales_regions");
      checks.push(["sales_regions_total", salesRegionsTotal(regions) === 100]);
      if (answerValue<boolean>(pack, "save_card")) {
        checks.push(["save_card_in_app", answerValue(pack, "save_card_in_app") !== null]);
      }
      if (answerValue<boolean>(pack, "donations")) {
        checks.push([
          "donations_supervised",
          answerValue(pack, "donations_supervised") !== null,
        ]);
      }
      if (answerValue<boolean>(pack, "made_to_order")) {
        for (const key of [
          "made_to_order_days",
          "made_to_order_share_percent",
          "deposit",
          "final_payment_when",
          "final_payment_method",
        ]) {
          checks.push([key, answerValue(pack, key) !== null]);
        }
        if (answerValue<boolean>(pack, "deposit")) {
          checks.push([
            "deposit_share_percent",
            answerValue(pack, "deposit_share_percent") !== null,
          ]);
        }
      }
      return result(slug, checks);
    }
    case "eigarar": {
      const signatories = pack.owners.filter((owner) => owner.is_signatory);
      return result(slug, [
        ["owners", pack.owners.length > 0],
        ["owner_names", pack.owners.length > 0 && pack.owners.every((owner) => Boolean(owner.name))],
        ["signatory", signatories.length > 0],
        ["signatory_email", signatories.length > 0 && signatories.every((owner) => Boolean(owner.email))],
      ]);
    }
    case "roknskapur":
      return result(slug, [
        ["equity", Boolean(app.equity)],
        ["operations", Boolean(app.operations)],
      ]);
    case "banki":
      return result(slug, [
        ["bank_account", Boolean(app.bank_account)],
        ["bank_confirmation", hasDocument(pack, "bank_confirmation")],
      ]);
    case "skjol": {
      const checks: Array<[string, boolean]> = [
        ["company_registration", hasDocument(pack, "company_registration")],
        ["owners_book", hasDocument(pack, "owners_book")],
      ];
      if (app.extra_docs_required) {
        checks.push(["annual_accounts", hasDocument(pack, "annual_accounts")]);
      }
      if (app.vertical_sector === 2) {
        checks.push(["industry_answers", hasDocument(pack, "industry_answers")]);
      }
      return result(slug, checks);
    }
    case "undirskriva": {
      const selected = pack.owners.filter((owner) => owner.is_signatory);
      const latestRequestId = pack.signings.find(
        (row) => row.provider === "skriva" && row.signing_request_id,
      )?.signing_request_id;
      const signedOwners = new Set(
        pack.signings
          .filter(
            (row) =>
              row.provider === "skriva" &&
              row.signing_request_id === latestRequestId &&
              row.status === "signed" &&
              row.owner_id,
          )
          .map((row) => row.owner_id),
      );
      return result(
        slug,
        selected.length > 0
          ? selected.map((owner) => [`signer:${owner.id}`, signedOwners.has(owner.id)])
          : [["signers", false]],
      );
    }
    case "bida":
      return result(slug, [["submitted_pack", app.state === "pack_ready" || app.state === "submitted" || app.state === "approved"]]);
  }
}

export function applicationProgress(pack: ApplicationPack): {
  steps: StepProgress[];
  complete: number;
  total: number;
  percentage: number;
  missing: number;
} {
  const steps = ([
    "felag",
    "vinnugrein",
    "eigarar",
    "roknskapur",
    "banki",
    "skjol",
    "undirskriva",
  ] as StepSlug[]).map((slug) => progressForStep(slug, pack));
  const complete = steps.reduce((sum, step) => sum + step.complete, 0);
  const total = steps.reduce((sum, step) => sum + step.total, 0);
  return {
    steps,
    complete,
    total,
    percentage: total === 0 ? 0 : Math.round((complete / total) * 100),
    missing: total - complete,
  };
}
