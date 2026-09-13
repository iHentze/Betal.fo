-- Production-grade native onboarding policy, immutable snapshots and R2 metadata.

CREATE TABLE onboarding_policy (
  id                         TEXT PRIMARY KEY,
  version                    INTEGER NOT NULL,
  acquirer                   TEXT NOT NULL,
  country_code               TEXT NOT NULL DEFAULT 'FO',
  source_name                TEXT NOT NULL,
  source_sha256              TEXT NOT NULL,
  prohibited_source_sha256   TEXT,
  requirements_json          TEXT NOT NULL,
  active                     INTEGER NOT NULL DEFAULT 0,
  approved_by                TEXT,
  approved_at_ms             INTEGER,
  created_at_ms              INTEGER NOT NULL,
  UNIQUE (acquirer, country_code, version)
);

CREATE UNIQUE INDEX idx_onboarding_policy_active
  ON onboarding_policy (acquirer, country_code)
  WHERE active = 1;

CREATE TABLE onboarding_sector_rule (
  policy_id             TEXT NOT NULL REFERENCES onboarding_policy (id) ON DELETE CASCADE,
  key                   TEXT NOT NULL,
  sector                INTEGER NOT NULL,
  source_label          TEXT NOT NULL,
  scheme_fee_possible   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (policy_id, key)
);

CREATE INDEX idx_onboarding_sector_rule_sector
  ON onboarding_sector_rule (policy_id, sector);

