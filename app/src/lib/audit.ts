import type { Database } from "./db/types";

/**
 * Append-only audit log.
 *
 * ePay's merchant access token is all-or-nothing: the same credential that reads a
 * transaction list can issue refunds and payouts, and no read-only variant exists. All
 * privilege separation therefore lives in our layer, which means every money-moving
 * action has to be attributable to a person after the fact.
 *
 * Failed attempts are recorded as well as successful ones. Someone repeatedly trying
 * to refund without permission is exactly the thing this log should show.
 */

export type AuditAction =
  | "refund"
  | "capture"
  | "void"
  | "payout"
  | "freeze_period"
  | "reconcile_period"
  | "resolve_discrepancy"
  | "rate_period"
  | "approve_invoice"
  | "issue_invoice"
  | "credit_invoice"
  | "create_merchant"
  | "activate_merchant"
  | "create_price_plan"
  | "create_payment_link"
  | "login"
  | "invite_user"
  | "change_role";

export interface AuditEntry {
  actorUserId?: string | null;
  actorEmail?: string | null;
  merchantId?: string | null;
  action: AuditAction;
  subjectType?: string;
  subjectId?: string;
  amountMinor?: number;
  currency?: string;
  outcome?: "success" | "failure" | "denied";
  detail?: unknown;
  ip?: string | null;
}

export async function recordAudit(
  db: Database,
  entry: AuditEntry,
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_log (
         id, at_ms, actor_user_id, actor_email, merchant_id, action, subject_type,
         subject_id, amount_minor, currency, outcome, detail, ip
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      crypto.randomUUID(),
      now(),
      entry.actorUserId ?? null,
      entry.actorEmail ?? null,
      entry.merchantId ?? null,
      entry.action,
      entry.subjectType ?? null,
      entry.subjectId ?? null,
      entry.amountMinor ?? null,
      entry.currency ?? null,
      entry.outcome ?? "success",
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
      entry.ip ?? null,
    )
    .run();
}

/**
 * Role capabilities.
 *
 * Deliberately coarse — four roles, not a permission matrix — because the meaningful
 * boundary is whether someone can move money. A viewer can read everything about their
 * own merchant and change nothing.
 */
const capabilities = {
  owner: new Set([
    "read",
    "move_money",
    "manage_users",
    "manage_billing",
    "manage_merchant",
  ]),
  admin: new Set(["read", "move_money", "manage_users", "manage_merchant"]),
  operator: new Set(["read", "move_money"]),
  viewer: new Set(["read"]),
} as const;

export type Capability =
  | "read"
  | "move_money"
  | "manage_users"
  | "manage_billing"
  | "manage_merchant";

export type Role = keyof typeof capabilities;

export function can(role: string, capability: Capability): boolean {
  const set = capabilities[role as Role];
  return set ? (set as ReadonlySet<string>).has(capability) : false;
}

export class AuthorizationError extends Error {
  constructor(
    readonly role: string,
    readonly capability: Capability,
  ) {
    super(`Role ${role} may not ${capability}`);
    this.name = "AuthorizationError";
  }
}

/**
 * Asserts a capability, recording the denial before throwing.
 *
 * The audit entry is written on the way out precisely because a denied attempt is
 * worth keeping — it is the signal that someone is trying to do something they should
 * not, and it would otherwise leave no trace at all.
 */
export async function requireCapability(
  db: Database,
  actor: { id: string; email: string; role: string; merchantId?: string | null },
  capability: Capability,
  context: { action: AuditAction; subjectType?: string; subjectId?: string },
): Promise<void> {
  if (can(actor.role, capability)) return;

  await recordAudit(db, {
    actorUserId: actor.id,
    actorEmail: actor.email,
    merchantId: actor.merchantId ?? null,
    action: context.action,
    subjectType: context.subjectType,
    subjectId: context.subjectId,
    outcome: "denied",
    detail: { requiredCapability: capability, role: actor.role },
  });

  throw new AuthorizationError(actor.role, capability);
}
