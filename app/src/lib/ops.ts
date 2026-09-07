import type { Database } from "./db/types";

/**
 * Betal's internal operations: the pipeline, acquiring applications, support and
 * terminals.
 *
 * These are deliberately thin. None of it is a differentiator, and the engineering
 * that matters goes into the things nobody else can build — the mirror, the rating
 * engine, the Faroese portal. What is here exists because the alternative is losing
 * track of a lead or forgetting an acquiring application, both of which cost real
 * money at this size.
 */

export type LeadState = "new" | "contacted" | "qualified" | "won" | "lost";

export interface LeadInput {
  name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  /** One of the four products on betal.fo: alnetinum, stadnum, hald, lon. */
  product?: string | null;
  message?: string | null;
  source?: string;
}

/**
 * Captures an enquiry from the betal.fo contact form.
 *
 * The marketing site currently opens a mailto: link, which means an enquiry exists
 * only in somebody's inbox and disappears the moment it is not replied to.
 */
export async function captureLead(
  db: Database,
  input: LeadInput,
  now: () => number = () => Date.now(),
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO lead (id, name, company, email, phone, product, message, state,
                         source, created_at_ms, updated_at_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'new', ?8, ?9, ?9)`,
    )
    .bind(
      id,
      input.name.trim(),
      input.company?.trim() ?? null,
      input.email.trim().toLowerCase(),
      input.phone?.trim() ?? null,
      input.product ?? null,
      input.message?.trim() ?? null,
      input.source ?? "betal.fo",
      now(),
    )
    .run();
  return id;
}

export async function listLeads(
  db: Database,
  state?: LeadState,
): Promise<Array<Record<string, unknown>>> {
  const result = state
    ? await db
        .prepare(
          `SELECT * FROM lead WHERE state = ?1 ORDER BY created_at_ms DESC LIMIT 200`,
        )
        .bind(state)
        .all<Record<string, unknown>>()
    : await db
        .prepare(`SELECT * FROM lead ORDER BY created_at_ms DESC LIMIT 200`)
        .all<Record<string, unknown>>();
  return result.results;
}

export async function advanceLead(
  db: Database,
  leadId: string,
  state: LeadState,
  options: { ownerEmail?: string; lostReason?: string; merchantId?: string } = {},
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE lead
          SET state = ?2, owner_email = COALESCE(?3, owner_email),
              lost_reason = ?4, merchant_id = COALESCE(?5, merchant_id),
              updated_at_ms = ?6
        WHERE id = ?1`,
    )
    .bind(
      leadId,
      state,
      options.ownerEmail ?? null,
      state === "lost" ? (options.lostReason ?? null) : null,
      options.merchantId ?? null,
      now(),
    )
    .run();
}

// ---------------------------------------------------------------------------
// Acquiring applications
// ---------------------------------------------------------------------------

export type AcquiringState =
  | "not_started"
  | "collecting"
  | "submitted"
  | "approved"
  | "rejected";

/**
 * Tracks an acquiring application.
 *
 * The application itself happens in EasyOnboard, which has no API — so this records
 * where it has got to rather than driving it. It is the difference between a merchant
 * being chased and a merchant sitting in limbo for a month.
 */
