import type { Database } from "../db/types";

/**
 * Read-only queries against the same D1 databases that power eyga.fo / api.eyga.fo.
 * Field names match the public v1 JSON so Betal can map once.
 */

export interface EygaRegisterEnv {
  EYGA_CORE: Database;
  EYGA_SEARCH?: Database;
}

const FOLD: Record<string, string> = {
  ø: "o",
  Ø: "o",
  ð: "d",
  Ð: "d",
  æ: "ae",
  Æ: "ae",
  å: "a",
  Å: "a",
  þ: "th",
  Þ: "th",
};

export function foldEygaText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[øØðÐæÆåÅþÞ]/g, (char) => FOLD[char] ?? char)
    .toLowerCase();
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function searchTerms(query: string): string {
  return foldEygaText(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((term) => `"${term.replace(/"/g, "")}"*`)
    .join(" AND ");
}

function shapeSearchRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    regnr: row.regnr,
    navn: row.name,
    slag: row.legal_form,
    stoda: row.status,
    heimstadur: {
      postnr: row.postcode,
      bygd: row.town,
    },
  };
}

function shapeCompanyRow(row: Record<string, unknown>): Record<string, unknown> {
  const residential = row.street_is_residential === 1 || row.street_is_residential === true;
  return {
    regnr: row.regnr,
    navn: row.name,
    slag: row.legal_form,
    stoda: row.status,
    heimstadur: {
      postnr: row.postcode,
      bygd: row.town,
      kommuna: row.kommuna ?? null,
      adressa: residential ? null : row.street ?? null,
      adressa_er_bustadur: residential,
    },
    endamal: row.purpose ?? null,
    tekningarreglur: row.signing_rules ?? null,
    leidsla: parseJson(row.management_json) ?? [],
    nevnd: parseJson(row.board_json) ?? [],
    kelda: {
      leidsla_ur: row.people_source ?? null,
      leidsla_dagur: row.people_as_of ?? null,
      eigarayvirlitid_lisið: row.sgvs_seen ?? null,
      seinasta_kunngerd: row.last_event_on ?? null,
    },
  };
}

async function searchByName(
  core: Database,
  query: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const folded = foldEygaText(query).trim();
  const like = `%${query.trim()}%`;
  const foldedLike = `%${folded}%`;
  const rows = await core.prepare(
    `SELECT regnr, name, legal_form, status, town, postcode
     FROM company
     WHERE name LIKE ?1 OR lower(name) LIKE ?2
     LIMIT 40`,
  ).bind(like, foldedLike).all<Record<string, unknown>>();
  return (rows.results ?? [])
    .filter((row) => foldEygaText(String(row.name ?? "")).includes(folded))
    .slice(0, limit)
    .map(shapeSearchRow);
}

async function searchWithIndex(
  search: Database,
  core: Database,
  query: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const terms = searchTerms(query);
  if (!terms) return [];
  const hits = await search.prepare(
    "SELECT ref, label FROM search WHERE folded MATCH ?1 LIMIT ?2",
  ).bind(terms, limit).all<{ ref: string }>();
  const ids = (hits.results ?? [])
    .filter((row) => String(row.ref).startsWith("c:"))
    .map((row) => Number(String(row.ref).slice(2)))
    .filter(Number.isFinite)
    .slice(0, limit);
  if (!ids.length) return [];
  const placeholders = ids.map((_, index) => `?${index + 1}`).join(",");
  const found = await core.prepare(
    `SELECT regnr, name, legal_form, status, town, postcode
     FROM company WHERE regnr IN (${placeholders})`,
  ).bind(...ids).all<Record<string, unknown>>();
  const byReg = new Map((found.results ?? []).map((row) => [Number(row.regnr), row]));
  return ids.map((id) => byReg.get(id)).filter(Boolean).map((row) => shapeSearchRow(row!));
}

