import { describe, expect, it } from "vitest";
import {
  normalizeSkrivaStatus,
  SkrivaClient,
  skrivaConfig,
  skrivaConfigured,
  type SkrivaConfig,
} from "~/lib/onboarding/skriva";

const config: SkrivaConfig = {
  baseUrl: "https://klintra.example",
  email: "hey@betal.fo",
  password: "secret",
  tenantId: null,
};

describe("Klintra Skriva client", () => {
  it("accepts a single-tenant user without a tenant id", () => {
    const env = {
      SKRIVA_BASE_URL: config.baseUrl,
      SKRIVA_EMAIL: config.email,
      SKRIVA_PASSWORD: config.password,
    };
    expect(skrivaConfigured(env)).toBe(true);
    expect(skrivaConfig(env).tenantId).toBeNull();
  });

  it("logs in and creates a request with P-tal delegated to Samleikin", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/api/Login")) {
        return Response.json({ successful: true, token: "jwt-token" });
      }
      if (url.endsWith("/api/Signing/create-signing-request")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer jwt-token");
        return Response.json({
          signingRequestId: 42,
          created: "2026-09-13T04:00:00Z",
          expirationDate: "2026-09-27T04:00:00Z",
          signers: [{
            signingPersonId: 7,
            token: "signer-token",
            personalIdentificationNumber: null,
            signingUrl: "https://sign.klintra.fo/sign/signer-token",
          }],
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const client = new SkrivaClient(config, fetcher);
    const result = await client.createSigningRequest({
      signers: [{ name: "Anna Eigari", email: "anna@example.fo" }],
      pdf: new TextEncoder().encode("%PDF-test"),
      title: "FO-avtala",
      redirectUrl: "https://app.betal.fo/umbon/a1/undirskriva",
      emailText: "Undirskriva",
    });

    const login = JSON.parse(String(requests[0]?.init?.body));
    const create = JSON.parse(String(requests[1]?.init?.body));
    expect(login.tenantId).toBeNull();
    expect(create.signers[0]).toEqual({
      name: "Anna Eigari",
      email: "anna@example.fo",
      personalIdentificationNumber: null,
    });
    expect(create.pdfContent).toBe("JVBERi10ZXN0");
    expect(create.appendTokenToRedirectUrl).toBe(true);
    expect(create.sendMailToSigningPersons).toBe(true);
    expect(result.signingRequestId).toBe(42);
    expect(result.signers[0]?.signingUrl).toBe(
      "https://sign.klintra.fo/sign/signer-token",
    );
  });

  it("normalizes signed status and captures the Samleikin P-tal", () => {
    expect(normalizeSkrivaStatus({
      completed: true,
      signingPerson: { personalIdentificationNumber: "010101123" },
    })).toMatchObject({
      state: "signed",
      personalIdentificationNumber: "010101123",
    });
    expect(normalizeSkrivaStatus({ status: "Viewed" }).state).toBe("viewed");
    expect(normalizeSkrivaStatus({ status: "Expired" }).state).toBe("expired");
  });

  it("downloads and validates the signed PDF", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/Login")) {
        return Response.json({ successful: true, token: "jwt-token" });
      }
      return new Response("%PDF-signed", {
        headers: { "content-type": "application/pdf" },
      });
    }) as typeof fetch;

    const bytes = await new SkrivaClient(config, fetcher)
      .downloadSignedPdf(42, "signer-token");
    expect(new TextDecoder().decode(bytes)).toBe("%PDF-signed");
  });
});