export async function upsertAcquiringApplication(
  db: Database,
  input: {
    merchantId: string;
    acquirer: string;
    state: AcquiringState;
    externalRef?: string;
    notes?: string;
  },
  now: () => number = () => Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO acquiring_application (id, merchant_id, acquirer, state,
                                          external_ref, notes, submitted_at,
                                          decided_at, created_at_ms, updated_at_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT (id) DO UPDATE SET
         state = excluded.state,
         external_ref = COALESCE(excluded.external_ref, acquiring_application.external_ref),
         notes = COALESCE(excluded.notes, acquiring_application.notes),
         submitted_at = COALESCE(excluded.submitted_at, acquiring_application.submitted_at),
         decided_at = COALESCE(excluded.decided_at, acquiring_application.decided_at),
         updated_at_ms = excluded.updated_at_ms`,
    )
    .bind(
      `${input.merchantId}:${input.acquirer}`,
      input.merchantId,
      input.acquirer,
      input.state,
      input.externalRef ?? null,
      input.notes ?? null,
      input.state === "submitted" ? new Date(now()).toISOString() : null,
      input.state === "approved" || input.state === "rejected"
        ? new Date(now()).toISOString()
        : null,
      now(),
    )
    .run();

  // Mirror onto the merchant so the portal can tell whether they can take live money.
  await db
    .prepare(
      `UPDATE merchant SET acquiring_status = ?2,
              acquirer = CASE WHEN ?2 = 'approved' THEN ?3 ELSE acquirer END
        WHERE id = ?1`,
    )
    .bind(input.merchantId, input.state, input.acquirer)
    .run();
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export async function openTicket(
  db: Database,
  input: {
    subject: string;
    merchantId?: string;
    transactionId?: string;
    openedBy: string;
    body: string;
    priority?: string;
  },
  now: () => number = () => Date.now(),
): Promise<string> {
  const ticketId = crypto.randomUUID();

  await db.batch([
    db
      .prepare(
        `INSERT INTO ticket (id, merchant_id, transaction_id, subject, state,
                             priority, opened_by, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?6, ?7, ?7)`,
      )
      .bind(
        ticketId,
        input.merchantId ?? null,
        input.transactionId ?? null,
        input.subject,
        input.priority ?? "normal",
        input.openedBy,
        now(),
      ),
    db
      .prepare(
        `INSERT INTO ticket_message (id, ticket_id, author, internal, body,
                                     created_at_ms)
         VALUES (?1, ?2, ?3, 0, ?4, ?5)`,
      )
      .bind(crypto.randomUUID(), ticketId, input.openedBy, input.body, now()),
  ]);

  return ticketId;
}

export async function replyToTicket(
  db: Database,
  ticketId: string,
  input: { author: string; body: string; internal?: boolean },
  now: () => number = () => Date.now(),
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO ticket_message (id, ticket_id, author, internal, body,
                                     created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(
        crypto.randomUUID(),
        ticketId,
        input.author,
        input.internal ? 1 : 0,
        input.body,
        now(),
      ),
    db
      .prepare(`UPDATE ticket SET updated_at_ms = ?2 WHERE id = ?1`)
      .bind(ticketId, now()),
  ]);
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

export interface TerminalHealth {
  id: string;
  externalId: string | null;
  description: string | null;
  pointOfSaleId: string | null;
  lastSeenAtMs: number | null;
  /** Derived, because ePay reports no terminal status of any kind. */
  status: "active" | "quiet" | "silent" | "unknown";
}

/**
 * Terminal liveness, derived from transaction flow.
 *
 * ePay's terminal endpoint is list-only and returns no status, last-seen, battery or
 * firmware information — just identity and the point of sale. So the only signal
 * available is whether payments have recently come through a terminal, which is
 * imperfect but does distinguish a device in daily use from one that has gone quiet.
 */
export async function terminalHealth(
  db: Database,
  merchantId: string,
  now: () => number = () => Date.now(),
): Promise<TerminalHealth[]> {
  const result = await db
    .prepare(
      `SELECT id, external_id, description, point_of_sale_id, last_seen_at_ms
         FROM terminal WHERE merchant_id = ?1 ORDER BY description`,
    )
    .bind(merchantId)
    .all<{
      id: string;
      external_id: string | null;
      description: string | null;
      point_of_sale_id: string | null;
      last_seen_at_ms: number | null;
    }>();

  const dayMs = 86_400_000;

  return result.results.map((row) => {
    let status: TerminalHealth["status"] = "unknown";
    if (row.last_seen_at_ms !== null) {
      const age = now() - row.last_seen_at_ms;
      // A market stall is not broken because it did not trade on a Tuesday, so the
      // thresholds are deliberately forgiving.
      status = age < 2 * dayMs ? "active" : age < 30 * dayMs ? "quiet" : "silent";
    }

    return {
      id: row.id,
      externalId: row.external_id,
      description: row.description,
      pointOfSaleId: row.point_of_sale_id,
      lastSeenAtMs: row.last_seen_at_ms,
      status,
    };
  });
}

/** Refreshes derived terminal liveness from the mirrored transactions. */
export async function refreshTerminalActivity(db: Database): Promise<void> {
  await db
    .prepare(
      `UPDATE terminal SET last_seen_at_ms = (
         SELECT MAX(t.created_at_ms) FROM txn t
          WHERE t.point_of_sale_id = terminal.point_of_sale_id
       )
       WHERE point_of_sale_id IS NOT NULL`,
    )
    .run();
}
