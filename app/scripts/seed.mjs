#!/usr/bin/env node
/**
 * Generates seed SQL for local development.
 *
 * Writes a realistic Faroese dataset — a Tórshavn coffee shop trading through August —
 * plus two sign-in sessions so the portal can be opened without wiring up email
 * delivery. Session ids are stored hashed, so the hashes are computed here and the
 * plaintext tokens printed for pasting into a cookie.
 *
 * Usage:
 *   node scripts/seed.mjs > .seed.sql
 *   npx wrangler d1 execute betal --local --file=.seed.sql
 */

import { createHash, randomUUID } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const q = (value) =>
  value === null || value === undefined
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;

const lines = [];
const add = (sql) => lines.push(sql);

const MERCHANT_ID = "11111111-1111-4111-8111-111111111111";
const POS_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";

// Dates are relative to today, not fixed.
//
// A hardcoded month means "today" and "this month" are empty the moment the calendar
// moves past it, so the overview reads as a dead account. Trade runs from the start of
// last month up to now, which gives a complete month to close and invoice plus a
// part-month in progress — the state a real merchant is usually in.
const NOW = new Date();
const TODAY = Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate());

// The previous complete month: what gets frozen, reconciled and billed.
const CLOSED_YEAR = NOW.getUTCMonth() === 0 ? NOW.getUTCFullYear() - 1 : NOW.getUTCFullYear();
const CLOSED_MONTH = NOW.getUTCMonth() === 0 ? 12 : NOW.getUTCMonth();
const MONTH_START = Date.UTC(CLOSED_YEAR, CLOSED_MONTH - 1, 1);
const MONTH_END = Date.UTC(CLOSED_YEAR, CLOSED_MONTH, 1);

// Trade continues into the current month, up to and including today.
const TRADING_END = TODAY + 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

add("PRAGMA foreign_keys = OFF;");
for (const table of [
  "invoice_line_input",
  "invoice_line",
  "invoice",
  "period_discrepancy",
  "billing_period",
  "price_plan_rule",
  "price_plan",
  "cost_plan",
  "settlement_adjustment",
  "settlement_transaction",
  "settlement_transfer",
  "operation",
  "txn",
  "terminal",
  "webhook_endpoint",
  "webhook_delivery",
  "sync_cursor",
  "point_of_sale",
  "session",
  "login_token",
  "app_user",
  "ticket_message",
  "ticket",
  "acquiring_application",
  "contract",
  "lead",
  "onboarding_step",
  "email_delivery_event",
  "onboarding_bank_email",
  "document_instance",
  "onboarding_submission_snapshot",
  "onboarding_answer",
  "onboarding_event",
  "onboarding_signing",
  "onboarding_document",
  "onboarding_owner",
  "onboarding_application",
  "acquiring_price_list",
  "merchant",
]) {
  add(`DELETE FROM ${table};`);
}

// --- Merchant -------------------------------------------------------------

add(`INSERT INTO merchant (
  id, epay_account_id, name, legal_name, environment, epay_status, status,
  currency, timezone, domain, v_tal, country_code, city, postal_code,
  address_line_one, invoice_email, payment_terms_days, collection_method,
  acquirer, acquiring_status, created_at, created_at_ms
) VALUES (
  ${q(MERCHANT_ID)}, ${q(ACCOUNT_ID)}, 'Kaffihúsið við Vág', 'Kaffihúsið við Vág P/F',
  'live', 'active', 'active', 'DKK', 'Atlantic/Faroe', 'kaffihusid.fo',
  '123456', 'FO', 'Tórshavn', '100', 'Bryggjubakki 12',
  'rokning@kaffihusid.fo', 14, 'manual', 'clearhaus', 'approved',
  '2026-02-01T09:00:00Z', ${Date.UTC(2026, 1, 1)}
);`);

add(`INSERT INTO point_of_sale (
  id, merchant_id, name, descriptor, domain, webhook_secret, created_at
) VALUES (
  ${q(POS_ID)}, ${q(MERCHANT_ID)}, 'Betal', 'KAFFIHUSID', 'kaffihusid.fo',
  'Bearer local-development-secret', '2026-02-01T09:00:00Z'
);`);

