import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeLoginToken,
  createLoginToken,
  destroySession,
  resolveSession,
  scopeToMerchant,
  type Actor,
} from "~/lib/auth";
import { freshDatabase, seedMerchant, type TestDatabase } from "./helpers/sqlite";

function seedUser(
  db: TestDatabase,
  options: {
    id?: string;
    email: string;
    kind?: string;
    merchantId?: string | null;
    role?: string;
    disabled?: boolean;
  },
) {
  db.raw
    .prepare(
      `INSERT INTO app_user (id, email, name, kind, merchant_id, role, created_at,
                             disabled_at)
       VALUES (?, ?, 'Test', ?, ?, ?, '2026-01-01', ?)`,
    )
    .run(
      options.id ?? crypto.randomUUID(),
      options.email,
      options.kind ?? "merchant",
      options.merchantId ?? null,
      options.role ?? "viewer",
      options.disabled ? "2026-01-02" : null,
    );
}

describe("magic link login", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
    seedMerchant(db);
    seedUser(db, { id: "u1", email: "ingvar@betal.fo", merchantId: "m1", role: "owner" });
  });

  it("issues a token for a known address", async () => {
    const token = await createLoginToken(db, "ingvar@betal.fo");
    expect(token).toBeTruthy();
  });

  it("returns nothing for an unknown address, so the form is not an oracle", async () => {
    expect(await createLoginToken(db, "onkur@ukendt.fo")).toBeNull();
  });

  it("refuses a disabled account", async () => {
    seedUser(db, { email: "gamal@handil.fo", disabled: true });
    expect(await createLoginToken(db, "gamal@handil.fo")).toBeNull();
  });

  it("stores the token hashed rather than in the clear", async () => {
    const token = await createLoginToken(db, "ingvar@betal.fo");
    const stored = db.query<{ token_hash: string }>(
      "SELECT token_hash FROM login_token",
    )[0]!;

    // A database read must not be replayable into a login.
    expect(stored.token_hash).not.toBe(token);
    expect(stored.token_hash).toHaveLength(64);
  });

  it("exchanges a token for a working session", async () => {
    const token = await createLoginToken(db, "ingvar@betal.fo");
    const sessionId = await consumeLoginToken(db, token!);
    expect(sessionId).toBeTruthy();

    const actor = await resolveSession(db, sessionId!);
    expect(actor?.email).toBe("ingvar@betal.fo");
    expect(actor?.role).toBe("owner");
    expect(actor?.merchantId).toBe("m1");
  });

  it("rejects a token used twice", async () => {
    const token = await createLoginToken(db, "ingvar@betal.fo");
    await consumeLoginToken(db, token!);
    expect(await consumeLoginToken(db, token!)).toBeNull();
  });

  it("rejects an expired token", async () => {
    let clock = 0;
    const token = await createLoginToken(db, "ingvar@betal.fo", () => clock);
    clock += 16 * 60 * 1000;
    expect(await consumeLoginToken(db, token!, {}, () => clock)).toBeNull();
  });

  it("rejects a fabricated token", async () => {
    expect(await consumeLoginToken(db, "deadbeef")).toBeNull();
  });

  it("stops resolving a session once it expires", async () => {
    let clock = 0;
    const token = await createLoginToken(db, "ingvar@betal.fo", () => clock);
    const sessionId = await consumeLoginToken(db, token!, {}, () => clock);

    clock += 31 * 24 * 60 * 60 * 1000;
    expect(await resolveSession(db, sessionId!, () => clock)).toBeNull();
  });

  it("stops resolving a session once the user is disabled", async () => {
    const token = await createLoginToken(db, "ingvar@betal.fo");
    const sessionId = await consumeLoginToken(db, token!);

    db.raw.prepare("UPDATE app_user SET disabled_at = '2026-02-01'").run();
    expect(await resolveSession(db, sessionId!)).toBeNull();
  });

  it("drops the session on logout", async () => {
    const token = await createLoginToken(db, "ingvar@betal.fo");
    const sessionId = await consumeLoginToken(db, token!);

    await destroySession(db, sessionId!);
    expect(await resolveSession(db, sessionId!)).toBeNull();
  });

  it("resolves nothing without a cookie", async () => {
    expect(await resolveSession(db, undefined)).toBeNull();
  });
});

describe("merchant scoping", () => {
  const merchantUser: Actor = {
    id: "u1",
    email: "kundi@handil.fo",
    name: null,
    kind: "merchant",
    merchantId: "m1",
    role: "owner",
  };

  const staff: Actor = {
    id: "u2",
    email: "ingvar@betal.fo",
    name: null,
    kind: "staff",
    merchantId: null,
    role: "admin",
  };

  it("pins a merchant user to their own merchant", () => {
    expect(scopeToMerchant(merchantUser)).toBe("m1");
    expect(scopeToMerchant(merchantUser, "m1")).toBe("m1");
  });

  it("refuses a merchant user reaching another merchant", () => {
    // The single check that stops one merchant reading another's transactions.
    expect(() => scopeToMerchant(merchantUser, "m2")).toThrow(/Cross-merchant/);
  });

  it("lets staff address any merchant, but requires them to name one", () => {
    expect(scopeToMerchant(staff, "m2")).toBe("m2");
    expect(() => scopeToMerchant(staff)).toThrow(/must specify/);
  });
});
