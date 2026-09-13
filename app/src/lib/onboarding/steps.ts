import { fo } from "~/content/fo";
import type { ApplicationPack } from "./application";

export const STEP_SLUGS = [
  "felag",
  "vinnugrein",
  "eigarar",
  "roknskapur",
  "banki",
  "skjol",
  "undirskriva",
  "bida",
] as const;

export type StepSlug = (typeof STEP_SLUGS)[number];

export function isStepSlug(value: string): value is StepSlug {
  return (STEP_SLUGS as readonly string[]).includes(value);
}

export function stepLabel(slug: StepSlug): string {
  return fo.onboarding.steps[slug];
}

export function stepWhy(slug: StepSlug): string {
  return fo.onboarding.why[slug];
}

export function hasDocument(
  pack: Pick<ApplicationPack, "documents">,
  kind: string,
): boolean {
  return pack.documents.some((doc) => doc.kind === kind && doc.byte_size && doc.byte_size > 0);
}

export function isStepComplete(slug: StepSlug, pack: ApplicationPack): boolean {
  const app = pack.application;
  switch (slug) {
    case "felag":
      return Boolean(
        app.company_details_confirmed &&
        app.legal_name &&
          app.v_tal &&
          app.company_type &&
          app.address_line_one &&
          app.city &&
          app.postal_code,
      );
    case "vinnugrein":
      return Boolean(app.vertical_key && app.sells);
    case "eigarar":
      return (
        pack.owners.length > 0 &&
        pack.owners.some((owner) => owner.is_signatory && owner.email) &&
        pack.owners.every((owner) => owner.name)
      );
    case "roknskapur":
      return Boolean(app.equity && app.operations);
    case "banki":
      return Boolean(app.bank_account) && hasDocument(pack, "bank_confirmation");
    case "skjol": {
      const base =
        hasDocument(pack, "company_registration") && hasDocument(pack, "owners_book");
      if (app.extra_docs_required) {
        return base && hasDocument(pack, "annual_accounts");
      }
      return base;
    }
    case "undirskriva":
      if (app.recommended_acquirer && app.recommended_acquirer !== "swedbank") {
        return pack.events.some((event) => event.kind === "acknowledged_reroute");
      }
      return (
        pack.signings.some((row) => row.status === "signed" || row.status === "wet_ink") ||
        (hasDocument(pack, "agreement") && hasDocument(pack, "photo_id"))
      );
    case "bida":
      return isStepComplete("undirskriva", pack);
  }
}

/** First step the merchant still owes. Bíða if the pack is signed. */
export function firstIncompleteStep(pack: ApplicationPack): StepSlug {
  for (const slug of STEP_SLUGS) {
    if (slug === "bida") continue;
    if (!isStepComplete(slug, pack)) return slug;
  }
  return "bida";
}

export function missingDocKinds(pack: ApplicationPack): string[] {
  const missing: string[] = [];
  if (!hasDocument(pack, "company_registration")) missing.push("company_registration");
  if (!hasDocument(pack, "owners_book")) missing.push("owners_book");
  if (!hasDocument(pack, "bank_confirmation")) missing.push("bank_confirmation");
  if (pack.application.extra_docs_required && !hasDocument(pack, "annual_accounts")) {
    missing.push("annual_accounts");
  }
  const swedbank = pack.application.recommended_acquirer !== "clearhaus" &&
    pack.application.recommended_acquirer !== "shift4" &&
    pack.application.recommended_acquirer !== "decline";
  if (swedbank && !hasDocument(pack, "agreement") && !pack.signings.some((s) => s.status === "signed" || s.status === "wet_ink")) {
    missing.push("agreement");
  }
  return missing;
}

export function canGenerateSwedbankAgreement(pack: ApplicationPack): boolean {
  return pack.application.recommended_acquirer === "swedbank";
}
