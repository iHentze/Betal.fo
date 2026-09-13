# Production onboarding runbook

## Provisioned resources

- D1: `betal` (`b7f1450c-c93b-4eea-ad53-0f694a8cf2de`, WEUR)
- KV: `betal-tokens` (`2107b17ae3904d09812fc0368463b7ea`)
- R2: `betal-documents`
- Service binding: `EYGA_API` → `eyga-api`
- Scheduled Worker: `betal-onboarding` (deploy after secrets are configured)

## Resend DNS

Resend domain: `send.betal.fo`, EU region, sending only, TLS enforced, tracking off.

Add these records in the `betal.fo` DNS zone:

```text
TXT  resend._domainkey.send
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDNeEXimNskC0iye7jQFJHe02cMi+VK2eE8MKZKdNxR3xoQzKUmihIBA9ss9hiYdEQa4JhKQwyuc59wTj5B8Qr7+AjpYrIftrQl7d0I9+ZH8jq1Mn5ipJU/gTBXL0PZzyCCpc5gwEfbblwOpGMns4Trl/+zlLaZFtp1dGtjtbdKOQIDAQAB

MX   bounce.send  10 feedback-smtp.eu-west-1.amazonses.com
TXT  bounce.send  v=spf1 include:amazonses.com ~all
CNAME rbounce.send send.forge.rmta.net
```

After DNS has propagated, trigger Resend domain verification. Then create a
sending-only API key restricted to `send.betal.fo`.

## Worker secrets

Set these without committing values:

```sh
cd app
npx wrangler secret put EPAY_PARTNER_KEY
npx wrangler secret put EYGA_API_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_WEBHOOK_SECRET
npx wrangler secret put SKRIVA_EMAIL
npx wrangler secret put SKRIVA_PASSWORD
npx wrangler secret put SKRIVA_TENANT_ID # only for a multi-tenant user
npx wrangler secret put IDENTITY_ENCRYPTION_KEY
```

The scheduled `betal-onboarding` Worker needs `SKRIVA_EMAIL`, `SKRIVA_PASSWORD`,
optional `SKRIVA_TENANT_ID`, and `IDENTITY_ENCRYPTION_KEY` as well.

## Database and templates

```sh
cd app
npm run db:migrate
npm run templates:upload -- --remote
```

Confirm:

- `d1_migrations` contains every migration through `0009`.
- `PRAGMA foreign_key_check` returns no rows.
- All three R2 template objects match the hashes in `document_template`.
- Approved `standard` and `sector2` price-list rows exist and contain all card
  categories. Do not create a signing request while either list is empty.

## Deploy

```sh
cd app
npx wrangler deploy
npx wrangler deploy --config workers/ingest/wrangler.jsonc
npx wrangler deploy --config workers/onboarding/wrangler.jsonc
```

Create `betal-ingest` and `betal-ingest-dlq` before deploying the ingest consumer.

After `betal-app` is live, create the Resend webhook:

```text
https://app.betal.fo/api/resend/webhook
```

Subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`,
`email.bounced`, `email.complained`, and `email.suppressed`. Store its signing
secret as `RESEND_WEBHOOK_SECRET`.

## Release gates

- Official FO PDF template hashes match.
- Approved FO numeric rates are present.
- `send.betal.fo` is verified.
- Eyga health check and authenticated lookup pass.
- Klintra staging login, two-person signing, P-tal encryption, status refresh and
  signed-PDF download pass using test identities only.
- Desktop and 390px acceptance recordings pass.
- Customer-facing Faroese has been reviewed with the `foroyskt` MCP and a human.