add(`INSERT INTO terminal (
  id, merchant_id, point_of_sale_id, device_id, external_id, description, created_at
) VALUES (
  ${q(randomUUID())}, ${q(MERCHANT_ID)}, ${q(POS_ID)}, 'LDG7M4WW44G', 'terminal-1',
  'Kassi við disk', '2026-02-01T09:00:00Z'
);`);

add(`INSERT INTO webhook_endpoint (
  id, merchant_id, epay_webhook_id, url, events, created_at
) VALUES (
  ${q(randomUUID())}, ${q(MERCHANT_ID)}, 'wh-1',
  'https://app.betal.fo/api/hooks/${MERCHANT_ID}?channel=event',
  '["transaction.success.v1","settlement.transfer-ready.v1"]', '2026-02-01T09:00:00Z'
);`);

// --- Users and sessions ---------------------------------------------------

const STAFF_TOKEN = "dev-staff-session-token";
const MERCHANT_TOKEN = "dev-merchant-session-token";
const STAFF_ID = randomUUID();
const MERCHANT_USER_ID = randomUUID();

add(`INSERT INTO app_user (id, email, name, kind, merchant_id, role, created_at)
VALUES
  (${q(STAFF_ID)}, 'ingvar@betal.fo', 'Ingvar', 'staff', NULL, 'owner',
   '2026-01-01T00:00:00Z'),
  (${q(MERCHANT_USER_ID)}, 'eigari@kaffihusid.fo', 'Eigari', 'merchant',
   ${q(MERCHANT_ID)}, 'owner', '2026-02-01T09:00:00Z');`);

const farFuture = Date.UTC(2027, 0, 1);
add(`INSERT INTO session (id, user_id, expires_at_ms, created_at_ms)
VALUES
  (${q(sha256(STAFF_TOKEN))}, ${q(STAFF_ID)}, ${farFuture}, ${MONTH_START}),
  (${q(sha256(MERCHANT_TOKEN))}, ${q(MERCHANT_USER_ID)}, ${farFuture}, ${MONTH_START});`);

// --- Pricing --------------------------------------------------------------

const PLAN_ID = randomUUID();
add(`INSERT INTO price_plan (
  id, merchant_id, name, version, is_template, currency, billable_states,
  billable_types, bill_refunds, effective_from, created_at
) VALUES (
  ${q(PLAN_ID)}, ${q(MERCHANT_ID)}, 'Standard', 1, 0, 'DKK',
  '["SUCCESS"]', '["PAYMENT"]', 0, '2026-02-01', '2026-02-01'
);`);

add(`INSERT INTO price_plan_rule (id, price_plan_id, position, kind, label, params, created_at)
VALUES
  (${q(randomUUID())}, ${q(PLAN_ID)}, 1, 'monthly_fixed', 'Gáttargjald',
   '{"amountMinor":14900}', '2026-02-01'),
  (${q(randomUUID())}, ${q(PLAN_ID)}, 2, 'per_transaction', 'Gjald per gjalding',
   '{"amountMinor":50}', '2026-02-01');`);

add(`INSERT INTO cost_plan (
  id, merchant_id, version, per_transaction_minor, monthly_fixed_minor,
  percentage_basis_points, effective_from, created_at
) VALUES (
  ${q(randomUUID())}, ${q(MERCHANT_ID)}, 1, 18, 4900, 0, '2026-01-01', '2026-01-01'
);`);

// --- Transactions ---------------------------------------------------------

// Deterministic pseudo-randomness so the dataset is identical on every run.
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (items) => items[Math.floor(rand() * items.length)];

const schemes = ["Visa", "Mastercard", "Dankort", "Visa", "Mastercard"];
const issuers = ["Betri Banki", "BankNordik", "Norðoya Sparikassi"];
const references = ["Kaffi", "Morgunmatur", "Døgurði", "Kaka", "Take-away"];

const transactions = [];
let day = 1;

