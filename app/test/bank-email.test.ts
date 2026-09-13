import { describe, expect, it } from "vitest";
import {
  bankRequestIdempotencyKey,
  buildBankRequestEmail,
  cleanEmailAddress,
  type BankEmailInput,
} from "~/lib/onboarding/bank-email";
import { applyBankEmailDeliveryEvent } from "~/lib/onboarding/email-delivery";
import { getOrCreateApplication } from "~/lib/onboarding/application";
import { freshDatabase, seedMerchant } from "./helpers/sqlite";

const input = (overrides: Partial<BankEmailInput> = {}): BankEmailInput => ({
  from: "Betal <banki@betal.fo>",
  to: "radgevi@banki.fo",
  cc: "eigari@handil.fo",
  companyName: "Handilin við Bryggjuni Sp/f",
  vTal: "654321",
  applicationId: "66666666-6666-4666-8666-666666666666",
  attachment: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
  ...overrides,
});

describe("bank request transactional email", () => {
  it("puts the bank in To and the merchant in CC and Reply-To", () => {
    const email = buildBankRequestEmail(input());
    expect(email.from).toBe("Betal <banki@betal.fo>");
    expect(email.to).toBe("radgevi@banki.fo");
    expect(email.cc).toBe("eigari@handil.fo");
    expect(email.replyTo).toBe("eigari@handil.fo");
    expect(email.subject).toBe("Váttan av bankakontu – V-tal 654321");
  });

  it("attaches the PDF without putting the account number in the email", () => {
    const email = buildBankRequestEmail(input());
    expect(email.attachments).toEqual([{
      filename: "bankastadfesting.pdf",
      content: "JVBERi0=",
      contentType: "application/pdf",
    }]);
    expect(email.text).toContain("Svara øllum");
    expect(email.text).not.toContain("6460-1234567890");
  });

  it("rejects malformed or injected recipients", () => {
    expect(() => cleanEmailAddress("banki@example.fo\r\nBcc: attacker@example.com", "bankan"))
      .toThrow("Skriva ein gildugan teldupost");
    expect(() => cleanEmailAddress("ikki-ein-teldupostur", "CC"))
      .toThrow("Skriva ein gildugan teldupost");
  });

  it("uses a stable payload-specific idempotency key", async () => {
    const first = await bankRequestIdempotencyKey(input());
    expect(await bankRequestIdempotencyKey(input())).toBe(first);
    expect(await bankRequestIdempotencyKey(input({ to: "annar@banki.fo" }))).not.toBe(first);
    expect(first).toMatch(/^bank-request\/66666666-6666-4666-8666-666666666666\/[a-f0-9]{32}$/);
  });

  it("tracks delivered webhooks once", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    db.raw.prepare(
      `INSERT INTO onboarding_bank_email (
         idempotency_key, application_id, bank_email, cc_email, provider_id,
         sent_at_ms
       ) VALUES ('bank-request/a1/hash', ?, 'bank@example.fo', 'owner@example.fo',
                 'email_123', 1)`,
    ).run(app.id);

    expect(await applyBankEmailDeliveryEvent(db, {
      eventId: "evt_1",
      type: "email.delivered",
      providerEmailId: "email_123",
      receivedAtMs: 2,
    })).toBe("applied");
    expect(await applyBankEmailDeliveryEvent(db, {
      eventId: "evt_1",
      type: "email.delivered",
      providerEmailId: "email_123",
      receivedAtMs: 3,
    })).toBe("duplicate");

    const row = db.query<{ status: string; delivered_at_ms: number }>(
      "SELECT status, delivered_at_ms FROM onboarding_bank_email",
    )[0]!;
    expect(row).toEqual({ status: "delivered", delivered_at_ms: 2 });
  });
});
