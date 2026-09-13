# Open questions for ePay

Drafted for `support@epay.dk`, with technical contacts Thomas (CTO, `thomas@epay.dk`)
and Niki (Tech Lead, `niki@epay.dk`) named in the migration guide.

Ordered by how much they block us. Everything here is absent from `docs.epay.eu` and the
published OpenAPI spec — these are gaps, not things we failed to look up.

---

## 1. Blocking: acquiring for Faroese merchants

**Partially answered, 8 Dec 2025 / forwarded 9 Sep 2026.** Swedbank Pay (Nicolai
Christiansen) will onboard Faroese merchants. They want a FO-priced acquiring
agreement signed with Samleikin or PDF + photo ID, skásetingar prógv, eigarabók,
and a bank confirmation. Negative equity, negative operations, or a prohibited
vertical is a refuse; Clearhaus / Shift4 is the fallback. The pack and the
routing rules are in `docs/onboarding.md`.

Still open for the *other* acquirers, and for ePay's own go-live checklist:

- The ePay checklist assumes a **CVR** and domain verification at **Punktum.dk**.
  Faroese companies have a V-tal and a `.fo` domain. Swedbank has substituted
  skásetingar prógv for the CVR printout. We still need to know whether ePay's
  own review, and Clearhaus / Shift4 / Nets / Worldline, accept the same.
- How is domain ownership verified for a `.fo` domain?
- Is there anything else Denmark-specific in the live-activation review that a
  Faroese merchant would fail?

---

## 2. Acquirer routing without the `processor` field

`processor` is marked deprecated across session initialization, payment links and the
hosted configuration, with the note that the functionality "has been replaced by routing
rules in the ePay back office". We found no API for routing rules.

Our model depends on placing each merchant with the acquirer that suits them, so:

1. Can routing rules be set programmatically today, or is it backoffice-only?
2. If backoffice-only, is an API planned?
3. Until then, what is the supported way for a partner to set a new merchant's acquirer
   during automated onboarding?

This decides how much of our provisioning flow can run without a human.

---

## 3. Rate-limit scoping

Index endpoints are documented at 1 request / 5 seconds with a burst of 30. We run a
monthly reconciliation that re-walks `GET /transactions` for every merchant.

1. Are these limits applied **per merchant access token**, or aggregated **per partner**?
2. If per partner, does the ceiling scale with merchant count, and can it be raised?

Per-partner scoping would put a hard cap on how many merchants we can reconcile in a
billing period, so it changes how we design the job.

---

## 4. Merchant account status values

`Account.status` is typed as a bare string in the spec with no enum, and no values are
documented anywhere.

1. What is the complete set of possible values?
2. Which transitions are possible, and which are one-way?
3. Is there a documented state diagram for the merchant account lifecycle?

We need this to show accurate merchant status in our own dashboard.

---

## 5. Suppressing the owner-invitation email

`POST /partner/accounts` sends an ownership invitation to the `email` address
automatically. Our merchants' relationship is with Betal and they never sign in to
`app.epay.eu`, so this email is confusing for them.

1. Can the invitation be suppressed for partner-created accounts?
2. If not, can its content be customised or co-branded?

---

## 6. Read-only merchant access tokens

The token from `POST /partner/accounts/{id}/access-token` is a full substitute for the
merchant API key, which means our client portal holds a credential that can issue
refunds and payouts even on screens that only display data.

We enforce privilege separation in our own layer, but defence in depth would be better:

1. Is a read-only or scope-limited access token available or planned?
2. Can a token be restricted to a subset of endpoints at mint time?

---

## 7. Payment window branding

Both of these are backoffice-only today:

1. Can a partner serve the payment window from a **custom domain**, so our merchants'
   customers stay on a Betal-owned domain?
2. Can **payment window configurations** be created programmatically? Today they must be
   made by hand in the backoffice before `paymentWindowId` can reference them, which
   blocks fully automated onboarding of a branded checkout.

---

## 8. Point-of-sale mutability

`POST /management/point-of-sales` accepts `name`, `domain` and `webhookAuthentication`,
and there is no PATCH or DELETE.

1. Is a point-of-sale update endpoint planned?
2. `descriptor` — what the cardholder sees on their statement and in the MitID challenge
   — is returned but cannot be set via API. Can it be set at creation?
3. `webhookAuthentication` is documented as unchangeable via API after creation. Is
   rotating a webhook secret programmatically possible?

---

## 9. Documentation issues found

Small things, offered as feedback:

- `GET /subscriptions/billing/plans` and `.../agreements` declare **no query parameters
  at all** in the spec, yet return a paginated envelope. There is no documented way to
  reach page 2, or to look up an agreement by `subscriptionId`.
- The `reference` filter on `GET /transactions` is described as using `prefixMode`, but
  the actual parameter is `referenceMode`.
- `GET /transactions` supports a `terminalId` filter, but the `Transaction` schema has no
  `terminalId` field, so results cannot be attributed back to a terminal.
- `StoreWebhookRequest` accepts 13 event values while the `Webhook` response schema's
  `events` enum lists only 6, omitting all `transaction.*`.
- `PAYPAL` has a documentation page and client SDK methods but appears nowhere in the
  OpenAPI `PaymentMethodType` enum.
- The `Card` schema mixes casing: `pan`, `expireMonth`, `expireYear`, `par` are
  camelCase while `Issuer`, `Scheme`, `Country`, `Segment`, `Funding` are PascalCase.
- The resume-billing-agreement endpoint describes its path parameter as "The id of the
  agreement to **stop**".
- The `Processor` enum lists four values (`shift4`, `clearhaus`, `nets`, `worldline`)
  while the field description mentions only three.
- None of the six Partner endpoints, nor `create-api-key`, declare a `security` block in
  the spec, though they are clearly authenticated in practice.
