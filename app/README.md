# Betal platform

One backend with two faces on a shared spine.

The **client face** is a Faroese-first portal deep enough that a merchant never needs
ePay's own dashboard. The **internal face** is how Betal runs: merchant lifecycle,
monthly transaction counting, rating, invoicing, margin, support and terminals.

Both sit on a mirrored copy of ePay data, fed by webhooks and reconciled against
ePay's API.

## Why it is shaped this way

Three ePay constraints dictate the architecture. All three are documented in
[`../docs/epay.md`](../docs/epay.md).

1. **Index endpoints allow one request per five seconds.** No list view can proxy
   ePay, so everything is served from our own mirror.
2. **Card and 3DS data arrive only on the webhook.** No GET returns them, so they are
   captured at ingest or lost permanently.
3. **Webhooks are not signed.** Verification is a bare `Authorization` header, so each
   merchant gets its own secret and comparison is constant time.

A fourth shapes the money loop: ePay exposes no partner billing or commission data at
all, so every invoice is computed from our own data and the accuracy is entirely ours.

## Layout

```
migrations/         D1 schema: 0001 mirror, 0002 business, 0003 operations
src/lib/epay/       Typed ePay client: partner + merchant, token cache, rate limiting
src/lib/ingest/     Webhook verification and projection into the mirror
src/lib/billing/    Close, rating, invoicing, margin, collection
src/lib/db/         Read-model queries (keyset paginated)
src/lib/money.ts    Every amount conversion and format, in one place
src/lib/status.ts   Semantic status tokens for every payment state
src/pages/          Portal (Faroese) and API routes
workers/ingest/     Queue consumer and scheduled drain, deployed separately
test/               230 tests, run against real SQLite via node:sqlite
```

## Develop

```bash
npm install
npm run db:migrate:local
npm run seed          # a month of realistic Faroese trade
npm run dev           # http://localhost:4321
```

The seed prints two session tokens. Sign in by setting a cookie in the browser
console — email delivery is not wired up yet, so this stands in for the magic link:

```js
document.cookie = 'betal_session=dev-merchant-session-token; path=/'  // merchant
document.cookie = 'betal_session=dev-staff-session-token; path=/'     // Betal staff
```

The seeded month is **August 2026**, so screens that default to "the month just
closed" need `?ar=2026&man=8` if the system clock is not September 2026.

Tests run the real migrations against an in-memory SQLite database, so the SQL is
genuinely exercised rather than mocked:

```bash
npm test
```

## Deploy

Two Workers share one D1 database. Ingest is deployed separately so webhook projection
is not affected by app traffic or a bad UI deploy.

```bash
npm run build && npx wrangler deploy
cd workers/ingest && npx wrangler deploy
```

Before the first deploy, create the resources and fill the placeholder ids in both
`wrangler.jsonc` files:

```bash
npx wrangler d1 create betal
npx wrangler kv namespace create TOKENS
npx wrangler queues create betal-ingest
npx wrangler queues create betal-ingest-dlq
npx wrangler secret put EPAY_PARTNER_KEY
```

## Things worth knowing before changing this

- **Amounts have two representations.** Transactions are integer minor units;
  settlements are decimal strings. Never parse a settlement amount as a float. All
  conversion goes through `src/lib/money.ts`.
- **Rating must stay deterministic.** No clock, no randomness, integer arithmetic only.
  An invoice is regenerated whenever a client disputes it and the second answer has to
  match the first.
- **A period cannot be invoiced until it reconciles.** That gate is the reason the
  close exists; the transition table has no path around it.
- **Issued invoices are immutable.** Corrections are credit notes.
- **The merchant access token has no read-only variant.** It can refund and pay out, so
  every privilege check lives in our layer and every money-moving action is audited.
