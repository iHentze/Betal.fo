import { describe, expect, it } from "vitest";
import { freshDatabase, seedMerchant } from "./helpers/sqlite";
import {
  getOrCreateApplication,
  loadPack,
  saveCompany,
  saveFinances,
  saveOwners,
  saveVertical,
  type ApplicationPack,
} from "~/lib/onboarding/application";
import { screenApplication } from "~/lib/onboarding/screening";
import {
  canGenerateSwedbankAgreement,
  firstIncompleteStep,
  isStepComplete,
} from "~/lib/onboarding/steps";
import { canFillAgreement, canSendToSkriva, fillAgreementPdf, fillBankFormPdf } from "~/lib/onboarding/pdf";
import { putDocument } from "~/lib/onboarding/documents";

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
      website: null,
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
      address_line_one: "Gongin 1",
      postal_code: "100",
      city: "Tórshavn",
      sells: "Kaffi",
    });
    pack = await loadPack(db, app.id);
    expect(firstIncompleteStep(pack!)).toBe("vinnugrein");

    await saveVertical(db, app.id, "cafe", "test@betal.fo");
    pack = await loadPack(db, app.id);
    expect(firstIncompleteStep(pack!)).toBe("eigarar");
    expect(pack!.application.recommended_acquirer).toBe("swedbank");
  });

  it("requires a signatory before owners is complete", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    await saveOwners(db, app.id, [
      { name: "Anna", p_tal: "010101123", is_signatory: false },
    ]);
    const pack = await loadPack(db, app.id);
    expect(isStepComplete("eigarar", pack!)).toBe(false);

    await saveOwners(db, app.id, [
      { name: "Anna", p_tal: "010101123", is_signatory: true },
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
    const bytes = await fillAgreementPdf(pack, null);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(800);
    const { PDFDocument } = await import("pdf-lib");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    expect(canSendToSkriva(pack, null, true).ok).toBe(false);
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
    const bytes = await fillBankFormPdf(emptyPack());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
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
