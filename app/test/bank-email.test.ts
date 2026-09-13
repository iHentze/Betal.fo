import { describe, expect, it } from "vitest";
import {
  bankEmailFileName,
  buildBankRequestEmail,
  cleanEmailAddress,
} from "~/lib/onboarding/bank-email";

const draft = () =>
  buildBankRequestEmail({
    to: "radgevi@banki.fo",
    cc: "eigari@handil.fo",
    companyName: "Handilin við Bryggjuni Sp/f",
    vTal: "654321",
    attachment: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    createdAt: new Date("2026-09-13T03:00:00Z"),
    boundary: "betal_test_boundary",
  });

describe("bank request email draft", () => {
  it("puts the bank in To and the merchant in CC", () => {
    const message = new TextDecoder().decode(draft());
    expect(message).toContain("To: radgevi@banki.fo\r\n");
    expect(message).toContain("Cc: eigari@handil.fo\r\n");
    expect(message).toContain("Reply-To: eigari@handil.fo\r\n");
    expect(message).toContain("X-Unsent: 1\r\n");
  });

  it("attaches the prefilled bank form without putting the account in the body", () => {
    const message = new TextDecoder().decode(draft());
    expect(message).toContain('Content-Type: application/pdf; name="bankastadfesting.pdf"');
    expect(message).toContain("JVBERi0=");
    expect(message).not.toContain("6460-1234567890");
  });

  it("rejects malformed or injected recipients", () => {
    expect(() => cleanEmailAddress("banki@example.fo\r\nBcc: attacker@example.com", "bankan"))
      .toThrow("Skriva ein gildugan teldupost");
    expect(() => cleanEmailAddress("ikki-ein-teldupostur", "CC"))
      .toThrow("Skriva ein gildugan teldupost");
  });

  it("uses a safe V-tal based filename", () => {
    expect(bankEmailFileName("65 43/21")).toBe("bankafyrispurningur-654321.eml");
  });
});
