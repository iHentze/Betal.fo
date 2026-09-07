-- Mirror of ePay data.
--
-- ePay's index endpoints allow one request per five seconds, so no list view may be
-- served by proxying ePay. Everything here is our own copy, fed by webhooks and
-- reconciled against the API.
--
-- Unit conventions, which differ between ePay resources and must not be mixed:
--   * transaction and operation amounts are INTEGER minor units (1095 = 10,95 DKK)
--   * settlement amounts are TEXT decimal strings ("99.01") and are never stored as
--     REAL, because binary floating point cannot represent them exactly
--   * timestamps are TEXT ISO-8601 as returned by ePay, with an INTEGER epoch-millis
--     companion column wherever we sort or range-scan

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE merchant (
  id                TEXT PRIMARY KEY,
  epay_account_id   TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  -- "test" or "live". Which ePay environment this merchant transacts in.
  environment       TEXT NOT NULL DEFAULT 'test',
  -- ePay publishes no enum for account status, so this is stored as an opaque string.
  epay_status       TEXT,
  -- Our own lifecycle, which we do control.
  status            TEXT NOT NULL DEFAULT 'onboarding',
  currency          TEXT NOT NULL DEFAULT 'DKK',
  timezone          TEXT NOT NULL DEFAULT 'Atlantic/Faroe',
  domain            TEXT,
  created_at        TEXT NOT NULL,
  created_at_ms     INTEGER NOT NULL,
  archived_at       TEXT
);

CREATE INDEX idx_merchant_status ON merchant (status);

CREATE TABLE point_of_sale (
  id                       TEXT PRIMARY KEY,
  merchant_id              TEXT NOT NULL REFERENCES merchant (id),
  name                     TEXT NOT NULL,
  -- What the cardholder sees on their statement. Read-only via the ePay API.
  descriptor               TEXT,
  domain                   TEXT,
  -- The per-merchant webhook secret. Write-once at ePay, so we keep our own copy to
  -- verify inbound deliveries. Never rendered to a client.
  webhook_secret           TEXT,
  hosted_configuration     TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT
);

CREATE INDEX idx_pos_merchant ON point_of_sale (merchant_id);

CREATE TABLE terminal (
  id                 TEXT PRIMARY KEY,
  merchant_id        TEXT NOT NULL REFERENCES merchant (id),
  point_of_sale_id   TEXT REFERENCES point_of_sale (id),
  device_id          TEXT,
  external_id        TEXT,
  description        TEXT,
  -- ePay exposes no terminal status or last-seen, so liveness is derived from the
  -- most recent transaction we saw routed through it.
  last_seen_at_ms    INTEGER,
  created_at         TEXT NOT NULL
);

CREATE INDEX idx_terminal_merchant ON terminal (merchant_id);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

CREATE TABLE txn (
  id                          TEXT PRIMARY KEY,
  merchant_id                 TEXT NOT NULL REFERENCES merchant (id),
  point_of_sale_id            TEXT,
  session_id                  TEXT,
  subscription_id             TEXT,
  billing_agreement_charge_id TEXT,

  state                       TEXT NOT NULL,
  type                        TEXT NOT NULL,
  error_code                  TEXT,

  amount                      INTEGER NOT NULL,
  -- ePay's cardholder surcharge, already included in amount. This is NOT Betal
  -- revenue and NOT an acquirer cost; see docs/epay.md.
  surcharge                   INTEGER NOT NULL DEFAULT 0,
  currency                    TEXT NOT NULL,

  payment_method_id           TEXT,
  payment_method_type         TEXT,
  payment_method_sub_type     TEXT,
  payment_method_display      TEXT,
  payment_method_expiry       TEXT,

  sca_mode                    TEXT,
  instant_capture             TEXT,
  customer_id                 TEXT,
  reference                   TEXT,
  text_on_statement           TEXT,
  exemptions                  TEXT,
  attributes                  TEXT,
  client_ip                   TEXT,
  client_country              TEXT,

  -- Acquirer attribution, used for the acquirer-comparison report.
  acquirer                    TEXT,
  mcc                         TEXT,

  -- Aggregates. Absent from the list endpoint, so these are populated from webhooks
  -- and from single-transaction fetches, and may lag until reconciliation.
  amount_authorized           INTEGER,
  amount_captured             INTEGER,
  amount_refunded             INTEGER,
  amount_voided               INTEGER,
  amount_remaining            INTEGER,
  amount_paid_out             INTEGER,

  -- Card and SCA detail arrive ONLY on the webhook and are returned by no GET
  -- endpoint. Captured on first receipt or lost permanently.
  card_masked_pan             TEXT,
  card_expire_month           TEXT,
  card_expire_year            TEXT,
  -- Primary Account Reference: stable across wallets for the same underlying card.
  card_par                    TEXT,
  card_issuer                 TEXT,
  card_scheme                 TEXT,
  card_country                TEXT,
  card_segment                TEXT,
  card_funding                TEXT,
  sca_rejected                INTEGER,
  sca_type                    TEXT,
  sca_verification            TEXT,

  created_at                  TEXT NOT NULL,
  created_at_ms               INTEGER NOT NULL,
  -- When our mirror last changed this row, for staleness checks.
  synced_at_ms                INTEGER NOT NULL,
  -- Set by reconciliation when this row came from a backfill rather than a webhook.
  source                      TEXT NOT NULL DEFAULT 'webhook'
);