// Roughly 8 payments a working day, from the start of last month until today.
const TRADING_DAYS = Math.round((TRADING_END - MONTH_START) / 86_400_000);
for (let d = 0; d < TRADING_DAYS; d += 1) {
  const dayStart = MONTH_START + d * 86_400_000;
  if (dayStart >= TRADING_END) break;
  const weekday = new Date(dayStart).getUTCDay();
  const count = weekday === 0 ? 0 : 6 + Math.floor(rand() * 5);

  for (let i = 0; i < count; i += 1) {
    const at = dayStart + (8 + Math.floor(rand() * 9)) * 3_600_000 + i * 60_000;
    // A coffee shop: 25 to 320 kroner.
    const amount = (25 + Math.floor(rand() * 295)) * 100;
    const failed = rand() < 0.05;
    const scheme = pick(schemes);
    // Card prefixes by scheme, with varying last four, so the list looks like real
    // trade rather than one card used two hundred times.
    const prefix =
      scheme === "Visa" ? "45710000" : scheme === "Mastercard" ? "51701600" : "50190005";
    const tail = String(1000 + Math.floor(rand() * 8999));

    transactions.push({
      id: `TX${String(transactions.length + 1).padStart(5, "0")}`,
      amount,
      at,
      state: failed ? "FAILED" : "SUCCESS",
      scheme,
      issuer: pick(issuers),
      pan: `${prefix}XXXX${tail}`,
      reference: `${pick(references)}-${day}${i}`,
      errorCode: failed ? pick(["INSUFFICIENT_FUNDS", "DO_NOT_HONOR"]) : null,
    });
  }
  day += 1;
}

// One refunded payment, so the derived status column has something to show.
const refundTarget = transactions.find((t) => t.state === "SUCCESS");
if (refundTarget) refundTarget.refunded = refundTarget.amount;

for (const tx of transactions) {
  const captured = tx.state === "SUCCESS" ? tx.amount : 0;
  add(`INSERT INTO txn (
    id, merchant_id, point_of_sale_id, session_id, state, type, error_code,
    amount, surcharge, currency, payment_method_id, payment_method_type,
    payment_method_sub_type, payment_method_display, sca_mode, instant_capture,
    reference, acquirer, mcc, amount_authorized, amount_captured, amount_refunded,
    amount_voided, amount_remaining, card_scheme, card_issuer, card_country,
    card_funding, sca_type, sca_verification, client_country,
    created_at, created_at_ms, synced_at_ms, source
  ) VALUES (
    ${q(tx.id)}, ${q(MERCHANT_ID)}, ${q(POS_ID)}, ${q(randomUUID())},
    ${q(tx.state)}, 'PAYMENT', ${q(tx.errorCode)}, ${tx.amount}, 0, 'DKK',
    ${q(randomUUID())}, 'CARD', ${q(tx.scheme)}, ${q(tx.pan)}, 'NORMAL', 'VOID',
    ${q(tx.reference)}, 'clearhaus', '5814', ${tx.amount}, ${captured},
    ${tx.refunded ?? 0}, 0, ${captured - (tx.refunded ?? 0)},
    ${q(tx.scheme)}, ${q(tx.issuer)}, 'FO', 'debit', '3DS', 'FRICTIONLESS', 'FO',
    ${q(iso(tx.at))}, ${tx.at}, ${tx.at}, 'webhook'
  );`);

  add(`INSERT INTO operation (
    id, transaction_id, merchant_id, type, state, amount, created_at,
    created_at_ms, finalized_at, finalized_at_ms
  ) VALUES (
    ${q(randomUUID())}, ${q(tx.id)}, ${q(MERCHANT_ID)}, 'AUTHORIZATION',
    ${q(tx.state === "SUCCESS" ? "SUCCESS" : "FAILED")}, ${tx.amount},
    ${q(iso(tx.at))}, ${tx.at}, ${q(iso(tx.at + 1000))}, ${tx.at + 1000}
  );`);

  if (tx.state === "SUCCESS") {
    add(`INSERT INTO operation (
      id, transaction_id, merchant_id, type, state, amount, created_at,
      created_at_ms, finalized_at, finalized_at_ms
    ) VALUES (
      ${q(randomUUID())}, ${q(tx.id)}, ${q(MERCHANT_ID)}, 'CAPTURE', 'SUCCESS',
      ${tx.amount}, ${q(iso(tx.at + 2000))}, ${tx.at + 2000},
      ${q(iso(tx.at + 3000))}, ${tx.at + 3000}
    );`);
  }

  if (tx.refunded) {
    add(`INSERT INTO operation (
      id, transaction_id, merchant_id, type, state, amount, created_at,
      created_at_ms, finalized_at, finalized_at_ms
    ) VALUES (
      ${q(randomUUID())}, ${q(tx.id)}, ${q(MERCHANT_ID)}, 'REFUND', 'SUCCESS',
      ${tx.refunded}, ${q(iso(tx.at + 86_400_000))}, ${tx.at + 86_400_000},
      ${q(iso(tx.at + 86_401_000))}, ${tx.at + 86_401_000}
    );`);
  }
}

