import type { Env } from "../db/types";

export interface SkrivaConfig {
  baseUrl: string;
  email: string;
  password: string;
  tenantId: number | null;
}

export interface SkrivaSigner {
  name: string;
  email: string;
}

export interface SkrivaSigningPerson {
  signingPersonId: number;
  token: string;
  personalIdentificationNumber: string | null;
  signingUrl: string;
}

export interface SkrivaSigningRequest {
  signingRequestId: number;
  created: string | null;
  expirationDate: string | null;
  signers: SkrivaSigningPerson[];
}

export type SigningState = "sent" | "viewed" | "signed" | "expired" | "failed";

export interface SkrivaStatus {
  state: SigningState;
  personalIdentificationNumber: string | null;
  raw: unknown;
}

export class SkrivaError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "SkrivaError";
  }
}

export function skrivaConfigured(
  env: Pick<
    Env,
    "SKRIVA_EMAIL" | "SKRIVA_PASSWORD" | "SKRIVA_BASE_URL" | "SKRIVA_TENANT_ID"
  >,
): boolean {
  return Boolean(
    env.SKRIVA_EMAIL &&
    env.SKRIVA_PASSWORD &&
    env.SKRIVA_BASE_URL &&
    (!env.SKRIVA_TENANT_ID || /^\d+$/.test(env.SKRIVA_TENANT_ID)),
  );
}

export function skrivaConfig(
  env: Pick<
    Env,
    "SKRIVA_EMAIL" | "SKRIVA_PASSWORD" | "SKRIVA_BASE_URL" | "SKRIVA_TENANT_ID"
  >,
): SkrivaConfig {
  if (!skrivaConfigured(env)) {
    throw new SkrivaError("Skriva er ikki rætt sett upp", 503);
  }
  return {
    baseUrl: env.SKRIVA_BASE_URL!.replace(/\/+$/, ""),
    email: env.SKRIVA_EMAIL!,
    password: env.SKRIVA_PASSWORD!,
    tenantId: env.SKRIVA_TENANT_ID ? Number(env.SKRIVA_TENANT_ID) : null,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

async function responseJson(response: Response, fallback: string): Promise<unknown> {
  if (!response.ok) throw new SkrivaError(fallback, response.status);
  try {
    return await response.json();
  } catch {
    throw new SkrivaError("Skriva sendi eitt ógyldugt svar");
  }
}

function trustedSigningUrl(value: unknown): string {
  const url = string(value);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("not https");
    return parsed.toString();
  } catch {
    throw new SkrivaError("Skriva sendi eina ógylduga undirskriftarleinkju");
  }
}

function nestedString(value: unknown, names: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const name of names) {
    const match = string(row[name]);
    if (match) return match;
  }
  for (const child of Object.values(row)) {
    const match = nestedString(child, names);
    if (match) return match;
  }
  return null;
}

function nestedBoolean(value: unknown, names: string[]): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (names.some((name) => row[name] === true)) return true;
  return Object.values(row).some((child) => nestedBoolean(child, names));
}

export function normalizeSkrivaStatus(raw: unknown): SkrivaStatus {
  const statusText = (
    nestedString(raw, ["status", "state", "taskStatus", "signingStatus"]) ||
    (typeof raw === "string" ? raw : "")
  ).toLowerCase();
  const compact = statusText.replace(/[\s_-]/g, "");

  let state: SigningState = "sent";
  if (
    nestedBoolean(raw, ["signed", "completed", "isSigned"]) ||
    /signed|complete|finished|undirskriva/.test(compact)
  ) {
    state = "signed";
  } else if (/view|opened|seen|lesin/.test(compact)) {
    state = "viewed";
  } else if (/expire|timedout|utging/.test(compact)) {
    state = "expired";
  } else if (/fail|reject|cancel|error|avvist/.test(compact)) {
    state = "failed";
  }

  return {
    state,
    personalIdentificationNumber: nestedString(raw, [
      "personalIdentificationNumber",
      "personalIdentificationNo",
      "pTal",
    ]),
    raw,
  };
}

