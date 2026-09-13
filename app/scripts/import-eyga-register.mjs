import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Loads a snapshot of the live eyga-core register into wrangler's local D1.
 * Source files are produced from the production D1 (never committed).
 */

const companies = JSON.parse(readFileSync("/tmp/eyga-companies.json", "utf8"));
const edges = JSON.parse(readFileSync("/tmp/eyga-edges.json", "utf8"));
const entities = JSON.parse(readFileSync("/tmp/eyga-entities.json", "utf8"));

if (!Array.isArray(companies) || companies.length < 1000) {
  throw new Error("Missing /tmp/eyga-companies.json — dump the live register first");
}

function sql(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const statements = [
  "PRAGMA foreign_keys = OFF;",
  "DROP TABLE IF EXISTS edge;",
  "DROP TABLE IF EXISTS entity;",
  "DROP TABLE IF EXISTS company;",
  `CREATE TABLE company (
     regnr INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     legal_form TEXT,
     status TEXT NOT NULL DEFAULT 'virkid',
     town TEXT,
     postcode TEXT,
     street TEXT,
     street_is_residential INTEGER NOT NULL DEFAULT 1,
     purpose TEXT,
     signing_rules TEXT,
     management_json TEXT,
     board_json TEXT,
     sgvs_id INTEGER,
     sgvs_seen TEXT,
     last_event_on TEXT,
     people_as_of TEXT,
     people_source TEXT
   );`,
  `CREATE TABLE entity (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT,
     regnr INTEGER,
     country TEXT
   );`,
  `CREATE TABLE edge (
     from_id INTEGER NOT NULL,
     to_id INTEGER NOT NULL,
     cb_type_id INTEGER NOT NULL,
     cb_type_name TEXT NOT NULL,
     pct REAL,
     PRIMARY KEY (from_id, cb_type_id, to_id)
   );`,
];

for (const row of companies) {
  statements.push(
    `INSERT INTO company (regnr, name, legal_form, status, town, postcode, street, street_is_residential, purpose, signing_rules, management_json, board_json, sgvs_id, sgvs_seen, last_event_on, people_as_of, people_source) VALUES (${
      [
        row.regnr,
        row.name,
        row.legal_form,
        row.status,
        row.town,
        row.postcode,
        row.street,
        row.street_is_residential ?? 1,
        row.purpose,
        row.signing_rules,
        row.management_json,
        row.board_json,
        row.sgvs_id,
        row.sgvs_seen,
        row.last_event_on,
        row.people_as_of,
        row.people_source,
      ].map(sql).join(", ")
    });`,
  );
}

for (const row of entities) {
  statements.push(
    `INSERT INTO entity (id, name, kind, regnr, country) VALUES (${
      [row.id, row.name, row.kind, row.regnr, row.country].map(sql).join(", ")
    });`,
  );
}

for (const row of edges) {
  statements.push(
    `INSERT INTO edge (from_id, to_id, cb_type_id, cb_type_name, pct) VALUES (${
      [row.from_id, row.to_id, row.cb_type_id, row.cb_type_name, row.pct].map(sql).join(", ")
    });`,
  );
}

const file = resolve(import.meta.dirname, "../.eyga-core.sql");
writeFileSync(file, statements.join("\n") + "\n");
console.log(`Wrote ${companies.length} companies, ${entities.length} entities, ${edges.length} edges`);

const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "eyga-core", "--local", "--yes", "--file", file],
  { stdio: "inherit", cwd: resolve(import.meta.dirname, "..") },
);
process.exit(result.status ?? 1);
