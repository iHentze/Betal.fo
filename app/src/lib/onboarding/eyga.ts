import type { Database, ServiceFetcher } from "../db/types";
import { loadEygaRegisterCompany, searchEygaRegister } from "./eyga-register";

/**
 * Live company facts come from the same register as eyga.fo. Production reads the
 * `eyga-core` / `eyga-search` D1 databases. `api.eyga.fo` remains available when a
 * Bearer token is configured.
 */
export interface EygaApiEnv {
  EYGA_API?: ServiceFetcher;
  EYGA_API_BASE_URL?: string;
  EYGA_API_TOKEN?: string;
  EYGA_CORE?: Database;
  EYGA_SEARCH?: Database;
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
  purpose: string | null;
  signingRules: string | null;
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

const STATUS: Record<string, { code: string; label: string }> = {
  virkid: { code: "active", label: "Virkið" },
  tvingsil: { code: "forced_dissolution", label: "Tvingsilsavtøka" },
  likvidation: { code: "liquidation", label: "Likvidatión" },
  konkurs: { code: "bankruptcy", label: "Konkurs" },
  strikad: { code: "closed", label: "Strikað" },
  ovist: { code: "unknown", label: "Óvist" },
};

const COMPANY_TYPES: Record<string, string> = {
  "P/F": "P/F Partafelag",
  "Sp/F": "Sp/F Smápartafelag",
  "Sp/f": "Sp/F Smápartafelag",
  ÍVF: "ÍVF Íverksetarafelag",
  "Í/F": "Í/F Íognarfelag",
  Gr: "Grunnur",
  Fil: "Filialur",
};

function apiBaseUrl(env: EygaApiEnv): string | null {
  const url = env.EYGA_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  return url || null;
}

function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function preferLiveHttp(env: EygaApiEnv): boolean {
  const url = apiBaseUrl(env);
  return Boolean(url && env.EYGA_API_TOKEN && !isLoopbackUrl(url));
}

function hasRegister(env: EygaApiEnv): env is EygaApiEnv & { EYGA_CORE: Database } {
  return Boolean(env.EYGA_CORE);
}

function apiRequest(env: EygaApiEnv, path: string): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (env.EYGA_API_TOKEN) {
    headers.set("authorization", `Bearer ${env.EYGA_API_TOKEN}`);
  }

  const baseUrl = apiBaseUrl(env);
  if (baseUrl && (preferLiveHttp(env) || !hasRegister(env))) {
    return fetch(`${baseUrl}${path}`, { headers });
  }

  if (env.EYGA_API) {
    return env.EYGA_API.fetch(
      new Request(`https://api.eyga.fo${path}`, { headers }),
    );
  }

  if (baseUrl) return fetch(`${baseUrl}${path}`, { headers });

  throw new EygaApiError("Eyga API er ikki sett upp", 503);
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function status(value: unknown): { code: string; label: string } {
  const key = string(value);
  return STATUS[key] ?? { code: key || "unknown", label: key || "Óvist" };
}

function companyType(value: unknown): string {
  const legalForm = string(value);
  return COMPANY_TYPES[legalForm] ?? legalForm;
}

function mapSearchResult(value: unknown): EygaSearchResult | null {
  const row = record(value);
  const id = string(row.regnr);
  const name = string(row.navn);
  if (!id || !name) return null;
  const home = record(row.heimstadur);
  const state = status(row.stoda);
  const postalCode = string(home.postnr);
  const city = string(home.bygd);
  return {
    id,
    name,
    companyType: companyType(row.slag),
    location: [postalCode, city].filter(Boolean).join(" "),
    registryNumber: id,
    status: state.code,
    statusLabel: state.label,
    href: `https://eyga.fo/felag/${id}`,
  };
}

function mapOwner(value: unknown): EygaPerson | null {
  const row = record(value);
  const name = string(row.navn);
  if (!name) return null;
  const registrationNumber = nullableString(row.regnr);
  const rawKind = string(row.slag);
  const kind = registrationNumber
    ? "company"
    : /pers[oó]n/i.test(rawKind)
      ? "person"
      : "entity";
  const description = [rawKind, string(row.land)].filter(Boolean).join(" · ");
  const percent = numberOrNull(row.partur_prosent);
  return {
    name,
    kind,
    reference: registrationNumber ? `felag/${registrationNumber}` : null,
    description: description || null,
    ownershipBps: percent == null ? null : Math.round(percent * 100),
    role: null,
  };
}

function mapOwners(value: unknown): EygaPerson[] {
  return Array.isArray(value)
    ? value.map(mapOwner).filter((entry): entry is EygaPerson => Boolean(entry))
    : [];
}

function mapManagement(value: unknown): EygaPerson[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const name = string(row.navn) || string(row.name);
    if (!name) return [];
    const role = string(row.leiklutur) || string(row.role) || string(row.stoda);
    const place = string(row.bygd) || string(row.town);
    return [{
      name,
      kind: "person" as const,
      reference: null,
      description: [role, place].filter(Boolean).join(" · ") || null,
      ownershipBps: null,
      role: role || null,
    }];
  });
}