// --- Settlement, with the fee breakdown that makes the screen worth having ---

const successful = transactions.filter((t) => t.state === "SUCCESS");
const firstWeek = successful.filter((t) => t.at < MONTH_START + 7 * 86_400_000);
const TRANSFER_ID = randomUUID();
// Acquirers settle on a lag, so the first week's trade lands a week later.
const SETTLED_AT_MS = MONTH_START + 7 * 86_400_000 + 6 * 3_600_000;
const SETTLED_ON = new Date(SETTLED_AT_MS).toISOString().slice(0, 10);

const decimal = (minor) => (minor / 100).toFixed(2);
let grossMinor = 0;
let feeMinor = 0;

const settlementRows = firstWeek.map((tx) => {
  // Blended acquirer pricing: roughly 1,2% plus interchange and scheme.
  const acquirerFee = -Math.round(tx.amount * 0.008);
  const interchange = -Math.round(tx.amount * 0.002);
  const scheme = -Math.round(tx.amount * 0.001);
  const fees = acquirerFee + interchange + scheme;
  grossMinor += tx.amount;
  feeMinor += fees;
  return { tx, acquirerFee, interchange, scheme, net: tx.amount + fees };
});

add(`INSERT INTO settlement_transfer (
  id, merchant_id, acquirer, settlement_name, settlement_ids, posting_date,
  net_amount, currency, acquirer_reference, created_at, created_at_ms,
  transactions_synced
) VALUES (
  ${q(TRANSFER_ID)}, ${q(MERCHANT_ID)}, 'clearhaus',
  ${q(`settlement-${SETTLED_ON}.csv`)},
  '["R01234"]', ${q(SETTLED_ON)}, ${q(decimal(grossMinor + feeMinor))}, 'DKK',
  ${q(`acq-${SETTLED_ON}`)}, ${q(`${SETTLED_ON}T06:00:00Z`)}, ${SETTLED_AT_MS}, 1
);`);

for (const row of settlementRows) {
  const settlementId = randomUUID();
  add(`INSERT INTO settlement_transaction (
    id, settlement_transfer_id, merchant_id, transaction_id, agreement_id,
    merchant_reference, acquirer_reference, posting_date, net_amount, currency,
    created_at
  ) VALUES (
    ${q(settlementId)}, ${q(TRANSFER_ID)}, ${q(MERCHANT_ID)}, ${q(row.tx.id)},
    'R01234', ${q(row.tx.reference)}, ${q(`acq-${row.tx.id}`)}, ${q(SETTLED_ON)},
    ${q(decimal(row.net))}, 'DKK', ${q(`${SETTLED_ON}T06:00:00Z`)}
  );`);

  for (const [type, amount] of [
    ["ACQUIRER_FEE", row.acquirerFee],
    ["INTERCHANGE_FEE", row.interchange],
    ["SCHEME_FEE", row.scheme],
  ]) {
    add(`INSERT INTO settlement_adjustment (
      id, merchant_id, settlement_transfer_id, settlement_transaction_id, scope,
      type, amount, description
    ) VALUES (
      ${q(randomUUID())}, ${q(MERCHANT_ID)}, ${q(TRANSFER_ID)}, ${q(settlementId)},
      'transaction', ${q(type)}, ${q(decimal(amount))}, ${q(type.toLowerCase())}
    );`);
  }
}

