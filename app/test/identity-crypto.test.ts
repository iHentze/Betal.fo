import { describe, expect, it } from "vitest";
import {
  decryptPersonalIdentificationNumber,
  encryptPersonalIdentificationNumber,
} from "~/lib/onboarding/identity-crypto";

describe("Samleikin identity encryption", () => {
  it("encrypts P-tal with random AES-GCM IVs and exposes only the last four", async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const first = await encryptPersonalIdentificationNumber("010101123", key);
    const second = await encryptPersonalIdentificationNumber("010101123", key);
    expect(first.last4).toBe("1123");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.ciphertext).not.toContain("010101123");
    expect(await decryptPersonalIdentificationNumber(first.ciphertext, key))
      .toBe("010101123");
  });

  it("rejects keys that are not 32 bytes", async () => {
    await expect(encryptPersonalIdentificationNumber("010101123", btoa("short")))
      .rejects.toThrow("32-byte key");
  });
});
