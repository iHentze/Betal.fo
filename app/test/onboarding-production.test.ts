import { describe, expect, it } from "vitest";
import { freshDatabase, seedMerchant } from "./helpers/sqlite";
import {
  getOrCreateApplication,
  loadPack,
  saveAnswers,
  saveBank,
  saveBusinessProfile,
  saveCompany,
  saveFinances,
  saveOwners,
  type PriceList,
} from "~/lib/onboarding/application";
import { putDocument } from "~/lib/onboarding/documents";
import { createFinalSnapshot, getActivePolicy } from "~/lib/onboarding/snapshot";
import { createDocumentInstance } from "~/lib/onboarding/document-instances";
import { PRICE_CATEGORIES, type DocumentTemplate } from "~/lib/onboarding/swedbank";
import type { ObjectBucket } from "~/lib/db/types";

const answers = {
  annual_card_turnover_dkk: 1_000_000,
  average_transaction_dkk: 500,
  market_name: "Handilin",
  contact_name: "Anna Eigari",
  contact_phone: "+298 123456",
  contact_email: "anna@example.fo",
  invoice_email: "rokning@example.fo",
  product_type: "physical",
  inventory: "yes",
  delivery_method: "postur",
  delivery_days: 2,
  subscriptions: false,
  donations: false,
  gift_cards: false,
  primary_customers: "consumers",
  payment_link_mode: "none",
  save_card: false,
  wallets: [],
  other_mit: false,
  website_terms: true,
  made_to_order: false,
  sales_regions: { denmark: 0, nordics: 100, eu: 0, usa: 0, other: 0 },
};

function priceList(): PriceList {
  return {
    id: "pl1",
    kind: "standard",
    version: 1,
    currency: "DKK",
    country_code: "FO",
    rates_json: JSON.stringify({
      establishmentFeeMinor: 10_000,
      monthlyFeeMinor: 5_000,
      minimumMonthlyPaymentMinor: 0,
      priceCategory: "test",
      cardRates: Object.fromEntries(PRICE_CATEGORIES.map((category) => [
        category,
        {
          visa: { transactionMinor: 50, basisPoints: 150 },
          mastercard: { transactionMinor: 50, basisPoints: 150 },
          diners: { transactionMinor: 75, basisPoints: 200 },
        },
      ])),
    }),
  };
}

function bucket(): ObjectBucket & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, value) {
      objects.set(key, new Uint8Array(value));
    },
    async get(key) {
      const value = objects.get(key);
      return value ? { async arrayBuffer() { return value.slice().buffer; } } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

describe("production onboarding snapshot", () => {
  it("locks one immutable snapshot and stores its final PDF instance", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    await saveCompany(db, app.id, {
      legal_name: "Handilin Sp/f",
      v_tal: "123456",
      company_type: "Sp/F Smápartafelag",
      address_line_one: "Gøta 1",
      postal_code: "100",
      city: "Tórshavn",
    });
    await saveBusinessProfile(
      db,
      app.id,
      "cafe",
      "Kaffi og køkur",
      "https://handil.fo",
      "anna@example.fo",
    );
    await saveAnswers(db, app.id, answers);
    await saveOwners(db, app.id, [{
      name: "Anna Eigari",
      email: "anna@example.fo",
      ownership_bps: 10_000,
      is_signatory: true,
    }]);
    await saveFinances(db, app.id, "positive", "positive", "anna@example.fo");
    await saveBank(db, app.id, "64601234567890");
    for (const kind of ["bank_confirmation", "company_registration", "owners_book"] as const) {
      await putDocument(db, {
        applicationId: app.id,
        kind,
        fileName: `${kind}.pdf`,
        contentType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
        uploadedBy: "anna@example.fo",
      });
    }

    const list = priceList();
    db.raw.prepare(
      `INSERT INTO acquiring_price_list (
         id, kind, version, currency, country_code, rates_json, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      list.id,
      list.kind,
      list.version,
      list.currency,
      list.country_code,
      list.rates_json,
      1,
    );

    const pack = (await loadPack(db, app.id))!;
    const policy = (await getActivePolicy(db))!;
    const template = db.query<DocumentTemplate>(
      "SELECT * FROM document_template WHERE kind = 'agreement'",
    )[0]!;
    const first = await createFinalSnapshot(db, {
      pack,
      policyId: policy.id,
      priceList: list,
      agreementTemplate: template,
      actorEmail: "anna@example.fo",
    }, () => 10);
    const second = await createFinalSnapshot(db, {
      pack,
      policyId: policy.id,
      priceList: list,
      agreementTemplate: template,
      actorEmail: "anna@example.fo",
    }, () => 20);
    expect(second.id).toBe(first.id);
    expect(JSON.parse(first.signer_set_json)).toHaveLength(1);
    expect(db.query<{ locked_at_ms: number; state: string }>(
      "SELECT locked_at_ms, state FROM onboarding_application",
    )[0]).toEqual({ locked_at_ms: 10, state: "ready_for_signing" });

    const store = bucket();
    const instance = await createDocumentInstance(db, store, {
      applicationId: app.id,
      templateId: template.id,
      snapshotId: first.id,
      kind: "agreement",
      state: "final",
      bytes: new TextEncoder().encode("%PDF-final"),
      createdBy: "anna@example.fo",
    }, () => 11);
    expect(instance.sha256).toHaveLength(64);
    expect(store.objects.has(instance.r2_key)).toBe(true);
  });
});