// --- Closed period and issued invoice -------------------------------------

const PERIOD_ID = `${MERCHANT_ID}:${CLOSED_YEAR}-${String(CLOSED_MONTH).padStart(2, '0')}`;
// Closed on the first of the following month, which is when a close actually runs.
const CLOSED_AT = new Date(MONTH_END).toISOString().slice(0, 10);
// Only the closed month is billable; trade since then belongs to the open period.
const closedMonthTransactions = transactions.filter((t) => t.at < MONTH_END);
const closedMonthSuccessful = closedMonthTransactions.filter((t) => t.state === 'SUCCESS');
const billableCount = closedMonthSuccessful.length;
const volumeMinor = closedMonthSuccessful.reduce((sum, t) => sum + t.amount, 0);

add(`INSERT INTO billing_period (
  id, merchant_id, year, month, state, starts_at_ms, ends_at_ms, frozen_at,
  reconciled_at, rated_at, issued_at, mirror_count, epay_count, billable_count,
  gross_minor, price_plan_id, created_at, updated_at
) VALUES (
  ${q(PERIOD_ID)}, ${q(MERCHANT_ID)}, ${CLOSED_YEAR}, ${CLOSED_MONTH}, 'issued',
  ${MONTH_START}, ${MONTH_END},
  ${q(`${CLOSED_AT}T00:00:00Z`)}, ${q(`${CLOSED_AT}T00:10:00Z`)},
  ${q(`${CLOSED_AT}T00:15:00Z`)}, ${q(`${CLOSED_AT}T00:20:00Z`)},
  ${closedMonthTransactions.length}, ${closedMonthTransactions.length},
  ${billableCount}, ${volumeMinor}, ${q(PLAN_ID)}, '2026-09-01', '2026-09-01'
);`);

const netMinor = 14900 + billableCount * 50;
const vatMinor = Math.round(netMinor * 0.25);
const INVOICE_ID = randomUUID();

add(`INSERT INTO invoice (
  id, merchant_id, billing_period_id, number, series, kind, state, currency,
  net_minor, vat_minor, gross_minor, vat_rate_basis_points, collection_method,
  issuer_snapshot, merchant_snapshot, issued_at, due_at, created_at, approved_at,
  approved_by
) VALUES (
  ${q(INVOICE_ID)}, ${q(MERCHANT_ID)}, ${q(PERIOD_ID)}, 'BETAL-2026-0001', 'BETAL',
  'invoice', 'issued', 'DKK', ${netMinor}, ${vatMinor}, ${netMinor + vatMinor}, 2500,
  'manual',
  '{"name":"Betal P/F","vTal":null,"city":"Tórshavn","countryCode":"FO","email":"rokning@betal.fo"}',
  '{"name":"Kaffihúsið við Vág P/F","vTal":"123456","city":"Tórshavn","postalCode":"100","addressLineOne":"Bryggjubakki 12","countryCode":"FO","email":"rokning@kaffihusid.fo"}',
  ${q(`${CLOSED_AT}T00:20:00Z`)},
  ${q(new Date(MONTH_END + 14 * 86_400_000).toISOString().slice(0, 10) + 'T00:20:00Z')},
  ${q(`${CLOSED_AT}T00:15:00Z`)}, ${q(`${CLOSED_AT}T00:18:00Z`)}, 'ingvar@betal.fo'
);`);

const LINE_FIXED = randomUUID();
const LINE_PER_TX = randomUUID();

add(`INSERT INTO invoice_line (
  id, invoice_id, position, kind, description, quantity, unit_minor, amount_minor
) VALUES
  (${q(LINE_FIXED)}, ${q(INVOICE_ID)}, 0, 'monthly_fixed', 'Gáttargjald', 1, 14900, 14900),
  (${q(LINE_PER_TX)}, ${q(INVOICE_ID)}, 1, 'per_transaction', 'Gjald per gjalding',
   ${billableCount}, 50, ${billableCount * 50});`);

