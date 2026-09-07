-- Merchant onboarding and Betal's internal operations.

-- ---------------------------------------------------------------------------
-- Onboarding
-- ---------------------------------------------------------------------------

-- Provisioning is a sequence of steps against ePay, and it must be resumable rather
-- than all-or-nothing. `POST /partner/accounts` documents no idempotency support, so a
-- retried run that started over would create a duplicate merchant account with no way
-- to tell which is which. Each completed step is therefore recorded before the next
-- begins, and a resumed run skips what already succeeded.
CREATE TABLE onboarding_step (
  id            TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL REFERENCES merchant (id),
  -- epay_account | point_of_sale | webhook | price_plan | acquiring | test_payment
  step          TEXT NOT NULL,
  -- pending | running | done | failed | manual
  state         TEXT NOT NULL DEFAULT 'pending',
  -- Whatever the step produced: an ePay id, a point-of-sale id, and so on.
  result        TEXT,
  error         TEXT,
  started_at_ms INTEGER,
  done_at_ms    INTEGER,
  attempts      INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_onboarding_step ON onboarding_step (merchant_id, step);
CREATE INDEX idx_onboarding_state ON onboarding_step (state);

-- ---------------------------------------------------------------------------
-- Sales pipeline
-- ---------------------------------------------------------------------------

-- Fed by the contact form on betal.fo, which currently just sends an email and
-- therefore loses everything the moment someone forgets to reply.
CREATE TABLE lead (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  company      TEXT,
  email        TEXT NOT NULL,
  phone        TEXT,
  -- Which of the four products they asked about: alnetinum, stadnum, hald, lon.
  product      TEXT,
  message      TEXT,
  -- new | contacted | qualified | won | lost
  state        TEXT NOT NULL DEFAULT 'new',
  lost_reason  TEXT,
  owner_email  TEXT,
  -- Set once the lead becomes a merchant, so the pipeline links to the live account.
  merchant_id  TEXT REFERENCES merchant (id),
  source       TEXT NOT NULL DEFAULT 'betal.fo',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX idx_lead_state ON lead (state, created_at_ms DESC);

-- ---------------------------------------------------------------------------
-- Contracts and acquiring applications
-- ---------------------------------------------------------------------------

-- Acquiring onboarding has no ePay API at all — EasyOnboard is a portal flow, and a
-- white-labelled version is available only by agreement. So the application itself
-- happens elsewhere and this tracks its state, which is the difference between a
-- merchant being chased and a merchant being forgotten.
CREATE TABLE acquiring_application (
  id            TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL REFERENCES merchant (id),
  acquirer      TEXT NOT NULL,
  -- not_started | collecting | submitted | approved | rejected
  state         TEXT NOT NULL DEFAULT 'not_started',
  external_ref  TEXT,
  submitted_at  TEXT,
  decided_at    TEXT,
  notes         TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX idx_acquiring_merchant ON acquiring_application (merchant_id);
CREATE INDEX idx_acquiring_state ON acquiring_application (state);

CREATE TABLE contract (
  id            TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL REFERENCES merchant (id),
  kind          TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'draft',
  price_plan_id TEXT REFERENCES price_plan (id),
  signed_at     TEXT,
  signed_by     TEXT,
  document_url  TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX idx_contract_merchant ON contract (merchant_id);

-- ---------------------------------------------------------------------------
-- Support
-- ---------------------------------------------------------------------------

-- Tickets link to a merchant and optionally a transaction, because most support
-- questions are about one specific payment and answering them means having it to hand.
CREATE TABLE ticket (
  id             TEXT PRIMARY KEY,
  merchant_id    TEXT REFERENCES merchant (id),
  transaction_id TEXT,
  subject        TEXT NOT NULL,
  -- open | waiting | resolved
  state          TEXT NOT NULL DEFAULT 'open',
  priority       TEXT NOT NULL DEFAULT 'normal',
  opened_by      TEXT,
  assigned_to    TEXT,
  created_at_ms  INTEGER NOT NULL,
  updated_at_ms  INTEGER NOT NULL,
  resolved_at_ms INTEGER
);

CREATE INDEX idx_ticket_state ON ticket (state, updated_at_ms DESC);
CREATE INDEX idx_ticket_merchant ON ticket (merchant_id);

CREATE TABLE ticket_message (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES ticket (id),
  author      TEXT NOT NULL,
  -- Whether the merchant can see this, so staff can keep working notes on the ticket.
  internal    INTEGER NOT NULL DEFAULT 0,
  body        TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX idx_ticket_message ON ticket_message (ticket_id, created_at_ms);
