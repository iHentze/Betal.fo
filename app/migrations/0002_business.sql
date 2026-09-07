-- Betal's own business data: who our clients are, what we charge them, what ePay
-- charges us, and every invoice we have issued.
--
-- None of this exists in ePay. ePay exposes no partner billing, commission or
-- revenue-share data at all, so the entire money loop is computed here and the
-- correctness of it is entirely our responsibility.

-- ---------------------------------------------------------------------------
-- Merchant business profile
-- ---------------------------------------------------------------------------

-- Faroese companies register with TAKS in Vinnuskráin and hold a 6-digit V-tal, not a
-- Danish CVR. Both parties' V-tal must appear on an invoice.
ALTER TABLE merchant ADD COLUMN v_tal TEXT;
ALTER TABLE merchant ADD COLUMN legal_name TEXT;
ALTER TABLE merchant ADD COLUMN address_line_one TEXT;
ALTER TABLE merchant ADD COLUMN address_line_two TEXT;
ALTER TABLE merchant ADD COLUMN postal_code TEXT;
ALTER TABLE merchant ADD COLUMN city TEXT;
ALTER TABLE merchant ADD COLUMN country_code TEXT NOT NULL DEFAULT 'FO';
ALTER TABLE merchant ADD COLUMN invoice_email TEXT;
ALTER TABLE merchant ADD COLUMN invoice_attention TEXT;
ALTER TABLE merchant ADD COLUMN phone TEXT;
-- How this merchant pays us: 'auto' charges a stored card through ePay with Betal
-- acting as its own merchant, 'manual' issues an invoice settled by bank transfer.
ALTER TABLE merchant ADD COLUMN collection_method TEXT NOT NULL DEFAULT 'manual';
-- The ePay subscription holding this merchant's card-on-file consent, against which
-- each month's invoice is charged. Unscheduled rather than a billing agreement,
-- because agreements carry a fixed amount and an invoice total varies with volume.
ALTER TABLE merchant ADD COLUMN billing_subscription_id TEXT;
ALTER TABLE merchant ADD COLUMN payment_terms_days INTEGER NOT NULL DEFAULT 14;
-- Which acquirer this merchant was placed with. Routing is a manual backoffice step
-- at ePay because the processor field is deprecated with no API replacement.
ALTER TABLE merchant ADD COLUMN acquirer TEXT;
ALTER TABLE merchant ADD COLUMN acquiring_status TEXT NOT NULL DEFAULT 'not_started';

-- ---------------------------------------------------------------------------
-- Pricing
-- ---------------------------------------------------------------------------

-- What we charge a merchant. Versioned rather than mutable: an invoice must be
-- reproducible years later, which is impossible if the plan behind it can be edited.
-- Changing a price creates a new version and closes the old one.
CREATE TABLE price_plan (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT REFERENCES merchant (id),
  name            TEXT NOT NULL,
  version         INTEGER NOT NULL,
  -- Null merchant_id marks a reusable template, e.g. our standard plan.
  is_template     INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'DKK',

  -- Which transactions this plan counts as billable. Stored on the plan rather than
  -- hardcoded, because "count the transactions" is ambiguous and the ambiguity turns
  -- into a client dispute months later. Default is successful payments only.
  billable_states TEXT NOT NULL DEFAULT '["SUCCESS"]',
  billable_types  TEXT NOT NULL DEFAULT '["PAYMENT"]',
  -- Whether a refund is itself a billable event.
  bill_refunds    INTEGER NOT NULL DEFAULT 0,

  effective_from  TEXT NOT NULL,
  effective_to    TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  notes           TEXT
);

CREATE INDEX idx_price_plan_merchant ON price_plan (merchant_id, effective_from DESC);
CREATE UNIQUE INDEX idx_price_plan_version ON price_plan (merchant_id, name, version);

