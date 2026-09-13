import { describe, expect, it } from "vitest";
import { freshDatabase, seedMerchant } from "./helpers/sqlite";
import {
  getOrCreateApplication,
  loadPack,
  saveBusinessProfile,
  saveAnswers,
  saveCompany,
  saveFinances,
  saveOwners,
  saveVertical,
  type ApplicationPack,
} from "~/lib/onboarding/application";
import { priceListKind, screenApplication } from "~/lib/onboarding/screening";
import {
  canGenerateSwedbankAgreement,
  firstIncompleteStep,
  isStepComplete,
} from "~/lib/onboarding/steps";
import { canFillAgreement, canSendToSkriva, fillAgreementPdf, fillBankFormPdf } from "~/lib/onboarding/pdf";
import { getDocumentBytes, putDocument } from "~/lib/onboarding/documents";
import type { ObjectBucket } from "~/lib/db/types";
import { readFileSync } from "node:fs";
import { PRICE_CATEGORIES } from "~/lib/onboarding/swedbank";
import type { PriceList } from "~/lib/onboarding/application";

const completeBusinessAnswers = {
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
  gift_cards: false,
  primary_customers: "consumers",
  payment_link_mode: "none",
  save_card: false,
  wallets: [],
  other_mit: false,
  website_terms: true,
  made_to_order: false,
  made_to_order_days: null,
  donations: false,
  sales_regions: { denmark: 0, nordics: 100, eu: 0, usa: 0, other: 0 },
};

const agreementTemplate = new Uint8Array(
  readFileSync(new URL("../assets/swedbank/Kortindlosning-Online-FO.pdf", import.meta.url)),
);
const bankTemplate = new Uint8Array(
  readFileSync(new URL("../assets/swedbank/Swedbank Pay - Bekræftelse af konto.pdf", import.meta.url)),
);
const officialPriceList: PriceList = {
  id: "pl",
  kind: "standard",
  version: 1,
  currency: "DKK",
  country_code: "FO",
  rates_json: JSON.stringify({
    establishmentFeeMinor: 10000,
    monthlyFeeMinor: 5000,
    minimumMonthlyPaymentMinor: 0,
    priceCategory: "FO standard test",
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

function emptyPack(overrides: Partial<ApplicationPack["application"]> = {}): ApplicationPack {
  return {
    application: {
      id: "a1",
      merchant_id: "m1",
      lead_id: null,
      state: "draft",
      recommended_acquirer: "swedbank",
      chosen_acquirer: null,
      country_code: "FO",
      legal_name: "Handil P/F",
      v_tal: "123456",
      address_line_one: "Bryggjubakki 1",
      address_line_two: null,
      postal_code: "100",
      city: "Tórshavn",
      company_type: "P/F Partafelag",
      registry_source: "manual",
      registry_id: null,
      registry_status: null,
      registry_checked_at_ms: null,
      registry_snapshot: null,
      company_details_confirmed: 1,
      policy_id: null,
      final_snapshot_id: null,
      locked_at_ms: null,
      website: "https://handil.fo",
      sells: "Kaffi",
      vertical_key: "cafe",
      vertical_sector: 0,
      equity: "positive",
      operations: "positive",
      bank_account: "9175-123456",
      screening_reason: null,
      screening_at_ms: null,
      screening_by: null,
      extra_docs_required: 0,
      reject_reason: null,
      request_note: null,
      created_at_ms: 1,
      updated_at_ms: 1,
      ...overrides,
    },
    owners: [
      {
        id: "o1",
        application_id: "a1",
        name: "Anna",
        email: "anna@handil.fo",
        p_tal: "320000001",
        role: "Stjóri",
        ownership_bps: 10000,
        is_signatory: 1,
        sort_order: 0,
      },
    ],
    documents: [],
    signings: [],
    events: [],
    answers: Object.entries(completeBusinessAnswers).map(([key, value]) => ({
      application_id: "a1",
      key,
      value_json: JSON.stringify(value),
      source: "merchant",
      confirmed_at_ms: 1,
      updated_at_ms: 1,
    })),
  };
}

describe("screening", () => {
  it("routes sector 1 off Swedbank", () => {
    const result = screenApplication({
      sector: 1,
      equity: "positive",
      operations: "positive",
    });
    expect(result.recommended).toBe("clearhaus");
    expect(result.refuseSwedbank).toBe(true);
  });

  it("routes negative equity off Swedbank", () => {
    expect(
      screenApplication({ sector: 0, equity: "negative", operations: "positive" }).recommended,
    ).toBe("clearhaus");
  });

  it("routes negative operations off Swedbank", () => {
    expect(
      screenApplication({ sector: 0, equity: "positive", operations: "negative" }).recommended,
    ).toBe("clearhaus");
  });

  it("keeps sector 2 on Swedbank with extra docs", () => {
    const result = screenApplication({
      sector: 2,
      equity: "positive",
      operations: "positive",
    });
    expect(result.recommended).toBe("swedbank");
    expect(result.extraDocs).toBe(true);
  });

  it("defaults to Swedbank", () => {
    const result = screenApplication({
      sector: 0,
      equity: "positive",
      operations: "positive",
    });
    expect(result.recommended).toBe("swedbank");
    expect(result.extraDocs).toBe(false);
  });

  it("requests accounts for unknown finances without using sector-2 prices", () => {
    const result = screenApplication({
      sector: 0,
      equity: "unknown",
      operations: "positive",
    });
    expect(result.recommended).toBe("swedbank");
    expect(result.extraDocs).toBe(true);
    expect(priceListKind(result)).toBe("standard");
  });
});

describe("wizard resume", () => {
  it("lands on the first incomplete step", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    let pack = await loadPack(db, app.id);
    expect(pack).not.toBeNull();
    expect(firstIncompleteStep(pack!)).toBe("felag");

    await saveCompany(db, app.id, {
      legal_name: "Handil P/F",
      v_tal: "123456",
      company_type: "P/F Partafelag",
      address_line_one: "Gongin 1",
      postal_code: "100",
      city: "Tórshavn",
    });
    pack = await loadPack(db, app.id);
    expect(firstIncompleteStep(pack!)).toBe("vinnugrein");

    await saveBusinessProfile(db, app.id, "cafe", "Kaffi og køkur", "https://handil.fo", "test@betal.fo");
    pack = await loadPack(db, app.id);
    expect(firstIncompleteStep(pack!)).toBe("vinnugrein");
    await saveAnswers(db, app.id, completeBusinessAnswers);
    pack = await loadPack(db, app.id);
    expect(firstIncompleteStep(pack!)).toBe("eigarar");
    expect(pack!.application.recommended_acquirer).toBe("swedbank");
  });

  it("requires a signatory but gets P-tal from Samleikin later", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    await saveOwners(db, app.id, [
      { name: "Anna", is_signatory: false },
    ]);
    const pack = await loadPack(db, app.id);
    expect(isStepComplete("eigarar", pack!)).toBe(false);

    await saveOwners(db, app.id, [
      { name: "Anna", is_signatory: true },
    ]);
    const missingEmail = await loadPack(db, app.id);
    expect(isStepComplete("eigarar", missingEmail!)).toBe(false);

    await saveOwners(db, app.id, [
      { name: "Anna", email: "anna@example.fo", is_signatory: true },
    ]);
    const next = await loadPack(db, app.id);
    expect(isStepComplete("eigarar", next!)).toBe(true);
  });

  it("unlocks annual accounts for sector 2", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    await saveVertical(db, app.id, "travel", "test@betal.fo");
    const pack = await loadPack(db, app.id);
    expect(pack!.application.extra_docs_required).toBe(1);
    expect(pack!.application.recommended_acquirer).toBe("swedbank");
  });
});

