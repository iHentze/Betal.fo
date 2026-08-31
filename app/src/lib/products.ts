import type { Database } from "./db/types";
import type { EpayMerchantClient } from "./epay";
import { formatMinor, minorToDecimal } from "./money";
import { recordAudit } from "./audit";

/**
 * The merchant-facing products beyond taking payments: links, QR codes and getting
 * the numbers into a bookkeeping system.
 *
 * These are the reason a merchant stays. The gateway is a commodity; having their
 * whole financial picture in one Faroese place is not.
 */

export interface PaymentLinkInput {
  merchantId: string;
  pointOfSaleId: string;
  amountMinor: number;
  currency?: string;
  reference?: string;
  description?: string;
  /** Minutes the link stays valid. ePay allows 1 to 120. */
  timeoutMinutes?: number;
  actorEmail: string;
}

/**
 * Creates a single-use payment link.
 *
 * For an invoice, a quote, a repair job — anything where the customer is not standing
 * at a checkout. The link carries a full payment session, so everything a hosted
 * checkout can do is available here too.
 */
export async function createPaymentLink(
  db: Database,
  client: EpayMerchantClient,
  input: PaymentLinkInput,
): Promise<{ url: string; id: string }> {
  const link = await client.createPaymentLink(
    {
      pointOfSaleId: input.pointOfSaleId,
      amount: input.amountMinor,
      currency: input.currency ?? "DKK",
      reference: input.reference,
      // Rendered on the customer's statement; ePay truncates beyond 39 characters.
      textOnStatement: input.description?.slice(0, 39),
      timeout: input.timeoutMinutes ?? 60,
      generateQrCode: true,
    },
    // Keyed on the merchant's own reference so a double-submitted form produces one
    // link rather than two.
    input.reference ? `link:${input.merchantId}:${input.reference}` : undefined,
  );

  await recordAudit(db, {
    actorEmail: input.actorEmail,
    merchantId: input.merchantId,
    action: "create_payment_link",
    subjectType: "payment_link",
    subjectId: link.id,
    amountMinor: input.amountMinor,
    currency: input.currency ?? "DKK",
  });

  return { url: link.url, id: link.id };
}

export interface MultiLinkInput {
  merchantId: string;
  pointOfSaleId: string;
  /** The suggested amount. With `dynamicAmount` the customer can change it. */
  amountMinor: number;
  currency?: string;
  label: string;
  /** Lets the payer choose what to pay: a tip jar, a donation, a market stall. */
  dynamicAmount?: boolean;
  actorEmail: string;
}

/**
 * Creates a reusable QR code.
 *
 * Every scan starts a fresh payment session, so one printed code serves a whole
 * season. ePay hosts the QR image, which matters because printing needs a real file
 * rather than a base64 blob.
 *
 * Two constraints worth knowing at the call site. `dynamicAmount` must be enabled on
 * the account by ePay support and they discourage it generally, because it hands the
 * amount to the client — pairing it with a pre-auth webhook is the documented way to
 * bound what can be charged. And a multi-link carries no reference or customer id, so
 * reconciliation of a scan has to ride on the session data from the webhook.
 */
export async function createMultiLink(
  db: Database,
  client: EpayMerchantClient,
  input: MultiLinkInput,
): Promise<{ url: string; qrUrl: string; id: string }> {
  const link = await client.createMultiLink({
    pointOfSaleId: input.pointOfSaleId,
    amount: input.amountMinor,
    currency: input.currency ?? "DKK",
    dynamicAmount: input.dynamicAmount ?? false,
    textOnStatement: input.label.slice(0, 39),
  });

  await recordAudit(db, {
    actorEmail: input.actorEmail,
    merchantId: input.merchantId,
    action: "create_payment_link",
    subjectType: "multi_link",
    subjectId: link.id,
    amountMinor: input.amountMinor,
    currency: input.currency ?? "DKK",
    detail: { dynamicAmount: input.dynamicAmount ?? false, label: input.label },
  });

  return { url: link.url, qrUrl: link.qrUrl, id: link.id };
}

// ---------------------------------------------------------------------------
// Accounting export
// ---------------------------------------------------------------------------

export type ExportFormat = "csv" | "json";

