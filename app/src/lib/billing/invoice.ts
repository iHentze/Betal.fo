import type { Database } from "~/lib/db/types";
import { MVG_RATE_BASIS_POINTS } from "~/lib/money";
import type { InvoiceState, RatingResult } from "./types";

/**
 * Invoices.
 *
 * Faroese requirements shape this: MVG at 25%, both parties' V-tal from TAKS'
 * Vinnuskráin rather than a Danish CVR, DKK, and Faroese wording.
 *
 * Numbers are gapless and sequential, drawn only at issue time. An abandoned draft
 * must not leave a hole in the series, so a draft has no number at all.
 *
 * An issued invoice is immutable. Correcting one means issuing a credit note that
 * references it, never editing the original — which is both the legal expectation and
 * the only way the audit trail stays trustworthy.
 */

export class InvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceError";
  }
}

export interface PartySnapshot {
  name: string;
  vTal: string | null;
  addressLineOne?: string | null;
  addressLineTwo?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
  email?: string | null;
}

/** Betal's own details, appearing as the issuer on every invoice. */
export const BETAL_PARTY: PartySnapshot = {
  name: "Betal P/F",
  vTal: null,
  city: "Tórshavn",
  countryCode: "FO",
  email: "rokning@betal.fo",
};

export interface InvoiceRow {
  id: string;
  merchant_id: string;
  billing_period_id: string | null;
  number: string | null;
  series: string;
  kind: string;
  credits_invoice_id: string | null;
  state: InvoiceState;
  currency: string;
  net_minor: number;
  vat_minor: number;
  gross_minor: number;
  vat_rate_basis_points: number;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  collection_method: string;
  issuer_snapshot: string | null;
  merchant_snapshot: string | null;
}

/**
 * Creates a draft invoice from a rating result.
 *
 * Persists each line together with the transaction ids behind it, so any figure can be
 * traced back to the payments that produced it. Draft invoices carry no number.
 */
export async function createDraftInvoice(
  db: Database,
  input: {
    merchantId: string;
    billingPeriodId: string;
    rating: RatingResult;
    currency?: string;
    collectionMethod?: string;
    createdBy?: string;
  },
  now: () => number = () => Date.now(),
): Promise<string> {
  const invoiceId = crypto.randomUUID();
  const timestamp = new Date(now()).toISOString();

  const statements = [
    db
      .prepare(
        `INSERT INTO invoice (
           id, merchant_id, billing_period_id, series, kind, state, currency,
           net_minor, vat_minor, gross_minor, vat_rate_basis_points,
           collection_method, created_at, created_by
         ) VALUES (?1, ?2, ?3, 'BETAL', 'invoice', 'draft', ?4, ?5, ?6, ?7, ?8, ?9,
                   ?10, ?11)`,
      )
      .bind(
        invoiceId,
        input.merchantId,
        input.billingPeriodId,
        input.currency ?? "DKK",
        input.rating.netMinor,
        input.rating.vatMinor,
        input.rating.grossMinor,
        input.rating.vatRateBasisPoints,
        input.collectionMethod ?? "manual",
        timestamp,
        input.createdBy ?? null,
      ),
  ];

  for (const [index, line] of input.rating.lines.entries()) {
    const lineId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO invoice_line (
             id, invoice_id, position, price_plan_rule_id, kind, description,
             quantity, unit_minor, amount_minor, basis_points
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        )
        .bind(
          lineId,
          invoiceId,
          index,
          line.ruleId,
          line.kind,
          line.description,
          line.quantity,
          line.unitMinor,
          line.amountMinor,
          line.basisPoints ?? null,
        ),
    );

    for (const evidence of line.inputs) {
      statements.push(
        db
          .prepare(
            `INSERT INTO invoice_line_input (
               id, invoice_line_id, transaction_id, amount_minor
             ) VALUES (?1, ?2, ?3, ?4)`,
          )
          .bind(
            crypto.randomUUID(),
            lineId,
            evidence.transactionId,
            evidence.amountMinor ?? null,
          ),
      );
    }
  }

  await db.batch(statements);
  return invoiceId;
}

async function loadInvoice(db: Database, invoiceId: string): Promise<InvoiceRow> {
  const invoice = await db
    .prepare(`SELECT * FROM invoice WHERE id = ?1`)
    .bind(invoiceId)
    .first<InvoiceRow>();
  if (!invoice) throw new InvoiceError(`Unknown invoice ${invoiceId}`);
  return invoice;
}

export async function approveInvoice(
  db: Database,
  invoiceId: string,
  approvedBy: string,
  now: () => number = () => Date.now(),
): Promise<void> {
  const invoice = await loadInvoice(db, invoiceId);
  if (invoice.state !== "draft") {
    throw new InvoiceError(`Only a draft can be approved; ${invoiceId} is ${invoice.state}`);
  }

  await db
    .prepare(
      `UPDATE invoice SET state = 'approved', approved_at = ?2, approved_by = ?3
        WHERE id = ?1`,
    )
    .bind(invoiceId, new Date(now()).toISOString(), approvedBy)
    .run();
}