export class SkrivaClient {
  private token: string | null = null;

  constructor(
    private readonly config: SkrivaConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async login(): Promise<string> {
    if (this.token) return this.token;
    const response = await this.fetcher(`${this.config.baseUrl}/api/Login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        tenantId: this.config.tenantId,
        email: this.config.email,
        password: this.config.password,
        rememberMe: false,
      }),
    });
    const payload = object(await responseJson(response, "Innritan til Skriva miseydnaðist"));
    if (payload.successful !== true || !string(payload.token)) {
      if (payload.userIsNotPartOfAnyTenant === true) {
        throw new SkrivaError("Skriva-brúkarin hoyrir ikki til nakran tenant", 403);
      }
      throw new SkrivaError("Innritan til Skriva miseydnaðist", 401);
    }
    this.token = string(payload.token);
    return this.token;
  }

  private async authorized(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.login();
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    return this.fetcher(`${this.config.baseUrl}${path}`, { ...init, headers });
  }

  async createSigningRequest(input: {
    signers: SkrivaSigner[];
    pdf: Uint8Array;
    title: string;
    redirectUrl: string;
    emailText: string;
    expirationDate?: string;
    reminderDate?: string;
  }): Promise<SkrivaSigningRequest> {
    const response = await this.authorized("/api/Signing/create-signing-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signers: input.signers.map((signer) => ({
          name: signer.name,
          email: signer.email,
          // Samleikin establishes this; the merchant never types it into Betal.
          personalIdentificationNumber: null,
        })),
        pdfContent: base64(input.pdf),
        title: input.title,
        redirectUrl: input.redirectUrl,
        appendTokenToRedirectUrl: true,
        sendMailToSigningPersons: true,
        emailText: input.emailText,
        expirationDate: input.expirationDate ?? null,
        reminderDate: input.reminderDate ?? null,
      }),
    });
    const payload = object(
      await responseJson(response, "Skriva kundi ikki stovna undirskriftina"),
    );
    const signingRequestId = number(payload.signingRequestId);
    const signerRows = Array.isArray(payload.signers) ? payload.signers : [];
    const signers = signerRows.map((value) => {
      const signer = object(value);
      const signingPersonId = number(signer.signingPersonId);
      const token = string(signer.token);
      if (signingPersonId == null || !token) {
        throw new SkrivaError("Skriva-svarið manglar undirskrivara");
      }
      return {
        signingPersonId,
        token,
        personalIdentificationNumber: string(signer.personalIdentificationNumber) || null,
        signingUrl: trustedSigningUrl(signer.signingUrl),
      };
    });
    if (signingRequestId == null || signers.length === 0) {
      throw new SkrivaError("Skriva-svarið manglar undirskrift");
    }
    return {
      signingRequestId,
      created: string(payload.created) || null,
      expirationDate: string(payload.expirationDate) || null,
      signers,
    };
  }

  async signingStatus(token: string): Promise<SkrivaStatus> {
    const response = await this.authorized(
      `/api/Signing/task/status/token/${encodeURIComponent(token)}`,
    );
    return normalizeSkrivaStatus(
      await responseJson(response, "Støðan hjá Skriva fekst ikki"),
    );
  }

  async downloadSignedPdf(
    signingRequestId: number,
    token: string,
  ): Promise<Uint8Array> {
    const response = await this.authorized(
      `/api/Document/signed/downloadBySigningRequestAndToken/${
        encodeURIComponent(String(signingRequestId))
      }/${encodeURIComponent(token)}/false?authorizedForSensitiveData=false`,
      { headers: { accept: "application/pdf" } },
    );
    if (!response.ok) {
      throw new SkrivaError("Undirskrivaða avtalan fekst ikki", response.status);
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 1_500_000) {
      throw new SkrivaError("Undirskrivaða avtalan er ov stór");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 1_500_000) {
      throw new SkrivaError("Undirskrivaða avtalan er ov stór");
    }
    if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
      throw new SkrivaError("Skriva sendi ikki eina PDF-avtalu");
    }
    return bytes;
  }
}
