# ePay: capability map and constraints

Reference for everything Betal builds on ePay's new platform (`docs.epay.eu`, not the
legacy `docs.epay.dk`). Written from the published OpenAPI spec
(`https://docs.epay.eu/api/openapi.yaml?download=1`) and the guide corpus
(`https://docs.epay.eu/llms-full.txt`).

## Basics

| | |
|---|---|
| Base URL | `https://payments.epay.eu` — **one host for both test and live** |
| Path prefix | `/public/api/v1` |
| Auth | `Authorization: Bearer <credential>` |
| Environment split | By credential prefix: `test_…` and `live_…`, not by hostname |
| Outbound (webhooks) | `outbound.epay.eu` — allowlist by DNS name, IPs change without notice |
| Merchant backoffice | `app.epay.eu` |
| Partner portal | `partner.epay.eu` |

### Three credential tiers

1. **Partner key** — opens `/public/api/v1/partner/*`. Provisioned by ePay; no endpoint
   creates or rotates one. A merchant-format key gets `403 UNAUTHORIZED` here, versus
   `401` on merchant routes, so this is a genuinely separate authorization tier.
2. **Merchant API key** (`test_<uuid>` / `live_<uuid>`) — the merchant surface. ePay
   tells partners *not* to use these.
3. **Merchant access token** — a JWT minted by the partner, used **in place of** a
   merchant API key. This is what Betal uses for everything.

## The capability map

45 paths, 55 operations, 12 categories.

| Category | Operations | What it gives Betal |
|---|---|---|
| Partner | 6 | Merchant lifecycle and access tokens — the foundation |
| Management | 4 | Points of sale (create/read only), API key creation |
| Sessions | 2 | `POST /cit` to start a payment, `GET /sessions/{id}` |
| Transactions | 12 | List/get/operations, capture, refund, void, abort, renew, MIT, MIT batch, MOTO, physical sale |
| Settlements | 3 | Transfers, transfer detail, per-transfer transactions with fees |
| Payouts | 2 | Async and sync payout to a stored payment method |
| Subscriptions | 4 | List, get, update, disable |
| Subscription Billing | 10 | Plans, agreements, charges — a real recurring engine |
| Payment Links | 6 | Single links and reusable multi-links (QR) |
| Payment Methods | 2 | Imported (PSP migration) and disable stored method |
| Terminals | 1 | List only — SoftPay devices |
| Webhooks | 3 | Create, list, delete |

### Partner API in full

| Method | Path | Notes |
|---|---|---|
| `GET` | `/partner/accounts` | Paginated. **No filters at all** — no search by name, status or domain |
| `POST` | `/partner/accounts` | Requires `name`, `email`, `currencyCode`, `timezone`, `domain`. Emails an ownership invitation that cannot be suppressed |
| `GET` | `/partner/accounts/{id}` | Address, VAT and invoicing fields are **readable but not writable** — there is no PATCH |
| `PATCH` | `/partner/accounts/{id}/activate` | **No request body.** No KYC, no bank account, no documents |
| `DELETE` | `/partner/accounts/{id}` | Marks for closing; ePay closes it in the next billing period |
| `POST` | `/partner/accounts/{id}/access-token` | Body `{environment: "test"\|"live"}` → `{accessToken, expiresAt}` |

The access token expires after **8 hours**, and token requests are **cached for 1 hour**
— asking again inside that window returns the same token, so you cannot force rotation.
It is scoped to one merchant and one environment, and is otherwise a drop-in replacement
for the merchant API key: all-or-nothing, with no read-only variant.

Acquiring onboarding (EasyOnboard) has **no API**. It is a portal flow, white-labelled
only by agreement with ePay.

## Three constraints that dictate the architecture

### 1. Index endpoints allow 1 request per 5 seconds

| Category | Limit |
|---|---|
| Single MIT | 5 req/s, burst 300, 300 tx/min ingestion |
| Batch MIT | 1 batch/s, ≤500 tx per batch, 30,000 tx/min |
| **Index (list) endpoints** | **1 request / 5 seconds**, burst 30 |
| Resource endpoints | 5 requests / minute / resource |
| Operations (capture/void/refund) | 5 requests / minute / transaction |

Breach returns `429` with `errorCode: RATE_LIMIT_REACHED` and a `Retry-After` header.
ePay's own guidance is "Avoid polling — use webhooks where available."

**Consequence:** we cannot proxy list reads to ePay. Every list view is served from our
own mirror. The REST API is for backfill and reconciliation only.

### 2. Card and SCA data exist only on the webhook

`card` (masked PAN, PAR, issuer, scheme, country, segment, funding) and `sca`
(rejected, type, verification) appear on `NotificationWebhook` but on **no GET
endpoint**. `GET /transactions/{id}` does not return them.

**Consequence:** persist both at ingest or lose them permanently.

Note also that the list endpoint returns only the bare `Transaction`; the `aggregates`
object (authorized/captured/refunded/voided/remaining/paidOut) comes only from
`GET /transactions/{id}` and the webhook.

