import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  Database,
  D1PreparedStatement,
  D1Result,
} from "~/lib/db/types";

/**
 * A D1-compatible database backed by node:sqlite.
 *
 * Tests run the real migration files and the real SQL, so upsert semantics, COALESCE
 * merging and aggregate recomputation are genuinely exercised rather than mocked. D1
 * is SQLite, so behaviour matches closely enough for this to be meaningful.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "..", "migrations");

/**
 * D1 binds numbered placeholders (`?1`, `?2`) positionally, but node:sqlite only
 * accepts them as a keyed object. Production code is unaffected; this bridges the two
 * so tests can run the same SQL D1 will.
 */
function bindArgs(query: string, values: unknown[]): unknown[] {
  const normalized = values.map(normalize);
  if (!/\?\d/.test(query)) return normalized;
  const keyed: Record<string, unknown> = {};
  normalized.forEach((value, index) => {
    keyed[String(index + 1)] = value;
  });
  return [keyed];
}

class SqliteStatement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    const next = new SqliteStatement(this.db, this.query);
    next.values = values;
    return next;
  }

  private args(): never[] {
    return bindArgs(this.query, this.values) as never[];
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.query).get(...this.args());
    return (row as T) ?? null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const rows = this.db.prepare(this.query).all(...this.args());
    return {
      results: rows as T[],
      success: true,
      meta: { changes: rows.length },
    };
  }

  async run(): Promise<D1Result> {
    const result = this.db.prepare(this.query).run(...this.args());
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }
}

/** node:sqlite accepts only null, number, bigint, string and Uint8Array. */
function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

export class TestDatabase implements Database {
  readonly raw: DatabaseSync;

  constructor() {
    this.raw = new DatabaseSync(":memory:");
    this.raw.exec("PRAGMA foreign_keys = ON");
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.raw, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    // D1 batches run in an implicit transaction, so mirror that here: a failure part
    // way through must not leave the mirror half-written.
    this.raw.exec("BEGIN");
    try {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  /** Applies every migration in order. */
  migrate(): this {
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      this.raw.exec(readFileSync(join(migrationsDir, file), "utf8"));
    }
    return this;
  }

  /** Convenience for assertions. */
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(params.map(normalize) as never[])) as T[];
  }

  close(): void {
    this.raw.close();
  }
}

export function freshDatabase(): TestDatabase {
  return new TestDatabase().migrate();
}

/** Inserts a merchant so foreign keys are satisfied. */
export function seedMerchant(
  db: TestDatabase,
  id = "m1",
  epayAccountId = "acct-1",
): string {
  db.raw
    .prepare(
      `INSERT INTO merchant (id, epay_account_id, name, environment, status,
                             currency, timezone, created_at, created_at_ms)
       VALUES (?, ?, 'Test Merchant', 'live', 'active', 'DKK', 'Atlantic/Faroe',
               '2026-01-01T00:00:00Z', 1767225600000)`,
    )
    .run(id, epayAccountId);
  return id;
}

export function seedPointOfSale(
  db: TestDatabase,
  merchantId: string,
  id = "pos1",
  secret: string | null = "Bearer secret-token",
): string {
  db.raw
    .prepare(
      `INSERT INTO point_of_sale (id, merchant_id, name, webhook_secret, created_at)
       VALUES (?, ?, 'Betal', ?, '2026-01-01T00:00:00Z')`,
    )
    .run(id, merchantId, secret);
  return id;
}