describe("FO agreement fill", () => {
  it("refuses to generate a Swedbank PDF after a red flag", () => {
    const pack = emptyPack({ recommended_acquirer: "clearhaus" });
    expect(canGenerateSwedbankAgreement(pack)).toBe(false);
    expect(canFillAgreement(pack).ok).toBe(false);
  });

  it("produces a valid FO PDF when the pack is Swedbank-ready", async () => {
    const pack = emptyPack();
    const bytes = await fillAgreementPdf(pack, officialPriceList, agreementTemplate);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(200_000);
    const { PDFDocument } = await import("pdf-lib");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(5);
    expect(loaded.getForm().getFields()).toHaveLength(0);
    expect(canSendToSkriva(pack, null, true).ok).toBe(false);
    expect(canSendToSkriva(pack, officialPriceList, true).ok).toBe(true);
  });

  it("blocks Skriva when the price list is empty even if fill works", () => {
    const pack = emptyPack();
    expect(canFillAgreement(pack).ok).toBe(true);
    expect(
      canSendToSkriva(
        pack,
        {
          id: "pl",
          kind: "standard",
          version: 1,
          currency: "DKK",
          country_code: "FO",
          rates_json: "[]",
        },
        true,
      ).ok,
    ).toBe(false);
  });

  it("pre-fills the bank confirmation", async () => {
    const bytes = await fillBankFormPdf(emptyPack(), bankTemplate);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    expect(loaded.getForm().getFields()).toHaveLength(0);
  });

  it("stores an uploaded document on the pack", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    await putDocument(db, {
      applicationId: app.id,
      kind: "company_registration",
      fileName: "skasetan.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3, 4]),
      uploadedBy: "eigari@handil.fo",
    });
    const pack = await loadPack(db, app.id);
    expect(pack!.documents[0]?.kind).toBe("company_registration");
    expect(pack!.documents[0]?.byte_size).toBe(4);
  });

  it("stores large private documents in R2 and verifies their hash", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    const objects = new Map<string, Uint8Array>();
    const bucket: ObjectBucket = {
      async put(key, value) {
        objects.set(key, new Uint8Array(value));
      },
      async get(key) {
        const value = objects.get(key);
        return value
          ? { async arrayBuffer() { return value.slice().buffer; } }
          : null;
      },
      async delete(key) {
        objects.delete(key);
      },
    };
    const value = new Uint8Array(2_000_000).fill(7);
    await putDocument(db, {
      applicationId: app.id,
      kind: "owners_book",
      fileName: "eigarabok.pdf",
      contentType: "application/pdf",
      bytes: value,
      uploadedBy: "anna@example.fo",
    }, { bucket });

    const row = db.query<{
      storage: string;
      bytes: Uint8Array | null;
      r2_key: string;
      sha256: string;
    }>("SELECT storage, bytes, r2_key, sha256 FROM onboarding_document")[0]!;
    expect(row.storage).toBe("r2");
    expect(row.bytes).toBeNull();
    expect(row.r2_key).toContain(`/owners_book/`);
    const loaded = await getDocumentBytes(db, app.id, "owners_book", bucket);
    expect(loaded?.bytes).toEqual(value);
    expect(loaded?.sha256).toBe(row.sha256);
  });
});

describe("finances screening persistence", () => {
  it("writes the recommendation when finances are saved", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    await saveVertical(db, app.id, "cafe", "staff@betal.fo");
    await saveFinances(db, app.id, "negative", "positive", "staff@betal.fo");
    const pack = await loadPack(db, app.id);
    expect(pack!.application.recommended_acquirer).toBe("clearhaus");
    expect(canGenerateSwedbankAgreement(pack!)).toBe(false);
  });
});
