import type { Database } from "../db/types";
import { recordAudit } from "../audit";
import type { PriceList } from "./application";
import { officialRatesFromForm, parseOfficialRates } from "./official-rates";

export interface StoredPriceList extends PriceList {
  status: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at_ms: number | null;
  source_note: string | null;
  created_at_ms: number;
  effective_from: string | null;
}

export async function listPriceLists(db: Database): Promise<StoredPriceList[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM acquiring_price_list
        ORDER BY kind, version DESC`,
    )
    .all<StoredPriceList>();
  return rows.results;
}

export async function getPriceList(
  db: Database,
  id: string,
): Promise<StoredPriceList | null> {
  return db
    .prepare(`SELECT * FROM acquiring_price_list WHERE id = ?1`)
    .bind(id)
    .first<StoredPriceList>();
}

export async function savePriceListDraft(
  db: Database,
  input: {
    kind: "standard" | "sector2";
    rates: ReturnType<typeof officialRatesFromForm>;
    sourceNote: string;
    actor: { id: string; email: string };
  },
  now: () => number = () => Date.now(),
): Promise<StoredPriceList> {
  if (!parseOfficialRates(input.rates)) {
    throw new Error("Príslistin er ikki fullfíggjaður");
  }
  const latest = await db
    .prepare(
      `SELECT COALESCE(MAX(version), 0) AS version
         FROM acquiring_price_list WHERE kind = ?1`,
    )
    .bind(input.kind)
    .first<{ version: number }>();
  const id = crypto.randomUUID();
  const at = now();
  await db
    .prepare(
      `INSERT INTO acquiring_price_list (
         id, kind, version, currency, country_code, rates_json, effective_from,
         created_at_ms, status, created_by, source_note
       ) VALUES (?1, ?2, ?3, 'DKK', 'FO', ?4, ?5, ?6, 'draft', ?7, ?8)`,
    )
    .bind(
      id,
      input.kind,
      (latest?.version ?? 0) + 1,
      JSON.stringify(input.rates),
      new Date(at).toISOString().slice(0, 10),
      at,
      input.actor.email,
      input.sourceNote.trim() || null,
    )
    .run();

  await recordAudit(db, {
    actorUserId: input.actor.id,
    actorEmail: input.actor.email,
    action: "create_price_list",
    subjectType: "acquiring_price_list",
    subjectId: id,
    detail: { kind: input.kind, version: (latest?.version ?? 0) + 1 },
  }, now);

  const created = await getPriceList(db, id);
  if (!created) throw new Error("Príslistin kundi ikki goymast");
  return created;
}

export async function approvePriceList(
  db: Database,
  input: {
    id: string;
    sourceNote?: string;
    actor: { id: string; email: string };
  },
  now: () => number = () => Date.now(),
): Promise<StoredPriceList> {
  const list = await getPriceList(db, input.id);
  if (!list) throw new Error("Príslistin finst ikki");
  if (list.status === "approved") return list;
  if (!parseOfficialRates(list.rates_json)) {
    throw new Error("Príslistin er ikki fullfíggjaður");
  }
  const note = (input.sourceNote ?? list.source_note ?? "").trim();
  if (!note) {
    throw new Error("Skriva, hvør Swedbank-kelda tølini koma frá");
  }

  const at = now();
  await db
    .prepare(
      `UPDATE acquiring_price_list
          SET status = 'approved', approved_by = ?2, approved_at_ms = ?3,
              source_note = ?4
        WHERE id = ?1`,
    )
    .bind(list.id, input.actor.email, at, note)
    .run();

  await recordAudit(db, {
    actorUserId: input.actor.id,
    actorEmail: input.actor.email,
    action: "approve_price_list",
    subjectType: "acquiring_price_list",
    subjectId: list.id,
    detail: { kind: list.kind, version: list.version, source_note: note },
  }, now);

  const approved = await getPriceList(db, list.id);
  if (!approved) throw new Error("Príslistin kundi ikki góðkennast");
  return approved;
}