// The evidence behind the per-transaction line: every payment it counted.
for (const tx of closedMonthSuccessful) {
  add(`INSERT INTO invoice_line_input (id, invoice_line_id, transaction_id, amount_minor)
VALUES (${q(randomUUID())}, ${q(LINE_PER_TX)}, ${q(tx.id)}, 50);`);
}

// --- Pipeline and support -------------------------------------------------

add(`INSERT INTO lead (
  id, name, company, email, phone, product, message, state, created_at_ms,
  updated_at_ms
) VALUES
  (${q(randomUUID())}, 'Jógvan Poulsen', 'Fiskahandil P/F', 'jogvan@fiskahandil.fo',
   '+298 212121', 'stadnum',
   'Vit vilja taka ímóti korti á marknaðinum í Klaksvík.', 'new',
   ${Date.UTC(2026, 7, 20)}, ${Date.UTC(2026, 7, 20)}),
  (${q(randomUUID())}, 'Anna Joensen', 'Handil í Havn', 'anna@handil.fo', NULL,
   'alnetinum', 'Vit skulu hava gjaldsgátt til nýggju nethandilina.', 'contacted',
   ${Date.UTC(2026, 7, 25)}, ${Date.UTC(2026, 7, 26)}),
  (${q(randomUUID())}, 'Petur Hansen', 'Bilaverkstaður', 'petur@bilar.fo',
   '+298 313131', 'hald', 'Vit hava eina serliga skipan og tørva hjálp.', 'won',
   ${Date.UTC(2026, 6, 10)}, ${Date.UTC(2026, 7, 1)});`);

const TICKET_ID = randomUUID();
add(`INSERT INTO ticket (
  id, merchant_id, transaction_id, subject, state, priority, opened_by,
  created_at_ms, updated_at_ms
) VALUES (
  ${q(TICKET_ID)}, ${q(MERCHANT_ID)}, ${q(refundTarget?.id ?? null)},
  'Kundin spyr um endurgjald', 'open', 'normal', 'eigari@kaffihusid.fo',
  ${Date.UTC(2026, 7, 28)}, ${Date.UTC(2026, 7, 28)}
);`);

add(`INSERT INTO ticket_message (id, ticket_id, author, internal, body, created_at_ms)
VALUES (${q(randomUUID())}, ${q(TICKET_ID)}, 'eigari@kaffihusid.fo', 0,
  'Kundin sigur, at endurgjaldið ikki er komið inn á kontuna enn.',
  ${Date.UTC(2026, 7, 28)});`);

add(`INSERT INTO acquiring_application (
  id, merchant_id, acquirer, state, external_ref, submitted_at, decided_at,
  created_at_ms, updated_at_ms
) VALUES (
  ${q(`${MERCHANT_ID}:clearhaus`)}, ${q(MERCHANT_ID)}, 'clearhaus', 'approved',
  'EO-2026-0042', '2026-02-05T00:00:00Z', '2026-02-12T00:00:00Z',
  ${Date.UTC(2026, 1, 5)}, ${Date.UTC(2026, 1, 12)}
);`);

// --- Dummy FO price lists -------------------------------------------------
// Temporary stand-ins so the official PDF and Samleikin can run locally.
// Staff replace these at /betal/prislistar. Never treat them as Swedbank commercial.

const PRICE_CATEGORIES = [
  "dk_debit",
  "dk_credit",
  "dk_corporate",
  "eu_debit",
  "eu_credit",
  "eu_corporate",
  "non_eu_debit",
  "non_eu_credit",
  "non_eu_corporate",
];
const DUMMY_RATES_NOTE =
  "TEST dummy FO-prísir — ikki Swedbank-kelda. Broytist tá starvsfólk seta almennu tølini.";