-- An ordered list of rules, each producing at most one invoice line. Pricing is fully
-- negotiable per client, so this is a small rule language rather than a fixed set of
-- fee columns.
CREATE TABLE price_plan_rule (
  id            TEXT PRIMARY KEY,
  price_plan_id TEXT NOT NULL REFERENCES price_plan (id),
  -- Order matters: tiers and minimums are evaluated against what came before.
  position      INTEGER NOT NULL,
  -- per_transaction | percentage | monthly_fixed | per_point_of_sale | per_terminal
  --   | tiered_per_transaction | minimum | manual_adjustment
  kind          TEXT NOT NULL,
  label         TEXT NOT NULL,
  -- Rule parameters as JSON: amounts in minor units, rates in basis points, and for
  -- tiered rules an array of {upTo, amountMinor} bands.
  params        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_rule_plan ON price_plan_rule (price_plan_id, position);

-- What ePay charges Betal for this merchant's gateway. No ePay endpoint reports this,
-- so it is recorded by hand from the commercial agreement. Without it there is no
-- margin figure.
CREATE TABLE cost_plan (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT NOT NULL REFERENCES merchant (id),
  version             INTEGER NOT NULL,
  -- Our discounted gateway rate.
  per_transaction_minor INTEGER NOT NULL DEFAULT 0,
  monthly_fixed_minor   INTEGER NOT NULL DEFAULT 0,
  percentage_basis_points INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'DKK',
  effective_from      TEXT NOT NULL,
  effective_to        TEXT,
  source              TEXT,
  created_at          TEXT NOT NULL,
  created_by          TEXT
);

CREATE INDEX idx_cost_plan_merchant ON cost_plan (merchant_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- Billing periods and the close
-- ---------------------------------------------------------------------------

-- One month per merchant, moving through the close state machine. No invoice may be
-- issued from a period that is not reconciled, because a webhook-fed count is not
-- good enough to bill from: ePay pauses endpoints that fail and abandons delivery
-- after 25 attempts, so the mirror can be short without anything looking wrong.
CREATE TABLE billing_period (
  id               TEXT PRIMARY KEY,
  merchant_id      TEXT NOT NULL REFERENCES merchant (id),
  year             INTEGER NOT NULL,
  month            INTEGER NOT NULL,
  -- open -> frozen -> reconciling -> (discrepancy) -> reconciled -> rated -> issued
  state            TEXT NOT NULL DEFAULT 'open',
  -- Inclusive start, exclusive end, epoch millis.
  starts_at_ms     INTEGER NOT NULL,
  ends_at_ms       INTEGER NOT NULL,

  frozen_at        TEXT,
  reconciled_at    TEXT,
  rated_at         TEXT,
  issued_at        TEXT,

  -- Counts captured at reconciliation, kept for the audit trail.
  mirror_count     INTEGER,
  epay_count       INTEGER,
  billable_count   INTEGER,
  gross_minor      INTEGER,

  price_plan_id    TEXT REFERENCES price_plan (id),
  cost_plan_id     TEXT REFERENCES cost_plan (id),

  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  notes            TEXT
);

CREATE UNIQUE INDEX idx_period_merchant_month
  ON billing_period (merchant_id, year, month);
CREATE INDEX idx_period_state ON billing_period (state);

-- Rows ePay has that we do not, or vice versa. Every one must be resolved before the
-- period can be rated, so an under- or over-count can never reach an invoice.
CREATE TABLE period_discrepancy (
  id                 TEXT PRIMARY KEY,
  billing_period_id  TEXT NOT NULL REFERENCES billing_period (id),
  merchant_id        TEXT NOT NULL REFERENCES merchant (id),
  transaction_id     TEXT NOT NULL,
  -- missing_locally | missing_at_epay | amount_mismatch | state_mismatch
  kind               TEXT NOT NULL,
  detail             TEXT,
  resolved_at        TEXT,
  resolved_by        TEXT,
  resolution         TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX idx_discrepancy_period ON period_discrepancy (billing_period_id);
CREATE INDEX idx_discrepancy_open ON period_discrepancy (billing_period_id)
  WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

-- Invoice numbers must be gapless and sequential. A single counter row per series is
-- incremented atomically; numbers are only drawn at issue time, never at draft, so an
-- abandoned draft cannot leave a hole.
CREATE TABLE invoice_sequence (
  series      TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT INTO invoice_sequence (series, next_number, updated_at)
VALUES ('BETAL', 1, '2026-01-01T00:00:00Z');

CREATE TABLE invoice (
  id                TEXT PRIMARY KEY,
  merchant_id       TEXT NOT NULL REFERENCES merchant (id),
  billing_period_id TEXT REFERENCES billing_period (id),

  -- Null until issued, then immutable.
  number            TEXT UNIQUE,
  series            TEXT NOT NULL DEFAULT 'BETAL',
  -- invoice | credit_note
  kind              TEXT NOT NULL DEFAULT 'invoice',
  -- A credit note must reference what it credits.
  credits_invoice_id TEXT REFERENCES invoice (id),

  -- draft -> approved -> issued -> paid, plus overdue and credited
  state             TEXT NOT NULL DEFAULT 'draft',

  currency          TEXT NOT NULL DEFAULT 'DKK',
  net_minor         INTEGER NOT NULL DEFAULT 0,
  vat_minor         INTEGER NOT NULL DEFAULT 0,
  gross_minor       INTEGER NOT NULL DEFAULT 0,
  vat_rate_basis_points INTEGER NOT NULL DEFAULT 2500,

  -- Both parties' details are snapshotted at issue time, because an invoice must
  -- still render correctly years later even if the merchant has since moved.
  issuer_snapshot   TEXT,
  merchant_snapshot TEXT,

  issued_at         TEXT,
  due_at            TEXT,
  paid_at           TEXT,

  -- How this one is collected, and the ePay charge behind it when collected by card.
  collection_method TEXT NOT NULL DEFAULT 'manual',
  billing_charge_id TEXT,

  created_at        TEXT NOT NULL,
  created_by        TEXT,
  approved_at       TEXT,
  approved_by       TEXT
);

CREATE INDEX idx_invoice_merchant ON invoice (merchant_id, created_at DESC);
CREATE INDEX idx_invoice_state ON invoice (state);
CREATE UNIQUE INDEX idx_invoice_period_kind
  ON invoice (billing_period_id, kind)
  WHERE billing_period_id IS NOT NULL AND kind = 'invoice';

CREATE TABLE invoice_line (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoice (id),
  position       INTEGER NOT NULL,
  -- Which rule produced this line, so a figure can be traced to the plan behind it.
  price_plan_rule_id TEXT,
  kind           TEXT NOT NULL,
  description    TEXT NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1,
  unit_minor     INTEGER NOT NULL DEFAULT 0,
  amount_minor   INTEGER NOT NULL,
  -- Rate applied, when the rule was a percentage.
  basis_points   INTEGER
);

CREATE INDEX idx_invoice_line_invoice ON invoice_line (invoice_id, position);

-- The evidence behind a line. Storing only totals means a client asking "why is this
-- 1.247 kr?" cannot be answered, so the counted transaction ids are kept per line.
CREATE TABLE invoice_line_input (
  id              TEXT PRIMARY KEY,
  invoice_line_id TEXT NOT NULL REFERENCES invoice_line (id),
  transaction_id  TEXT NOT NULL,
  amount_minor    INTEGER
);

CREATE INDEX idx_line_input_line ON invoice_line_input (invoice_line_id);
CREATE INDEX idx_line_input_txn ON invoice_line_input (transaction_id);

-- ---------------------------------------------------------------------------
-- Identity. ePay has no user, role or permission API whatsoever, so all of this is
-- ours and none of it is mirrored.
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  -- staff (Betal) or merchant.
  kind          TEXT NOT NULL DEFAULT 'merchant',
  -- Null for staff; set for merchant users.
  merchant_id   TEXT REFERENCES merchant (id),
  -- owner | admin | operator | viewer. An operator may move money; a viewer may not.
  role          TEXT NOT NULL DEFAULT 'viewer',
  created_at    TEXT NOT NULL,
  last_login_at TEXT,
  disabled_at   TEXT
);

CREATE INDEX idx_user_merchant ON app_user (merchant_id);

-- Email magic links. Tokens are stored hashed so a database read cannot be replayed
-- into a login.
CREATE TABLE login_token (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_user (id),
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE session (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES app_user (id),
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  user_agent    TEXT,
  ip            TEXT
);

CREATE INDEX idx_session_user ON session (user_id);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

-- Append-only. The merchant access token from ePay is all-or-nothing — the same
-- credential that reads a list can issue a refund or a payout, with no read-only
-- variant available — so privilege separation lives entirely in our layer and every
-- money-moving action has to be attributable.
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  at_ms         INTEGER NOT NULL,
  actor_user_id TEXT,
  actor_email   TEXT,
  merchant_id   TEXT,
  -- refund | capture | void | issue_invoice | approve_invoice | freeze_period | ...
  action        TEXT NOT NULL,
  subject_type  TEXT,
  subject_id    TEXT,
  amount_minor  INTEGER,
  currency      TEXT,
  -- Whether the attempt succeeded. Failed attempts matter as much as successes.
  outcome       TEXT NOT NULL DEFAULT 'success',
  detail        TEXT,
  ip            TEXT
);

CREATE INDEX idx_audit_merchant_at ON audit_log (merchant_id, at_ms DESC);
CREATE INDEX idx_audit_subject ON audit_log (subject_type, subject_id);
CREATE INDEX idx_audit_actor ON audit_log (actor_user_id, at_ms DESC);
