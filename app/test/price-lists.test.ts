import { describe, expect, it } from "vitest";
import { freshDatabase, seedMerchant } from "./helpers/sqlite";
import {
  getActivePriceList,
  getOrCreateApplication,
  priceListHasRates,
  saveOwners,
} from "~/lib/onboarding/application";
import {
  officialRatesFromForm,
  parseOfficialRates,
} from "~/lib/onboarding/official-rates";
import { approvePriceList, savePriceListDraft } from "~/lib/onboarding/price-lists";
import { PRICE_CATEGORIES, getOfficialTemplate } from "~/lib/onboarding/swedbank";
import { verticalByKey } from "~/lib/onboarding/verticals";
import type { ObjectBucket } from "~/lib/db/types";

function completeRates() {
  return {
    establishmentFeeMinor: 10_000,
    monthlyFeeMinor: 5_000,
    minimumMonthlyPaymentMinor: 0,
    priceCategory: "FO test",
    cardRates: Object.fromEntries(
      PRICE_CATEGORIES.map((category) => [
        category,
        {
          visa: { transactionMinor: 50, basisPoints: 150 },
          mastercard: { transactionMinor: 50, basisPoints: 150 },
          diners: { transactionMinor: 75, basisPoints: 200 },
        },
      ]),
    ),
  };
}

describe("official FO price lists", () => {
  it("rejects incomplete rate JSON", () => {
    expect(parseOfficialRates("{}")).toBeNull();
    expect(parseOfficialRates("[]")).toBeNull();
    expect(priceListHasRates({
      id: "x",
      kind: "standard",
      version: 1,
      currency: "DKK",
      country_code: "FO",
      rates_json: "[]",
    })).toBe(false);
  });

  it("parses a complete matrix from the staff form", () => {
    const rates = completeRates();
    const form = new FormData();
    form.set("rates_json", JSON.stringify(rates));
    expect(officialRatesFromForm(form)).toEqual(rates);
  });

  it("ignores drafts until a staff member approves them", async () => {
    const db = freshDatabase();
    const actor = { id: "u1", email: "ingvar@betal.fo" };
    const draft = await savePriceListDraft(db, {
      kind: "standard",
      rates: completeRates(),
      sourceNote: "Swedbank Pay FO test sheet",
      actor,
    });
    expect(draft.status).toBe("draft");
    expect(await getActivePriceList(db, "standard")).toBeNull();

    const approved = await approvePriceList(db, {
      id: draft.id,
      actor,
    });
    expect(approved.status).toBe("approved");
    expect((await getActivePriceList(db, "standard"))?.id).toBe(draft.id);
    expect(await getActivePriceList(db, "sector2")).toBeNull();
  });

  it("refuses approval without a commercial source", async () => {
    const db = freshDatabase();
    const draft = await savePriceListDraft(db, {
      kind: "sector2",
      rates: completeRates(),
      sourceNote: "",
      actor: { id: "u1", email: "ingvar@betal.fo" },
    });
    await expect(
      approvePriceList(db, {
        id: draft.id,
        actor: { id: "u1", email: "ingvar@betal.fo" },
      }),
    ).rejects.toThrow(/kelda/);
  });
});

describe("approved official templates", () => {
  it("keeps the FO agreement active and approved", () => {
    const db = freshDatabase();
    const rows = db.query<{ kind: string; active: number; approval_status: string }>(
      `SELECT kind, active, approval_status FROM document_template ORDER BY kind`,
    );
    expect(rows).toEqual([
      { kind: "agreement", active: 1, approval_status: "approved" },
      { kind: "bank_confirmation", active: 1, approval_status: "approved" },
      { kind: "prohibited_business", active: 1, approval_status: "approved" },
    ]);
  });

  it("will not load a pending template even if it is marked active", async () => {
    const db = freshDatabase();
    db.raw
      .prepare(`UPDATE document_template SET approval_status = 'pending' WHERE kind = 'agreement'`)
      .run();
    const objects = new Map<string, Uint8Array>();
    const bucket: ObjectBucket = {
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
    await expect(getOfficialTemplate(db, bucket, "agreement")).rejects.toThrow(/virkið/);
  });
});

describe("policy verticals", () => {
  it("treats online gambling as Swedbank sector 2", () => {
    expect(verticalByKey("online-gambling")?.sector).toBe(2);
    expect(verticalByKey("gambling")).toBeNull();
    expect(verticalByKey("crypto")?.sector).toBe(1);
    expect(verticalByKey("cafe")?.sector).toBe(0);
  });
});

describe("owner lock after Skriva", () => {
  it("refuses to replace owners once a signing request exists", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    await saveOwners(db, app.id, [{
      name: "Anna",
      email: "anna@example.fo",
      is_signatory: true,
    }]);
    db.raw
      .prepare(
        `INSERT INTO onboarding_signing (id, application_id, provider, status, created_at_ms)
         VALUES (?, ?, 'skriva', 'sent', 1)`,
      )
      .run(crypto.randomUUID(), app.id);

    await expect(
      saveOwners(db, app.id, [{ name: "Bárður", email: "bardur@example.fo", is_signatory: true }]),
    ).rejects.toThrow(/undirskrift/);
  });
});