### 3. Webhooks are not signed

Verification is a bare `Authorization` header whose full value (including the scheme) is
the shared secret. Quoting the docs: "No additional signatures or payload signing is
applied. Verification relies exclusively on the `Authorization` header."

There is no HMAC, no timestamp and no replay protection. ePay explicitly warns partners:
"DO NOT use the same authentication for multiple merchants as this poses a security
risk."

**Consequence:** a distinct secret per merchant point of sale, constant-time comparison,
TLS only, and an idempotent handler because deliveries retry.

## Three different things are called "fee"

Never conflate these. They are named distinctly throughout our schema.

| Concept | Where it lives | Whose money |
|---|---|---|
| `Transaction.fee` — **surcharge** | ePay transaction, included in `amount` | Added to what the *cardholder* pays. Only if surcharge is configured. Not our revenue |
| Settlement `adjustments` — **acquirer cost** | `ACQUIRER_FEE`, `INTERCHANGE_FEE`, `SCHEME_FEE` | Deducted from the *merchant's* payout. The docs state these are "not related to nor charged by ePay" |
| **Betal fee** | Our database only | Our revenue. Exists nowhere in ePay |

A fourth cost, ePay's discounted gateway rate charged to Betal, is exposed by no API at
all and is configured by hand as a cost plan.

## Behaviours worth knowing

**Pagination is inconsistent.** Transactions, settlements and imported payment methods
use an opaque cursor (`offset` / `nextOffset` / `hasMore`) with **no total count**.
Everything else uses page numbers and returns `total` and `lastPage`. Cursor endpoints
cannot render "page 7 of 340".

**Both date bounds are inclusive.** `createdAfter` and `createdBefore` both include the
boundary, so consecutive windows double-count unless the boundary is handled.

**Idempotency** is available on every money-moving POST via the `Idempotency-Key`
header. Scoped by `[key, endpoint, verb]`, cached 24 hours, replays flagged with
`Idempotent-Replayed: true`.

**Operations return HTTP 200 on failure.** `OperationResponse` carries `success` and
`state` — a 200 does not mean the capture or refund worked.

**Refunds can partially succeed.** If multiple partial captures exist, a refund returns
several operations, each of which may independently fail.

**Amounts use two different units.** Transactions are integer minor units
(`1095` = 10,95 DKK). Settlements are decimal **strings** (`"99.01"`). Never parse a
settlement amount as a float.

**Settlement joins are one-to-many.** "One ePay transaction can be linked to multiple
settlement transactions if multiple partial captures or refunds are used."

**Webhooks auto-pause.** An endpoint failing more than 50% of the time over the previous
week is paused with `pauseReason: ERROR_RATE_TOO_HIGH`. Retries stop after 25 attempts,
each with a 5-second timeout. Surface `pausedAt` prominently or a merchant silently
stops receiving events.

**Point-of-sale advanced settings are read-only via API.** `POST /management/point-of-sales`
accepts only `name`, `domain` and `webhookAuthentication`; there is no PATCH. The
hosted configuration is defaults only, and every field can be overridden per-request on
`/cit`, which is the workaround.

**Acquirer routing is not controllable by API.** `processor` is deprecated: "This
parameter will soon be removed and will no longer have any effect. The functionality has
been replaced by routing rules in the ePay back office." Merchant placement onto an
acquirer is currently a manual backoffice step.

## Webhook events

Thirteen, all `.v1`:

```
transaction.success          transaction.failed
transaction.captured         transaction.refunded
transaction.voided           transaction.renewed
subscription.disabled
subscription-billing.charge-created
subscription-billing.charge-success
subscription-billing.charge-failed
subscription-billing.agreement-active
subscription-billing.agreement-stopped
settlement.transfer-ready
```

System-wide webhooks use an `{event, data}` envelope. The per-session `notificationUrl`
is a *different* shape — a flat `NotificationWebhook` — and ePay treats it as the
primary channel for payment results, with system webhooks as a secondary feed.

## Faroese specifics

The only Faroe Islands mention in the entire corpus is positive, on the Google Pay page:
card schemes are supported "for merchants in the Nordic region (Denmark including
Greenland and Faroe Islands, Norway, Sweden, Finland and Iceland)".

`fo` (Faroese) **is a supported checkout language** in ePay.js, alongside 27 others.
Combined with Blocks, the entire payment can be Faroese on a `.fo` domain.

Currency fields are free-form ISO 4217 with no enum, so DKK is unconstrained. Country
codes on accounts and addresses are unconstrained, so `FO` validates. The only hard
`DK`-only restriction is age verification, which depends on MitID.

ePay's go-live checklist assumes a Danish **CVR** number and domain verification at
Punktum.dk. Faroese companies hold a 6-digit **V-tal** from TAKS' Vinnuskráin register
and use `.fo` domains. See `docs/epay-questions.md`.