async function ownersFor(
  core: Database,
  sgvsId: number,
  seen: unknown,
): Promise<Record<string, unknown>> {
  const [incoming, outgoing] = await Promise.all([
    core.prepare(
      "SELECT from_id, cb_type_id, cb_type_name, pct FROM edge WHERE to_id = ?1 LIMIT 200",
    ).bind(sgvsId).all<Record<string, unknown>>(),
    core.prepare(
      "SELECT to_id, cb_type_id, cb_type_name, pct FROM edge WHERE from_id = ?1 LIMIT 200",
    ).bind(sgvsId).all<Record<string, unknown>>(),
  ]);
  const ids = new Set<number>();
  for (const edge of incoming.results ?? []) ids.add(Number(edge.from_id));
  for (const edge of outgoing.results ?? []) ids.add(Number(edge.to_id));
  ids.delete(sgvsId);
  const entities = new Map<number, Record<string, unknown>>();
  const list = [...ids].filter(Number.isFinite).slice(0, 300);
  for (let i = 0; i < list.length; i += 90) {
    const part = list.slice(i, i + 90);
    const placeholders = part.map((_, index) => `?${index + 1}`).join(",");
    const rows = await core.prepare(
      `SELECT id, name, kind, regnr, country FROM entity WHERE id IN (${placeholders})`,
    ).bind(...part).all<Record<string, unknown>>();
    for (const entity of rows.results ?? []) entities.set(Number(entity.id), entity);
  }
  const who = (id: unknown) => {
    const entity = entities.get(Number(id));
    return entity
      ? {
        navn: entity.name,
        slag: entity.kind,
        regnr: entity.regnr ?? null,
        land: entity.country ?? null,
      }
      : { navn: null, slag: null };
  };
  const incomingRows = incoming.results ?? [];
  const outgoingRows = outgoing.results ?? [];
  return {
    eigarar: incomingRows
      .filter((edge) => edge.cb_type_id === 1)
      .map((edge) => ({ ...who(edge.from_id), partur_prosent: edge.pct })),
    veruligir_eigarar: incomingRows
      .filter((edge) => edge.cb_type_id === 41)
      .map((edge) => ({ ...who(edge.from_id) })),
    eigur: outgoingRows
      .filter((edge) => edge.cb_type_id === 1)
      .map((edge) => ({ ...who(edge.to_id), partur_prosent: edge.pct })),
    kelda: { eigarayvirlitid_lisið: seen ?? null },
  };
}

/** Name or registration-number search. Uses the FTS index when it is bound. */
export async function searchEygaRegister(
  env: EygaRegisterEnv,
  query: string,
  limit = 8,
): Promise<Record<string, unknown>[]> {
  const clean = query.trim().slice(0, 80);
  if (!clean) return [];
  if (/^\d{1,6}$/.test(clean)) {
    const row = await env.EYGA_CORE.prepare(
      `SELECT regnr, name, legal_form, status, town, postcode
       FROM company WHERE regnr = ?1`,
    ).bind(Number(clean)).first<Record<string, unknown>>();
    return row ? [shapeSearchRow(row)] : [];
  }
  if (clean.length < 2) return [];
  if (env.EYGA_SEARCH) {
    try {
      return await searchWithIndex(env.EYGA_SEARCH, env.EYGA_CORE, clean, limit);
    } catch {
      // Local snapshots may not have the FTS table. Fall through to LIKE.
    }
  }
  return searchByName(env.EYGA_CORE, clean, limit);
}

/** Company facts plus ownership, shaped like api.eyga.fo. */
export async function loadEygaRegisterCompany(
  env: EygaRegisterEnv,
  registryNumber: number,
): Promise<{ company: Record<string, unknown>; owners: Record<string, unknown> } | null> {
  const row = await env.EYGA_CORE.prepare(
    `SELECT regnr, name, legal_form, status, town, postcode, street, street_is_residential,
            purpose, signing_rules, management_json, board_json, sgvs_id, sgvs_seen,
            last_event_on, people_as_of, people_source
     FROM company WHERE regnr = ?1`,
  ).bind(registryNumber).first<Record<string, unknown>>();
  if (!row) return null;
  const sgvsId = typeof row.sgvs_id === "number" ? row.sgvs_id : Number(row.sgvs_id);
  const owners = Number.isFinite(sgvsId) && sgvsId > 0
    ? await ownersFor(env.EYGA_CORE, sgvsId, row.sgvs_seen)
    : { eigarar: [], veruligir_eigarar: [], eigur: [], kelda: { eigarayvirlitid_lisið: row.sgvs_seen ?? null } };
  return {
    company: shapeCompanyRow(row),
    owners: { regnr: row.regnr, ...owners },
  };
}