CREATE TABLE onboarding_answer (
  application_id   TEXT NOT NULL REFERENCES onboarding_application (id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  value_json       TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'merchant',
  confirmed_at_ms  INTEGER,
  updated_at_ms    INTEGER NOT NULL,
  PRIMARY KEY (application_id, key)
);

CREATE INDEX idx_onboarding_answer_app
  ON onboarding_answer (application_id, key);

CREATE TABLE document_template (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  version           INTEGER NOT NULL,
  country_code      TEXT NOT NULL DEFAULT 'FO',
  source_file_name  TEXT NOT NULL,
  source_sha256     TEXT NOT NULL UNIQUE,
  r2_key            TEXT NOT NULL UNIQUE,
  field_map_json    TEXT NOT NULL,
  active            INTEGER NOT NULL DEFAULT 0,
  effective_from    TEXT,
  created_at_ms     INTEGER NOT NULL,
  created_by        TEXT,
  UNIQUE (kind, country_code, version)
);

CREATE UNIQUE INDEX idx_document_template_active
  ON document_template (kind, country_code)
  WHERE active = 1;

CREATE TABLE onboarding_submission_snapshot (
  id                     TEXT PRIMARY KEY,
  application_id         TEXT NOT NULL REFERENCES onboarding_application (id) ON DELETE CASCADE,
  policy_id              TEXT NOT NULL REFERENCES onboarding_policy (id),
  price_list_id          TEXT REFERENCES acquiring_price_list (id),
  agreement_template_id  TEXT NOT NULL REFERENCES document_template (id),
  signer_set_json        TEXT NOT NULL,
  payload_json           TEXT NOT NULL,
  sha256                 TEXT NOT NULL,
  state                  TEXT NOT NULL DEFAULT 'draft',
  locked_by              TEXT,
  created_at_ms          INTEGER NOT NULL,
  finalized_at_ms        INTEGER
);

CREATE INDEX idx_submission_snapshot_app
  ON onboarding_submission_snapshot (application_id, created_at_ms DESC);

CREATE UNIQUE INDEX idx_submission_snapshot_final
  ON onboarding_submission_snapshot (application_id)
  WHERE state = 'final';

CREATE TABLE document_instance (
  id                TEXT PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES onboarding_application (id) ON DELETE CASCADE,
  template_id       TEXT REFERENCES document_template (id),
  snapshot_id       TEXT REFERENCES onboarding_submission_snapshot (id),
  kind              TEXT NOT NULL,
  state             TEXT NOT NULL,
  r2_key            TEXT NOT NULL UNIQUE,
  sha256            TEXT NOT NULL,
  byte_size         INTEGER NOT NULL,
  generated_at_ms   INTEGER NOT NULL,
  signed_at_ms      INTEGER,
  created_by        TEXT
);

CREATE INDEX idx_document_instance_app
  ON document_instance (application_id, kind, generated_at_ms DESC);

CREATE TABLE email_delivery_event (
  provider_event_id        TEXT PRIMARY KEY,
  bank_email_idempotency   TEXT NOT NULL REFERENCES onboarding_bank_email (idempotency_key) ON DELETE CASCADE,
  type                     TEXT NOT NULL,
  received_at_ms           INTEGER NOT NULL
);

ALTER TABLE onboarding_application ADD COLUMN policy_id TEXT REFERENCES onboarding_policy (id);
ALTER TABLE onboarding_application ADD COLUMN final_snapshot_id TEXT REFERENCES onboarding_submission_snapshot (id);
ALTER TABLE onboarding_application ADD COLUMN locked_at_ms INTEGER;

ALTER TABLE onboarding_document ADD COLUMN storage TEXT NOT NULL DEFAULT 'd1';
ALTER TABLE onboarding_document ADD COLUMN r2_key TEXT;
ALTER TABLE onboarding_document ADD COLUMN sha256 TEXT;
ALTER TABLE onboarding_document ADD COLUMN scan_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE onboarding_document ADD COLUMN quarantined_at_ms INTEGER;

CREATE UNIQUE INDEX idx_onboarding_document_r2_key
  ON onboarding_document (r2_key)
  WHERE r2_key IS NOT NULL;

ALTER TABLE onboarding_signing ADD COLUMN owner_id TEXT REFERENCES onboarding_owner (id);
ALTER TABLE onboarding_signing ADD COLUMN signing_person_id INTEGER;
ALTER TABLE onboarding_signing ADD COLUMN document_instance_id TEXT REFERENCES document_instance (id);
ALTER TABLE onboarding_signing ADD COLUMN provider_status_json TEXT;
ALTER TABLE onboarding_signing ADD COLUMN expires_at_ms INTEGER;

CREATE INDEX idx_onboarding_signing_owner
  ON onboarding_signing (application_id, owner_id, created_at_ms DESC);

ALTER TABLE onboarding_bank_email ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted';
ALTER TABLE onboarding_bank_email ADD COLUMN delivered_at_ms INTEGER;
ALTER TABLE onboarding_bank_email ADD COLUMN failed_at_ms INTEGER;
ALTER TABLE onboarding_bank_email ADD COLUMN failure_reason TEXT;

INSERT INTO document_template (
  id, kind, version, country_code, source_file_name, source_sha256,
  r2_key, field_map_json, active, effective_from, created_at_ms, created_by
) VALUES
  (
    'swedbank-online-fo-12465631-v1',
    'agreement',
    1,
    'FO',
    'Kortindlosning-Online-FO.pdf',
    '06cfdbdb6d7d2ea023cc811d1e5b919d2686a02305f62a584e2f9a01c567fc60',
    'templates/swedbank/Kortindlosning-Online-FO.pdf',
    '{"map":"swedbank-online-fo-v1","acroform":true,"flatten":true}',
    1,
    '2025-12-08',
    1765186860000,
    'nicolai.christiansen@swedbankpay.com'
  ),
  (
    'swedbank-bank-confirmation-v1',
    'bank_confirmation',
    1,
    'FO',
    'Swedbank Pay - Bekræftelse af konto.pdf',
    '6839e5e6d403f3792adc14b101b85e314bc8fe8e6985acc1fedfa238c2caf6c1',
    'templates/swedbank/Swedbank Pay - Bekræftelse af konto.pdf',
    '{"map":"swedbank-bank-confirmation-v1","acroform":true,"flatten":true}',
    1,
    '2025-12-08',
    1765186860000,
    'nicolai.christiansen@swedbankpay.com'
  ),
  (
    'swedbank-prohibited-lines-v1',
    'prohibited_business',
    1,
    'FO',
    'Prohibited lines of business.pdf',
    '5aee60f343b8f7322009d9ca0ec9a5f5a26c1b28770277a9ea75b8a7c83a3e22',
    'templates/swedbank/Prohibited lines of business.pdf',
    '{"map":null,"acroform":false}',
    1,
    '2025-12-08',
    1765186860000,
    'nicolai.christiansen@swedbankpay.com'
  );

-- Policy source: Nicolai Christiansen / Swedbank Pay, forwarded by Robin Lyckegaard.
-- Numeric FO rates deliberately remain outside this migration until commercially approved.
INSERT INTO onboarding_policy (
  id, version, acquirer, country_code, source_name, source_sha256,
  prohibited_source_sha256, requirements_json, active, approved_by,
  approved_at_ms, created_at_ms
) VALUES (
  'swedbank-fo-2025-12-08',
  1,
  'swedbank',
  'FO',
  'Onboarding - Færøerne, 2025-12-08',
  '06cfdbdb6d7d2ea023cc811d1e5b919d2686a02305f62a584e2f9a01c567fc60',
  '5aee60f343b8f7322009d9ca0ec9a5f5a26c1b28770277a9ea75b8a7c83a3e22',
  '{"always":["company","activity","owners","finance","bank_confirmation","company_registration","owners_book","signed_agreement"],"conditional":{"annual_accounts":"sector2_or_unknown_finance","industry_answers":"sector2"},"country":"FO","all_selected_signatories":true}',
  1,
  'nicolai.christiansen@swedbankpay.com',
  1765186860000,
  1765186860000
);

INSERT INTO onboarding_sector_rule
  (policy_id, key, sector, source_label, scheme_fee_possible)
VALUES
  ('swedbank-fo-2025-12-08', 'money-services', 1, 'Money transfer, currency exchange, money service bureaus', 0),
  ('swedbank-fo-2025-12-08', 'crypto', 1, 'Financial instruments, e-money, crypto and virtual currencies', 0),
  ('swedbank-fo-2025-12-08', 'nft', 1, 'Non-fungible tokens', 0),
  ('swedbank-fo-2025-12-08', 'adult', 1, 'Adult entertainment, pornography, prostitution and escort services', 0),
  ('swedbank-fo-2025-12-08', 'mlm', 1, 'Pyramid sales and multilevel marketing', 0),
  ('swedbank-fo-2025-12-08', 'illegal-goods', 1, 'Illegal drugs, weapons, counterfeit goods or counterfeiting equipment', 0),
  ('swedbank-fo-2025-12-08', 'unsecured-package-travel', 1, 'Package tours without required collateral', 0),
  ('swedbank-fo-2025-12-08', 'unregulated-charity', 1, 'Charity and donations without equivalent supervision', 0),
  ('swedbank-fo-2025-12-08', 'crowdfunding', 1, 'Crowdfunding', 0),
  ('swedbank-fo-2025-12-08', 'social-platform-sales', 1, 'Sales on Facebook and similar platforms', 0),
  ('swedbank-fo-2025-12-08', 'anonymity-services', 1, 'Proxy servers, VPN and other anonymity services', 0),
  ('swedbank-fo-2025-12-08', 'illegal-wildlife', 1, 'Illegal wildlife', 0),
  ('swedbank-fo-2025-12-08', 'travel', 2, 'Travel agencies, tour operators and airlines', 0),
  ('swedbank-fo-2025-12-08', 'cloud-hosting', 2, 'Cloud services, digital file hosting and cyber lockers', 1),
  ('swedbank-fo-2025-12-08', 'deals', 2, 'Consumer discount and deal services', 0),
  ('swedbank-fo-2025-12-08', 'event-tickets', 2, 'Event tickets', 0),
  ('swedbank-fo-2025-12-08', 'gift-prepaid-cards', 2, 'Gift cards and prepaid cards', 0),
  ('swedbank-fo-2025-12-08', 'organisations', 2, 'Political, religious and other organisations', 0),
  ('swedbank-fo-2025-12-08', 'financial-services', 2, 'Financial services', 0),
  ('swedbank-fo-2025-12-08', 'restricted-trade', 2, 'Services subject to export or import restrictions', 0),
  ('swedbank-fo-2025-12-08', 'sport-weapons', 2, 'Weapons for recreational or sport purposes', 0),
  ('swedbank-fo-2025-12-08', 'real-estate-rental', 2, 'Real estate rental and time sharing', 0),
  ('swedbank-fo-2025-12-08', 'medical', 2, 'Health preparations, medicines and medical sector', 1),
  ('swedbank-fo-2025-12-08', 'medical-devices', 2, 'Medical devices', 0),
  ('swedbank-fo-2025-12-08', 'descramblers', 2, 'Satellite and cable television descramblers', 0),
  ('swedbank-fo-2025-12-08', 'car-rental', 2, 'Car rental', 0),
  ('swedbank-fo-2025-12-08', 'online-alcohol', 2, 'Online export or import of alcohol and wine', 0),
  ('swedbank-fo-2025-12-08', 'capital-goods', 2, 'Capital goods', 0),
  ('swedbank-fo-2025-12-08', 'hotel', 2, 'Hotels', 0),
  ('swedbank-fo-2025-12-08', 'pawn-antiques', 2, 'Pawn and antique shops', 0),
  ('swedbank-fo-2025-12-08', 'furniture', 2, 'Furniture', 0),
  ('swedbank-fo-2025-12-08', 'online-tobacco', 2, 'Online tobacco, cigarettes, e-cigarettes and snuff', 1),
  ('swedbank-fo-2025-12-08', 'digital-wallets', 2, 'Digital and electronic wallets', 1),
  ('swedbank-fo-2025-12-08', 'online-gambling', 2, 'Online gambling', 1),
  ('swedbank-fo-2025-12-08', 'online-gaming', 2, 'Gaming and online gaming', 1),
  ('swedbank-fo-2025-12-08', 'online-lotteries', 2, 'Online lotteries', 1),
  ('swedbank-fo-2025-12-08', 'digital-goods', 2, 'Digital goods delivered and used electronically', 1),
  ('swedbank-fo-2025-12-08', 'dating-chat', 2, 'Chat, contact and dating sites', 1);