export interface ExportOptions {
  merchantId: string;
  /** Inclusive, epoch millis. */
  fromMs: number;
  /** Exclusive, epoch millis. */
  toMs: number;
  format?: ExportFormat;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",;\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Exports a period's payments for bookkeeping.
 *
 * ePay ships an e-conomic integration, which Faroese businesses largely do not use, so
 * this is a plain export their accountant can actually open. Semicolon-delimited and
 * comma-decimal, because that is what a Danish or Faroese spreadsheet locale expects —
 * a comma-delimited file with decimal points gets mangled on open.
 *
 * Amounts are written from integer minor units through the money module, never via a
 * float, and settlement fees are included so the merchant's books can carry the real
 * cost of accepting each payment rather than just the gross.
 */
export async function accountingExport(
  db: Database,
  options: ExportOptions,
): Promise<{ body: string; filename: string; contentType: string }> {
  const rows = await db
    .prepare(
      `SELECT t.id, t.created_at, t.reference, t.amount, t.surcharge, t.currency,
              t.state, t.payment_method_type, t.card_scheme, t.acquirer,
              t.amount_captured, t.amount_refunded,
              (SELECT COALESCE(SUM(CAST(a.amount AS REAL) * 100), 0)
                 FROM settlement_transaction st
                 JOIN settlement_adjustment a
                   ON a.settlement_transaction_id = st.id
                WHERE st.transaction_id = t.id) AS fee_minor,
              (SELECT MIN(st2.posting_date) FROM settlement_transaction st2
                WHERE st2.transaction_id = t.id) AS settled_on
         FROM txn t
        WHERE t.merchant_id = ?1
          AND t.created_at_ms >= ?2
          AND t.created_at_ms < ?3
          AND t.state = 'SUCCESS'
        ORDER BY t.created_at_ms ASC`,
    )
    .bind(options.merchantId, options.fromMs, options.toMs)
    .all<Record<string, any>>();

  const from = new Date(options.fromMs).toISOString().slice(0, 10);
  const to = new Date(options.toMs - 1).toISOString().slice(0, 10);

  if ((options.format ?? "csv") === "json") {
    return {
      body: JSON.stringify(rows.results, null, 2),
      filename: `betal-${from}-${to}.json`,
      contentType: "application/json",
    };
  }

  const header = [
    "Dagfesting",
    "Tilvísing",
    "ID",
    "Upphædd",
    "Tillegg",
    "Tikið",
    "Endurgoldið",
    "Avgjøld",
    "Netto",
    "Gjaldoyra",
    "Gjaldshátt",
    "Kortslag",
    "Innloysari",
    "Avroknað",
  ];

  const lines = [header.join(";")];

  for (const row of rows.results) {
    // Fees arrive as a negative number, so the net is the capture plus them.
    const feeMinor = Math.round(Number(row.fee_minor ?? 0));
    const capturedMinor = Number(row.amount_captured ?? 0);
    const refundedMinor = Number(row.amount_refunded ?? 0);
    const netMinor = capturedMinor - refundedMinor + feeMinor;

    lines.push(
      [
        row.created_at?.slice(0, 10),
        row.reference,
        row.id,
        // Comma decimals, matching the spreadsheet locale these will be opened in.
        minorToDecimal(row.amount).replace(".", ","),
        minorToDecimal(row.surcharge ?? 0).replace(".", ","),
        minorToDecimal(capturedMinor).replace(".", ","),
        minorToDecimal(refundedMinor).replace(".", ","),
        minorToDecimal(feeMinor).replace(".", ","),
        minorToDecimal(netMinor).replace(".", ","),
        row.currency,
        row.payment_method_type,
        row.card_scheme,
        row.acquirer,
        row.settled_on,
      ]
        .map(csvCell)
        .join(";"),
    );
  }

  return {
    body: `\uFEFF${lines.join("\r\n")}\r\n`,
    filename: `betal-${from}-${to}.csv`,
    // The BOM makes Excel read it as UTF-8, without which Faroese characters break.
    contentType: "text/csv; charset=utf-8",
  };
}

/** A short human summary of a period, for the export screen. */
export async function exportSummary(
  db: Database,
  options: Pick<ExportOptions, "merchantId" | "fromMs" | "toMs">,
): Promise<{ count: number; grossMinor: number; label: string }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS gross
         FROM txn
        WHERE merchant_id = ?1 AND created_at_ms >= ?2 AND created_at_ms < ?3
          AND state = 'SUCCESS'`,
    )
    .bind(options.merchantId, options.fromMs, options.toMs)
    .first<{ count: number; gross: number }>();

  return {
    count: row?.count ?? 0,
    grossMinor: row?.gross ?? 0,
    label: formatMinor(row?.gross ?? 0, { currency: "DKK" }),
  };
}
