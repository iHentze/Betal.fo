import type { ServiceFetcher } from "../db/types";

/**
 * Contract consumed from the private Eyga API.
 *
 * Production should use the `EYGA_API` service binding. `EYGA_API_BASE_URL` plus a
 * bearer token exists for local/staging environments where that binding is not
 * available. Neither path is called from the browser.
 */
export interface EygaApiEnv {
  EYGA_API?: ServiceFetcher;
  EYGA_API_BASE_URL?: string;
  EYGA_API_TOKEN?: string;
}

export interface EygaSearchResult {
  id: string;
  name: string;
  companyType: string;
  location: string;
  registryNumber: string;
  status: string;
  statusLabel: string;
  href: string;
}

export interface EygaPerson {
  name: string;
  kind: "person" | "company" | "entity";
  reference: string | null;
  description: string | null;
  ownershipBps: number | null;
  role: string | null;
}

export interface EygaCompany {
  id: string;
  registryNumber: string;
  name: string;
  legalForm: string;
  companyType: string;
  status: string;
  statusLabel: string;
  address: string;
  postalCode: string;
  city: string;
  updatedAt: string | null;
  owners: EygaPerson[];
  beneficialOwners: EygaPerson[];
  management: EygaPerson[];
  sourceUrl: string;
}

export class EygaApiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "EygaApiError";
  }
}

function apiRequest(env: EygaApiEnv, path: string): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });

  if (env.EYGA_API) {
    return env.EYGA_API.fetch(
      new Request(`https://eyga.internal${path}`, { headers }),
    );
  }

  const baseUrl = env.EYGA_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new EygaApiError("Eyga API er ikki sett upp", 503);
  }

  if (env.EYGA_API_TOKEN) {
    headers.set("authorization", `Bearer ${env.EYGA_API_TOKEN}`);
  }
  return fetch(`${baseUrl}${path}`, { headers });
}

function string(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function nullableString(value: unknown): string | null {
  const result = string(value);
  return result || null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function person(value: unknown): EygaPerson | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const name = string(row.name);
  if (!name) return null;
  const kind = row.kind === "company" || row.kind === "entity" ? row.kind : "person";
  return {
    name,
    kind,
    reference: nullableString(row.reference),
    description: nullableString(row.description),
    ownershipBps: numberOrNull(row.ownershipBps),
    role: nullableString(row.role),
  };
}

function people(value: unknown): EygaPerson[] {
  return Array.isArray(value)
    ? value.map(person).filter((entry): entry is EygaPerson => Boolean(entry))
    : [];
}

function parseSearchResult(value: unknown): EygaSearchResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = string(row.id);
  const name = string(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    companyType: string(row.companyType),
    location: string(row.location),
    registryNumber: string(row.registryNumber) || id,
    status: string(row.status),
    statusLabel: string(row.statusLabel),
    href: string(row.href) || `https://eyga.fo/felag/${id}`,
  };
}

function parseCompany(value: unknown): EygaCompany {
  if (!value || typeof value !== "object") {
    throw new EygaApiError("Eyga sendi eitt ógyldugt svar");
  }
  const row = value as Record<string, unknown>;
  const id = string(row.id);
  const registryNumber = string(row.registryNumber) || id;
  const name = string(row.name);
  const companyType = string(row.companyType);
  if (!id || !registryNumber || !name || !companyType) {
    throw new EygaApiError("Eyga-svarið manglar felagsupplýsingar");
  }

  return {
    id,
    registryNumber,
    name,
    legalForm: string(row.legalForm),
    companyType,
    status: string(row.status),
    statusLabel: string(row.statusLabel),
    address: string(row.address),
    postalCode: string(row.postalCode),
    city: string(row.city),
    updatedAt: nullableString(row.updatedAt),
    owners: people(row.owners),
    beneficialOwners: people(row.beneficialOwners),
    management: people(row.management),
    sourceUrl: string(row.sourceUrl) || `https://eyga.fo/felag/${id}`,
  };
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new EygaApiError(
      response.status === 404 ? "Felagið varð ikki funnið á Eyga" : "Eyga svarar ikki beint nú",
      response.status,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new EygaApiError("Eyga API sendi ikki JSON");
  }
  return response.json();
}

/** GET /v1/companies?query=… → { results: EygaSearchResult[] } */
export async function searchEygaCompanies(
  env: EygaApiEnv,
  query: string,
): Promise<EygaSearchResult[]> {
  const clean = query.trim().slice(0, 80);
  if (clean.length < 2 && !/^\d{1,5}$/.test(clean)) return [];
  const payload = await json(
    await apiRequest(env, `/v1/companies?query=${encodeURIComponent(clean)}&limit=8`),
  );
  const results = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>).results
    : null;
  return Array.isArray(results)
    ? results.map(parseSearchResult).filter((entry): entry is EygaSearchResult => Boolean(entry))
    : [];
}

/** GET /v1/companies/:registrationNumber → EygaCompany */
export async function getEygaCompany(
  env: EygaApiEnv,
  id: string,
): Promise<EygaCompany> {
  if (!/^\d{1,5}$/.test(id)) throw new EygaApiError("Ógilt skrásetingarnummar", 400);
  return parseCompany(
    await json(await apiRequest(env, `/v1/companies/${encodeURIComponent(id)}`)),
  );
}

export function parseEygaSnapshot(value: string | null): EygaCompany | null {
  if (!value) return null;
  try {
    return parseCompany(JSON.parse(value));
  } catch {
    return null;
  }
}