/**
 * Draws the next number in a series.
 *
 * The series is scoped per year, so numbering restarts each January while staying
 * gapless within the year. RETURNING makes the read and increment a single atomic
 * statement, so two invoices issued concurrently cannot take the same number.
 */
export async function nextInvoiceNumber(
  db: Database,
  series: string,
  year: number,
  now: () => number = () => Date.now(),
): Promise<string> {
  const key = `${series}-${year}`;
  const timestamp = new Date(now()).toISOString();

  await db
    .prepare(
      `INSERT INTO invoice_sequence (series, next_number, updated_at)
       VALUES (?1, 1, ?2)
       ON CONFLICT (series) DO NOTHING`,
    )
    .bind(key, timestamp)
    .run();

  const row = await db
    .prepare(
      `UPDATE invoice_sequence
          SET next_number = next_number + 1, updated_at = ?2
        WHERE series = ?1
        RETURNING next_number - 1 AS number`,
    )
    .bind(key, timestamp)
    .first<{ number: number }>();

  if (!row) throw new InvoiceError(`Failed to draw a number from series ${key}`);
  return `${series}-${year}-${String(row.number).padStart(4, "0")}`;
}

/**
 * Issues an invoice: assigns its number, snapshots both parties and freezes it.
 *
 * Party details are copied rather than referenced so the invoice still renders
 * correctly years later even if the merchant has since moved or been renamed.
 */
export async function issueInvoice(
  db: Database,
  invoiceId: string,
  options: { issuedBy?: string; termsDays?: number } = {},
  now: () => number = () => Date.now(),
): Promise<string> {
  const invoice = await loadInvoice(db, invoiceId);

  if (invoice.state !== "approved") {
    throw new InvoiceError(
      `Only an approved invoice can be issued; ${invoiceId} is ${invoice.state}`,
    );
  }
  if (invoice.number) {
    throw new InvoiceError(`Invoice ${invoiceId} already carries number ${invoice.number}`);
  }

  const merchant = await db
    .prepare(
      `SELECT name, legal_name, v_tal, address_line_one, address_line_two,
              postal_code, city, country_code, invoice_email, payment_terms_days
         FROM merchant WHERE id = ?1`,
    )
    .bind(invoice.merchant_id)
    .first<{
      name: string;
      legal_name: string | null;
      v_tal: string | null;
      address_line_one: string | null;
      address_line_two: string | null;
      postal_code: string | null;
      city: string | null;
      country_code: string | null;
      invoice_email: string | null;
      payment_terms_days: number;
    }>();

  if (!merchant) throw new InvoiceError(`Unknown merchant ${invoice.merchant_id}`);

  const issuedAt = new Date(now());
  const year = issuedAt.getUTCFullYear();
  const number = await nextInvoiceNumber(db, invoice.series, year, now);

  const termsDays = options.termsDays ?? merchant.payment_terms_days ?? 14;
  const dueAt = new Date(issuedAt.getTime() + termsDays * 86_400_000);

  const merchantSnapshot: PartySnapshot = {
    name: merchant.legal_name ?? merchant.name,
    vTal: merchant.v_tal,
    addressLineOne: merchant.address_line_one,
    addressLineTwo: merchant.address_line_two,
    postalCode: merchant.postal_code,
    city: merchant.city,
    countryCode: merchant.country_code,
    email: merchant.invoice_email,
  };

  await db
    .prepare(
      `UPDATE invoice
          SET state = 'issued', number = ?2, issued_at = ?3, due_at = ?4,
              issuer_snapshot = ?5, merchant_snapshot = ?6
        WHERE id = ?1`,
    )
    .bind(
      invoiceId,
      number,
      issuedAt.toISOString(),
      dueAt.toISOString(),
      JSON.stringify(BETAL_PARTY),
      JSON.stringify(merchantSnapshot),
    )
    .run();

  return number;
}

/**
 * Issues a credit note against an invoice.
 *
 * An issued invoice is never edited. A correction is a separate document that
 * references the original, which is both what Faroese bookkeeping expects and the only
 * way the numbering stays gapless and the audit trail intact.
 */