-- The workhorse index: every list view and every close is scoped by merchant and
-- ordered by time.
CREATE INDEX idx_txn_merchant_created ON txn (merchant_id, created_at_ms DESC);
CREATE INDEX idx_txn_merchant_state ON txn (merchant_id, state, created_at_ms DESC);
CREATE INDEX idx_txn_reference ON txn (merchant_id, reference);
CREATE INDEX idx_txn_pos ON txn (point_of_sale_id, created_at_ms DESC);
CREATE INDEX idx_txn_subscription ON txn (subscription_id);

CREATE TABLE operation (
  id                    TEXT PRIMARY KEY,
  transaction_id        TEXT NOT NULL,
  merchant_id           TEXT NOT NULL REFERENCES merchant (id),
  -- A REFUND references the CAPTURE it reverses, which is what lets the activity
  -- timeline be a tree rather than a flat log.
  reference_operation_id TEXT,
  type                  TEXT NOT NULL,
  state                 TEXT NOT NULL,
  amount                INTEGER NOT NULL,
  error_code            TEXT,
  created_at            TEXT NOT NULL,
  created_at_ms         INTEGER NOT NULL,
  finalized_at          TEXT,
  finalized_at_ms       INTEGER
);

CREATE INDEX idx_operation_txn ON operation (transaction_id, created_at_ms);
CREATE INDEX idx_operation_merchant_finalized
  ON operation (merchant_id, finalized_at_ms DESC);

-- ---------------------------------------------------------------------------
-- Settlements. All amounts are decimal strings.
-- ---------------------------------------------------------------------------