function parseSnapshotPerson(value: unknown): EygaPerson | null {
  const row = record(value);
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

function parseSnapshotPeople(value: unknown): EygaPerson[] {
  return Array.isArray(value)
    ? value.map(parseSnapshotPerson).filter((entry): entry is EygaPerson => Boolean(entry))
    : [];
}

function parseSnapshotCompany(value: unknown): EygaCompany {
  const row = record(value);
  const id = string(row.id);
  const registryNumber = string(row.registryNumber) || id;
  const name = string(row.name);
  const type = string(row.companyType);
  if (!id || !registryNumber || !name || !type) {
    throw new EygaApiError("Eyga-svarið manglar felagsupplýsingar");
  }
  return {
    id,
    registryNumber,
    name,
    legalForm: string(row.legalForm),
    companyType: type,
    status: string(row.status),
    statusLabel: string(row.statusLabel),
    address: string(row.address),
    postalCode: string(row.postalCode),
    city: string(row.city),
    updatedAt: nullableString(row.updatedAt),
    owners: parseSnapshotPeople(row.owners),
    beneficialOwners: parseSnapshotPeople(row.beneficialOwners),
    management: parseSnapshotPeople(row.management),
    purpose: nullableString(row.purpose),
    signingRules: nullableString(row.signingRules),
    sourceUrl: string(row.sourceUrl) || `https://eyga.fo/felag/${id}`,
  };
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok) {
    let detail = "";
    try {
      detail = string(record(await response.json()).error);
    } catch {
      // Keep the user-facing fallback below.
    }
    throw new EygaApiError(
      response.status === 401
        ? "Eyga API-lykilin manglar ella er skeivur"
        : response.status === 404
          ? "Felagið varð ikki funnið á Eyga"
          : detail || "Eyga svarar ikki beint nú",
      response.status,
    );
  }
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    throw new EygaApiError("Eyga API sendi ikki JSON");
  }
  return response.json();
}

function mapSearchResults(value: unknown): EygaSearchResult[] {
  return Array.isArray(value)
    ? value.map(mapSearchResult).filter((entry): entry is EygaSearchResult => Boolean(entry))
    : [];
}

function companyFromPayload(
  companyPayload: unknown,
  ownersPayload: unknown,
  id: string,
): EygaCompany {
  const company = record(companyPayload);
  const owners = record(ownersPayload);
  const home = record(company.heimstadur);
  const sources = record(company.kelda);
  const state = status(company.stoda);
  const registrationNumber = string(company.regnr) || id;
  const name = string(company.navn);
  const legalForm = string(company.slag);
  if (!name || !legalForm) throw new EygaApiError("Eyga-svarið manglar felagsupplýsingar");

  return {
    id: registrationNumber,
    registryNumber: registrationNumber,
    name,
    legalForm,
    companyType: companyType(legalForm),
    status: state.code,
    statusLabel: state.label,
    address: home.adressa_er_bustadur === true || home.adressa_er_bustadur === 1
      ? ""
      : string(home.adressa),
    postalCode: string(home.postnr),
    city: string(home.bygd),
    updatedAt: nullableString(sources.seinasta_kunngerd) ?? nullableString(sources.leidsla_dagur),
    owners: mapOwners(owners.eigarar),
    beneficialOwners: mapOwners(owners.veruligir_eigarar),
    management: [
      ...mapManagement(company.leidsla),
      ...mapManagement(company.nevnd),
    ],
    purpose: nullableString(company.endamal),
    signingRules: nullableString(company.tekningarreglur),
    sourceUrl: `https://eyga.fo/felag/${registrationNumber}`,
  };
}

/** Maps GET /v1/leita?q=… from api.eyga.fo, or the live D1 register. */
export async function searchEygaCompanies(
  env: EygaApiEnv,
  query: string,
): Promise<EygaSearchResult[]> {
  const clean = query.trim().slice(0, 80);
  if (clean.length < 2 && !/^\d{1,6}$/.test(clean)) return [];
  if (hasRegister(env) && !preferLiveHttp(env)) {
    return mapSearchResults(await searchEygaRegister(env, clean, 8));
  }
  const payload = record(
    await json(await apiRequest(env, `/v1/leita?q=${encodeURIComponent(clean)}&limit=8`)),
  );
  return mapSearchResults(payload.urslit);
}

/** Combines company facts and ownership from the live register or the two API reads. */
export async function getEygaCompany(
  env: EygaApiEnv,
  id: string,
): Promise<EygaCompany> {
  if (!/^\d{1,6}$/.test(id)) throw new EygaApiError("Ógilt skrásetingarnummar", 400);
  if (hasRegister(env) && !preferLiveHttp(env)) {
    const loaded = await loadEygaRegisterCompany(env, Number(id));
    if (!loaded) throw new EygaApiError("Felagið varð ikki funnið á Eyga", 404);
    return companyFromPayload(loaded.company, loaded.owners, id);
  }
  const [companyPayload, ownersPayload] = await Promise.all([
    apiRequest(env, `/v1/felag/${encodeURIComponent(id)}`).then(json),
    apiRequest(env, `/v1/felag/${encodeURIComponent(id)}/eigarar`).then(json),
  ]);
  return companyFromPayload(companyPayload, ownersPayload, id);
}

export async function checkEygaHealth(
  env: EygaApiEnv,
): Promise<{ ok: boolean; announcement: number | null }> {
  if (hasRegister(env) && !preferLiveHttp(env)) {
    const row = await env.EYGA_CORE.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return { ok: Boolean(row?.ok), announcement: null };
  }
  const payload = record(await json(await apiRequest(env, "/v1/heilsa")));
  return {
    ok: payload.ok === true,
    announcement: typeof payload.kunngerd === "number" ? payload.kunngerd : null,
  };
}

export function parseEygaSnapshot(value: string | null): EygaCompany | null {
  if (!value) return null;
  try {
    return parseSnapshotCompany(JSON.parse(value));
  } catch {
    return null;
  }
}