const dummyOfficialRates = (kind) => {
  const bump = kind === "sector2" ? 40 : 0;
  return {
    establishmentFeeMinor: kind === "sector2" ? 25_000 : 15_000,
    monthlyFeeMinor: kind === "sector2" ? 9_900 : 4_900,
    minimumMonthlyPaymentMinor: kind === "sector2" ? 5_000 : 2_500,
    priceCategory: kind === "sector2" ? "TEST FO dummy geiri 2" : "TEST FO dummy",
    cardRates: Object.fromEntries(
      PRICE_CATEGORIES.map((category) => [
        category,
        {
          visa: { transactionMinor: 25 + bump, basisPoints: 89 + bump },
          mastercard: { transactionMinor: 29 + bump, basisPoints: 95 + bump },
          diners: { transactionMinor: 50 + bump, basisPoints: 149 + bump },
        },
      ]),
    ),
  };
};

for (const [kind, id] of [
  ["standard", "dummy-standard"],
  ["sector2", "dummy-sector2"],
]) {
  add(`INSERT INTO acquiring_price_list (
    id, kind, version, currency, country_code, rates_json, effective_from,
    created_at_ms, status, created_by, approved_by, approved_at_ms, source_note
  ) VALUES (
    ${q(id)}, ${q(kind)}, 1, 'DKK', 'FO',
    ${q(JSON.stringify(dummyOfficialRates(kind)))},
    '2026-09-13', ${Date.UTC(2026, 8, 13)}, 'approved',
    'seed@betal.fo', 'seed@betal.fo', ${Date.UTC(2026, 8, 13)},
    ${q(DUMMY_RATES_NOTE)}
  );`);
}

// --- Onboarding merchant --------------------------------------------------
// The coffee shop is already approved and must not see the payouts-paused banner.
// This second shop is signing-ready so dummy rates + Samleikin can be exercised.

const ONBOARD_ID = "44444444-4444-4444-8444-444444444444";
const ONBOARD_ACCOUNT = "55555555-5555-4555-8555-555555555555";
const ONBOARD_APP = "66666666-6666-4666-8666-666666666666";
const ONBOARD_OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ONBOARD_TOKEN = "dev-onboarding-session-token";
const ONBOARD_USER = randomUUID();
const SAMPLE_PDF = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";
const SAMPLE_PDF_SHA = sha256(SAMPLE_PDF);
const SAMPLE_PDF_HEX = Buffer.from(SAMPLE_PDF).toString("hex");

add(`INSERT INTO merchant (
  id, epay_account_id, name, legal_name, environment, epay_status, status,
  currency, timezone, domain, v_tal, country_code, city, postal_code,
  address_line_one, invoice_email, payment_terms_days, collection_method,
  acquirer, acquiring_status, created_at, created_at_ms
) VALUES (
  ${q(ONBOARD_ID)}, ${q(ONBOARD_ACCOUNT)}, 'Handilin við Bryggjuni',
  'Handilin við Bryggjuni Sp/f', 'test', 'active', 'onboarding', 'DKK',
  'Atlantic/Faroe', 'handilin.fo', '654321', 'FO', 'Tórshavn', '100',
  'Bryggjubakki 4', 'rokning@handilin.fo', 14, 'manual', NULL, 'not_started',
  '2026-09-01T09:00:00Z', ${Date.UTC(2026, 8, 1)}
);`);

add(`INSERT INTO app_user (id, email, name, kind, merchant_id, role, created_at)
VALUES (
  ${q(ONBOARD_USER)}, 'eigari@handilin.fo', 'Jóhanna', 'merchant',
  ${q(ONBOARD_ID)}, 'owner', '2026-09-01T09:00:00Z'
);`);

add(`INSERT INTO session (id, user_id, expires_at_ms, created_at_ms)
VALUES (${q(sha256(ONBOARD_TOKEN))}, ${q(ONBOARD_USER)}, ${farFuture}, ${TODAY});`);

add(`INSERT INTO onboarding_application (
  id, merchant_id, state, country_code, legal_name, v_tal, address_line_one,
  postal_code, city, company_type, registry_source, company_details_confirmed,
  website, sells, vertical_key, vertical_sector, equity, operations,
  bank_account, recommended_acquirer, extra_docs_required, screening_reason,
  created_at_ms, updated_at_ms
) VALUES (
  ${q(ONBOARD_APP)}, ${q(ONBOARD_ID)}, 'ready_for_signing', 'FO',
  'Handilin við Bryggjuni Sp/f', '654321', 'Bryggjubakki 4', '100', 'Tórshavn',
  'Sp/f', 'manual', 1, 'https://handilin.fo', 'Vørur til hús og heim',
  'retail', 2, 'positive', 'positive', '64601234567890', 'swedbank', 1,
  'Geiri 2 — Swedbank við hægri prísi og eyka skjølum',
  ${Date.UTC(2026, 8, 10)}, ${Date.UTC(2026, 8, 12)}
);`);