export async function creditInvoice(
  db: Database,
  invoiceId: string,
  options: { reason: string; createdBy?: string; amountMinor?: number },
  now: () => number = () => Date.now(),
): Promise<{ id: string; number: string }> {
  const original = await loadInvoice(db, invoiceId);

  if (original.state !== "issued" && original.state !== "paid" && original.state !== "overdue") {
    throw new InvoiceError(
      `Only an issued invoice can be credited; ${invoiceId} is ${original.state}`,
    );
  }
  if (original.kind !== "invoice") {
    throw new InvoiceError(`Cannot credit a ${original.kind}`);
  }

  // A partial credit is expressed as a smaller net; VAT follows at the same rate the
  // original used, not today's rate, in case it has since changed.
  const netMinor = options.amountMinor ?? original.net_minor;
  const rate = original.vat_rate_basis_points || MVG_RATE_BASIS_POINTS;
  const vatMinor = Math.round((netMinor * rate) / 10000);

  const creditId = crypto.randomUUID();
  const timestamp = new Date(now()).toISOString();

  await db
    .prepare(
      `INSERT INTO invoice (
         id, merchant_id, billing_period_id, series, kind, credits_invoice_id,
         state, currency, net_minor, vat_minor, gross_minor, vat_rate_basis_points,
         collection_method, created_at, created_by, approved_at, approved_by
       ) VALUES (?1, ?2, NULL, ?3, 'credit_note', ?4, 'approved', ?5, ?6, ?7, ?8, ?9,
                 ?10, ?11, ?12, ?11, ?12)`,
    )
    .bind(
      creditId,
      original.merchant_id,
      original.series,
      invoiceId,
      original.currency,
      -netMinor,
      -vatMinor,
      -(netMinor + vatMinor),
      rate,
      original.collection_method,
      timestamp,
      options.createdBy ?? null,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO invoice_line (
         id, invoice_id, position, kind, description, quantity, unit_minor,
         amount_minor
       ) VALUES (?1, ?2, 0, 'manual_adjustment', ?3, 1, ?4, ?4)`,
    )
    .bind(
      crypto.randomUUID(),
      creditId,
      `Kredittnota fyri ${original.number ?? invoiceId}: ${options.reason}`,
      -netMinor,
    )
    .run();

  const issuedAt = new Date(now());
  const number = await nextInvoiceNumber(
    db,
    original.series,
    issuedAt.getUTCFullYear(),
    now,
  );

  await db
    .prepare(
      `UPDATE invoice SET state = 'issued', number = ?2, issued_at = ?3,
              issuer_snapshot = ?4, merchant_snapshot = ?5
        WHERE id = ?1`,
    )
    .bind(
      creditId,
      number,
      issuedAt.toISOString(),
      original.issuer_snapshot ?? JSON.stringify(BETAL_PARTY),
      original.merchant_snapshot,
    )
    .run();

  // A fully credited invoice is marked as such; a partial credit leaves it standing.
  if (netMinor >= original.net_minor) {
    await db
      .prepare(`UPDATE invoice SET state = 'credited' WHERE id = ?1`)
      .bind(invoiceId)
      .run();
  }

  return { id: creditId, number };
}

export async function markPaid(
  db: Database,
  invoiceId: string,
  now: () => number = () => Date.now(),
): Promise<void> {
  const invoice = await loadInvoice(db, invoiceId);
  if (invoice.state !== "issued" && invoice.state !== "overdue") {
    throw new InvoiceError(`Cannot mark a ${invoice.state} invoice as paid`);
  }

  await db
    .prepare(`UPDATE invoice SET state = 'paid', paid_at = ?2 WHERE id = ?1`)
    .bind(invoiceId, new Date(now()).toISOString())
    .run();
}

/** Flags issued invoices past their due date, for the collection view. */
export async function markOverdue(
  db: Database,
  now: () => number = () => Date.now(),
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE invoice SET state = 'overdue'
        WHERE state = 'issued' AND due_at IS NOT NULL AND due_at < ?1`,
    )
    .bind(new Date(now()).toISOString())
    .run();
  return result.meta.changes ?? 0;
}

export interface RenderedInvoice {
  invoice: InvoiceRow;
  issuer: PartySnapshot;
  merchant: PartySnapshot;
  lines: Array<{
    description: string;
    quantity: number;
    unit_minor: number;
    amount_minor: number;
    basis_points: number | null;
  }>;
}

/** Everything needed to render an invoice, using the snapshotted party details. */
export async function renderInvoice(
  db: Database,
  invoiceId: string,
): Promise<RenderedInvoice> {
  const invoice = await loadInvoice(db, invoiceId);
  const lines = await db
    .prepare(
      `SELECT description, quantity, unit_minor, amount_minor, basis_points
         FROM invoice_line WHERE invoice_id = ?1 ORDER BY position ASC`,
    )
    .bind(invoiceId)
    .all<RenderedInvoice["lines"][number]>();

  return {
    invoice,
    issuer: invoice.issuer_snapshot
      ? (JSON.parse(invoice.issuer_snapshot) as PartySnapshot)
      : BETAL_PARTY,
    merchant: invoice.merchant_snapshot
      ? (JSON.parse(invoice.merchant_snapshot) as PartySnapshot)
      : { name: "", vTal: null },
    lines: lines.results,
  };
}

/**
 * The transactions behind a line.
 *
 * This is what turns "1.247 kr" into an answer. A merchant querying a figure gets the
 * actual payments it was computed from.
 */
export async function lineEvidence(
  db: Database,
  invoiceLineId: string,
): Promise<Array<{ transaction_id: string; amount_minor: number | null }>> {
  const result = await db
    .prepare(
      `SELECT transaction_id, amount_minor FROM invoice_line_input
        WHERE invoice_line_id = ?1 ORDER BY transaction_id`,
    )
    .bind(invoiceLineId)
    .all<{ transaction_id: string; amount_minor: number | null }>();
  return result.results;
}