CREATE TABLE settlement_transfer (
  id                   TEXT PRIMARY KEY,
  merchant_id          TEXT NOT NULL REFERENCES merchant (id),
  acquirer             TEXT,
  settlement_name      TEXT,
  -- JSON array of acquirer MIDs included in the report.
  settlement_ids       TEXT,
  posting_date         TEXT,
  -- Decimal string, net of adjustments and fees.
  net_amount           TEXT NOT NULL,
  currency             TEXT NOT NULL,
  acquirer_reference   TEXT,
  created_at           TEXT NOT NULL,
  created_at_ms        INTEGER NOT NULL,
  -- Whether we have finished pulling this transfer's per-transaction rows.
  transactions_synced  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_transfer_merchant_posting
  ON settlement_transfer (merchant_id, posting_date DESC);

CREATE TABLE settlement_transaction (
  id                      TEXT PRIMARY KEY,
  settlement_transfer_id  TEXT NOT NULL REFERENCES settlement_transfer (id),
  merchant_id             TEXT NOT NULL REFERENCES merchant (id),
  -- Null when the acquirer row cannot be linked to an ePay transaction. One ePay
  -- transaction may map to several rows here when partial captures or refunds exist.
  transaction_id          TEXT,
  agreement_id            TEXT,
  merchant_reference      TEXT,
  acquirer_reference      TEXT,
  posting_date            TEXT,
  net_amount              TEXT NOT NULL,
  currency                TEXT NOT NULL,
  created_at              TEXT NOT NULL
);

CREATE INDEX idx_settlement_txn_transfer
  ON settlement_transaction (settlement_transfer_id);
CREATE INDEX idx_settlement_txn_transaction
  ON settlement_transaction (transaction_id);

-- Adjustments hang off either a transfer or a settlement transaction. Transfer-level
-- types are RESERVE, ADJUSTMENT and FEE; transaction-level are ACQUIRER_FEE,
-- INTERCHANGE_FEE and SCHEME_FEE. The latter three are the acquirer's cost to the
-- merchant and are explicitly not charged by ePay.
CREATE TABLE settlement_adjustment (
  id                        TEXT PRIMARY KEY,
  merchant_id               TEXT NOT NULL REFERENCES merchant (id),
  settlement_transfer_id    TEXT REFERENCES settlement_transfer (id),
  settlement_transaction_id TEXT REFERENCES settlement_transaction (id),
  scope                     TEXT NOT NULL,
  type                      TEXT NOT NULL,
  -- Decimal string, negative for fees.
  amount                    TEXT NOT NULL,
  description               TEXT
);

CREATE INDEX idx_adjustment_transfer
  ON settlement_adjustment (settlement_transfer_id);
CREATE INDEX idx_adjustment_transaction
  ON settlement_adjustment (settlement_transaction_id);
CREATE INDEX idx_adjustment_merchant_type
  ON settlement_adjustment (merchant_id, type);

-- ---------------------------------------------------------------------------
-- Webhook plumbing
-- ---------------------------------------------------------------------------

CREATE TABLE webhook_endpoint (
  id             TEXT PRIMARY KEY,
  merchant_id    TEXT NOT NULL REFERENCES merchant (id),
  epay_webhook_id TEXT,
  url            TEXT NOT NULL,
  events         TEXT NOT NULL,
  -- ePay pauses an endpoint failing more than 50% of the time over a week. A paused
  -- webhook silently stops the merchant's data flow, so this is surfaced in the UI.
  paused_at      TEXT,
  pause_reason   TEXT,
  last_checked_ms INTEGER,
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_webhook_merchant ON webhook_endpoint (merchant_id);
CREATE INDEX idx_webhook_paused ON webhook_endpoint (paused_at)
  WHERE paused_at IS NOT NULL;

-- Raw inbox. Every accepted delivery is written here before processing, so a failed
-- projection can be replayed without asking ePay to redeliver, and so duplicate
-- deliveries (ePay retries up to 25 times) are cheap to detect.
CREATE TABLE webhook_delivery (
  id             TEXT PRIMARY KEY,
  merchant_id    TEXT REFERENCES merchant (id),
  -- Hash of the payload, used to collapse retries of the same delivery.
  fingerprint    TEXT NOT NULL,
  event          TEXT,
  channel        TEXT NOT NULL,
  payload        TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  processed_at_ms INTEGER,
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT
);

CREATE UNIQUE INDEX idx_delivery_fingerprint ON webhook_delivery (fingerprint);
CREATE INDEX idx_delivery_unprocessed ON webhook_delivery (received_at_ms)
  WHERE processed_at_ms IS NULL;

-- ---------------------------------------------------------------------------
-- Sync bookkeeping
-- ---------------------------------------------------------------------------

-- Resumable cursors for backfill and reconciliation runs. ePay's transaction list is
-- cursor-paginated, so an interrupted walk continues from the stored offset rather
-- than restarting and burning the rate-limit budget.
CREATE TABLE sync_cursor (
  id             TEXT PRIMARY KEY,
  merchant_id    TEXT NOT NULL REFERENCES merchant (id),
  kind           TEXT NOT NULL,
  -- Opaque ePay cursor, resumed verbatim.
  cursor         TEXT,
  window_start   TEXT,
  window_end     TEXT,
  state          TEXT NOT NULL DEFAULT 'running',
  items_seen     INTEGER NOT NULL DEFAULT 0,
  started_at_ms  INTEGER NOT NULL,
  updated_at_ms  INTEGER NOT NULL,
  error          TEXT
);

CREATE INDEX idx_cursor_merchant_kind ON sync_cursor (merchant_id, kind, state);