add(`INSERT INTO onboarding_owner (
  id, application_id, name, email, role, ownership_bps, is_signatory, sort_order
) VALUES (
  ${q(ONBOARD_OWNER)}, ${q(ONBOARD_APP)}, 'Anna Eigari', 'eigari@handilin.fo',
  'Eigari', 10000, 1, 0
);`);

const onboardAnswers = {
  annual_card_turnover_dkk: 1_000_000,
  average_transaction_dkk: 500,
  market_name: "Betal UX Test",
  contact_name: "Anna Eigari",
  contact_phone: "+298 123456",
  contact_email: "eigari@handilin.fo",
  invoice_email: "rokning@handilin.fo",
  product_type: "physical",
  inventory: "yes",
  delivery_method: "Postur og heintan",
  delivery_days: 2,
  subscriptions: false,
  donations: false,
  gift_cards: true,
  primary_customers: "consumers",
  payment_link_mode: "digital",
  save_card: false,
  wallets: ["applepay"],
  other_mit: false,
  website_terms: true,
  made_to_order: false,
  sales_regions: { denmark: 0, nordics: 100, eu: 0, usa: 0, other: 0 },
};

for (const [key, value] of Object.entries(onboardAnswers)) {
  add(`INSERT INTO onboarding_answer (
    application_id, key, value_json, source, confirmed_at_ms, updated_at_ms
  ) VALUES (
    ${q(ONBOARD_APP)}, ${q(key)}, ${q(JSON.stringify(value))}, 'merchant',
    ${Date.UTC(2026, 8, 12)}, ${Date.UTC(2026, 8, 12)}
  );`);
}

for (const kind of [
  "bank_confirmation",
  "company_registration",
  "owners_book",
  "industry_answers",
  "annual_accounts",
]) {
  add(`INSERT INTO onboarding_document (
    id, application_id, kind, required, file_name, content_type, byte_size, bytes,
    uploaded_by, uploaded_at_ms, storage, sha256, scan_status
  ) VALUES (
    ${q(randomUUID())}, ${q(ONBOARD_APP)}, ${q(kind)}, 1, ${q(`${kind}.pdf`)},
    'application/pdf', ${SAMPLE_PDF.length}, X'${SAMPLE_PDF_HEX}',
    'eigari@handilin.fo', ${Date.UTC(2026, 8, 12)}, 'd1', ${q(SAMPLE_PDF_SHA)},
    'basic_validated'
  );`);
}

add(`INSERT INTO onboarding_event (
  id, application_id, kind, actor_email, payload, at_ms
) VALUES (
  ${q(randomUUID())}, ${q(ONBOARD_APP)}, 'created', 'eigari@handilin.fo',
  ${q(JSON.stringify({ merchantId: ONBOARD_ID }))}, ${Date.UTC(2026, 8, 10)}
);`);

add("PRAGMA foreign_keys = ON;");

process.stdout.write(lines.join("\n") + "\n");

process.stderr.write(
  [
    "",
    `Seeded ${transactions.length} transactions from ${new Date(MONTH_START).toISOString().slice(0, 10)} to today.`,
    `Closed period ${CLOSED_YEAR}-${String(CLOSED_MONTH).padStart(2, "0")}: ${billableCount} billable, invoiced.`,
    "",
    "Sign in by setting a cookie on http://localhost:4321 :",
    `  Betal staff:  document.cookie = 'betal_session=${STAFF_TOKEN}; path=/'`,
    `  Merchant:     document.cookie = 'betal_session=${MERCHANT_TOKEN}; path=/'`,
    `  Onboarding:   document.cookie = 'betal_session=${ONBOARD_TOKEN}; path=/'`,
    "",
  ].join("\n"),
);
