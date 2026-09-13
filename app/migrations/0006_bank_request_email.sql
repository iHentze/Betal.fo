-- Transactional requests sent to a merchant's bank for stamped account confirmation.
-- The unique idempotency key mirrors Resend's 24-hour key and prevents duplicate audit
-- rows when a browser retries the same POST.

CREATE TABLE onboarding_bank_email (
  idempotency_key  TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES onboarding_application (id) ON DELETE CASCADE,
  bank_email       TEXT NOT NULL,
  cc_email         TEXT NOT NULL,
  provider         TEXT NOT NULL DEFAULT 'resend',
  provider_id      TEXT NOT NULL,
  sent_by          TEXT,
  sent_at_ms       INTEGER NOT NULL
);

CREATE INDEX idx_onboarding_bank_email_app
  ON onboarding_bank_email (application_id, sent_at_ms DESC);
