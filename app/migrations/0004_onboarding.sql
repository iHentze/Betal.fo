-- Swedbank / Skriva onboarding pack.
--
-- Separate from ePay provisioning (`onboarding_step`) and from the acquirer-facing
-- `acquiring_application`. This is how we *get* to a pack we can submit.

CREATE TABLE onboarding_application (
  id                     TEXT PRIMARY KEY,
  merchant_id            TEXT NOT NULL UNIQUE REFERENCES merchant (id),
  lead_id                TEXT REFERENCES lead (id),
  -- draft | screening | collecting | signing | pack_ready
  -- | submitted | approved | rejected | routed
  state                  TEXT NOT NULL DEFAULT 'draft',
  recommended_acquirer   TEXT,
  chosen_acquirer        TEXT,
  country_code           TEXT NOT NULL DEFAULT 'FO',
  legal_name             TEXT,
  v_tal                  TEXT,
  address_line_one       TEXT,
  address_line_two       TEXT,
  postal_code            TEXT,
  city                   TEXT,
  website                TEXT,
  sells                  TEXT,
  vertical_key           TEXT,
  vertical_sector        INTEGER,
  -- positive | negative | unknown
  equity                 TEXT,
  operations             TEXT,
  bank_account           TEXT,
  screening_reason       TEXT,
  screening_at_ms        INTEGER,
  screening_by           TEXT,
  extra_docs_required    INTEGER NOT NULL DEFAULT 0,
  reject_reason          TEXT,
  request_note           TEXT,
  created_at_ms          INTEGER NOT NULL,
  updated_at_ms          INTEGER NOT NULL
);

CREATE INDEX idx_onboarding_app_state ON onboarding_application (state, updated_at_ms DESC);

CREATE TABLE onboarding_owner (
  id              TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES onboarding_application (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT,
  p_tal           TEXT,
  role            TEXT,
  ownership_bps   INTEGER,
  is_signatory    INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_onboarding_owner_app ON onboarding_owner (application_id, sort_order);

CREATE TABLE onboarding_document (
  id              TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES onboarding_application (id) ON DELETE CASCADE,
  -- agreement | photo_id | company_registration | owners_book
  -- | bank_confirmation | annual_accounts | industry_answers
  kind            TEXT NOT NULL,
  required        INTEGER NOT NULL DEFAULT 1,
  file_name       TEXT,
  content_type    TEXT,
  byte_size       INTEGER,
  bytes           BLOB,
  uploaded_by     TEXT,
  uploaded_at_ms  INTEGER,
  UNIQUE (application_id, kind)
);

CREATE INDEX idx_onboarding_doc_app ON onboarding_document (application_id);

CREATE TABLE onboarding_signing (
  id                   TEXT PRIMARY KEY,
  application_id       TEXT NOT NULL REFERENCES onboarding_application (id) ON DELETE CASCADE,
  provider             TEXT NOT NULL DEFAULT 'skriva',
  environment          TEXT,
  signing_request_id   TEXT,
  signer_token         TEXT,
  signing_url          TEXT,
  p_tal                TEXT,
  -- blocked | sent | viewed | signed | expired | failed | wet_ink
  status               TEXT NOT NULL DEFAULT 'blocked',
  last_polled_at_ms    INTEGER,
  created_at_ms        INTEGER NOT NULL
);

CREATE INDEX idx_onboarding_signing_app ON onboarding_signing (application_id);

CREATE TABLE onboarding_event (
  id              TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES onboarding_application (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  actor_email     TEXT,
  payload         TEXT,
  at_ms           INTEGER NOT NULL
);

CREATE INDEX idx_onboarding_event_app ON onboarding_event (application_id, at_ms);

-- Versioned FO price lists. Empty `rates_json` means we do not send to Skriva.
CREATE TABLE acquiring_price_list (
  id              TEXT PRIMARY KEY,
  -- standard | sector2
  kind            TEXT NOT NULL,
  version         INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'DKK',
  country_code    TEXT NOT NULL DEFAULT 'FO',
  -- JSON array of {label, rate_bps} or empty [].
  rates_json      TEXT NOT NULL DEFAULT '[]',
  effective_from  TEXT,
  created_at_ms   INTEGER NOT NULL,
  UNIQUE (kind, version)
);
