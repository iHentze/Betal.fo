import type { Database } from "./db/types";

/**
 * Authentication.
 *
 * Email magic links: no passwords to leak, reset or store. Samleikin, the Faroese
 * national digital ID, is the obvious upgrade later — merchants already use it for
 * Vinnugluggin and their bank — but email keeps the first version simple.
 *
 * ePay has no user, role or permission API of any kind, so identity is entirely ours.
 * That is not a gap to work around; it is what makes this a product rather than a skin
 * over someone else's dashboard.
 */

const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = "betal_session";

export interface Actor {
  id: string;
  email: string;
  name: string | null;
  kind: "staff" | "merchant";
  merchantId: string | null;
  role: string;
}

const encoder = new TextEncoder();

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Issues a login token for a known address.
 *
 * Returns null for an unknown or disabled account, and callers must respond
 * identically either way — otherwise the login form becomes an oracle for which email
 * addresses have accounts.
 */
export async function createLoginToken(
  db: Database,
  email: string,
  now: () => number = () => Date.now(),
): Promise<string | null> {
  const user = await db
    .prepare(
      `SELECT id FROM app_user WHERE email = ?1 AND disabled_at IS NULL`,
    )
    .bind(email.trim().toLowerCase())
    .first<{ id: string }>();

  if (!user) return null;

  const token = randomToken();
  // Stored hashed, so a database read cannot be replayed into a login.
  await db
    .prepare(
      `INSERT INTO login_token (token_hash, user_id, expires_at_ms, created_at_ms)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(await hash(token), user.id, now() + TOKEN_TTL_MS, now())
    .run();

  return token;
}

/** Exchanges a token for a session. Single use, and expired tokens are rejected. */
export async function consumeLoginToken(
  db: Database,
  token: string,
  context: { userAgent?: string | null; ip?: string | null } = {},
  now: () => number = () => Date.now(),
): Promise<string | null> {
  const tokenHash = await hash(token);

  const row = await db
    .prepare(
      `SELECT user_id, expires_at_ms, consumed_at_ms FROM login_token
        WHERE token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<{
      user_id: string;
      expires_at_ms: number;
      consumed_at_ms: number | null;
    }>();

  if (!row || row.consumed_at_ms !== null || row.expires_at_ms < now()) return null;

  const sessionId = randomToken();

  await db.batch([
    db
      .prepare(`UPDATE login_token SET consumed_at_ms = ?2 WHERE token_hash = ?1`)
      .bind(tokenHash, now()),
    db
      .prepare(
        `INSERT INTO session (id, user_id, expires_at_ms, created_at_ms, user_agent, ip)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(
        await hash(sessionId),
        row.user_id,
        now() + SESSION_TTL_MS,
        now(),
        context.userAgent ?? null,
        context.ip ?? null,
      ),
    db
      .prepare(`UPDATE app_user SET last_login_at = ?2 WHERE id = ?1`)
      .bind(row.user_id, new Date(now()).toISOString()),
  ]);

  return sessionId;
}

export async function resolveSession(
  db: Database,
  sessionId: string | undefined,
  now: () => number = () => Date.now(),
): Promise<Actor | null> {
  if (!sessionId) return null;

  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.kind, u.merchant_id, u.role
         FROM session s
         JOIN app_user u ON u.id = s.user_id
        WHERE s.id = ?1 AND s.expires_at_ms > ?2 AND u.disabled_at IS NULL`,
    )
    .bind(await hash(sessionId), now())
    .first<{
      id: string;
      email: string;
      name: string | null;
      kind: string;
      merchant_id: string | null;
      role: string;
    }>();

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    kind: row.kind === "staff" ? "staff" : "merchant",
    merchantId: row.merchant_id,
    role: row.role,
  };
}

export async function destroySession(
  db: Database,
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) return;
  await db.prepare(`DELETE FROM session WHERE id = ?1`).bind(await hash(sessionId)).run();
}

/**
 * The merchant an actor may act on.
 *
 * Staff can address any merchant; a merchant user is pinned to their own. This is the
 * single check that stops one merchant reading another's transactions, so it is
 * deliberately in one place rather than repeated per query.
 */
export function scopeToMerchant(actor: Actor, requested?: string | null): string {
  if (actor.kind === "staff") {
    if (!requested) throw new Error("Staff must specify a merchant");
    return requested;
  }
  if (!actor.merchantId) throw new Error("Merchant user has no merchant");
  if (requested && requested !== actor.merchantId) {
    throw new Error("Cross-merchant access denied");
  }
  return actor.merchantId;
}

export function sessionCookie(sessionId: string, secure = true): string {
  const parts = [
    `${SESSION_COOKIE}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
