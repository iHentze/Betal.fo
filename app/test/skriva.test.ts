import { describe, expect, it } from "vitest";
import {
  normalizeSkrivaStatus,
  SkrivaClient,
  skrivaConfig,
  skrivaConfigured,
  skrivaEnvironment,
  trustedSigningUrl,
  type SkrivaConfig,
} from "~/lib/onboarding/skriva";
import { refreshSkrivaApplication } from "~/lib/onboarding/signing-service";
import { freshDatabase, seedMerchant } from "./helpers/sqlite";
import {
  getOrCreateApplication,
  loadPack,
  saveOwners,
} from "~/lib/onboarding/application";

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

  it("trusts HTTPS and loopback HTTP signing URLs", () => {
    expect(trustedSigningUrl("https://sign.klintra.fo/samleikin/a")).toBe(
      "https://sign.klintra.fo/samleikin/a",
    );
    expect(trustedSigningUrl("http://127.0.0.1:8790/samleikin/a")).toBe(
      "http://127.0.0.1:8790/samleikin/a",
    );
    expect(() => trustedSigningUrl("http://sign.klintra.fo/samleikin/a")).toThrow(
      /ógylduga/,
    );
    expect(skrivaEnvironment("http://127.0.0.1:8790")).toBe("staging");
    expect(skrivaEnvironment("https://skrivaapi.klintra.fo")).toBe("production");
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

  it("keeps a two-person request pending until both selected owners sign", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    const app = await getOrCreateApplication(db, "m1");
    await saveOwners(db, app.id, [
      { name: "Anna", email: "anna@example.fo", is_signatory: true },
      { name: "Bárður", email: "bardur@example.fo", is_signatory: true },
    ]);
    const owners = (await loadPack(db, app.id))!.owners;
    owners.forEach((owner, index) => {
      db.raw.prepare(
        `INSERT INTO onboarding_signing (
           id, application_id, provider, environment, signing_request_id,
           signer_token, signing_url, status, created_at_ms, owner_id,
           signing_person_id
         ) VALUES (?, ?, 'skriva', 'staging', '42', ?, ?, 'sent', 1, ?, ?)`,
      ).run(
        `s${index}`,
        app.id,
        `token-${index}`,
        `https://sign.klintra.fo/${index}`,
        owner.id,
        index + 1,
      );
    });

    const fakeClient = {
      async signingStatus(token: string) {
        return {
          state: token === "token-0" ? "signed" as const : "sent" as const,
          personalIdentificationNumber: null,
          raw: { status: token === "token-0" ? "signed" : "sent" },
        };
      },
    } as SkrivaClient;
    const result = await refreshSkrivaApplication(
      {
        DB: db,
        SKRIVA_BASE_URL: config.baseUrl,
        SKRIVA_EMAIL: config.email,
        SKRIVA_PASSWORD: config.password,
      },
      app.id,
      "system:test",
      () => fakeClient,
    );
    expect(result).toEqual({ state: "pending", pending: 1 });
    expect(db.query<{ status: string }>(
      "SELECT status FROM onboarding_signing ORDER BY id",
    ).map((row) => row.status)).toEqual(["signed", "sent"]);
  });
});
