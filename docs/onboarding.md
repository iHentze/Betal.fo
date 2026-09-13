# Merchant onboarding platform

Betal can already create an ePay account. That is not enough to take live card money.
Live money needs an acquirer, and for Faroese merchants the default acquirer is
**Swedbank Pay**. Swedbank has now listed the documents, the signing rules, and the
appetite flags. Klintra Skriva is how we collect a Samleikin signature on the
acquiring agreement.

This document is the plan for that product. It is not EasyOnboard. EasyOnboard still
has no API and remains a staff/ePay step. The merchant-facing KYC, the FO document
pack, the signing, and the acquirer decision are ours.

## Sources

| Date | From | What it is |
|---|---|---|
| 8 Dec 2025 | Nicolai Christiansen, Swedbank Pay, forwarded by Robin 9 Sep 2026 | Required FO pack, signing options, sector 1 / sector 2, gross-payout appetite |
| 9 Sep 2026 | Robin Lyckegaard, ePay | How to treat the appetite flags, and Clearhaus / Shift4 as fallback |
| 10 Sep 2026 | Teitur Arge Seloy, Klintra | Staging + prod Skriva, login → create request → poll status, test P-numbers |

Attachments on Robin's mail (not transcribed here):

- `Kortindlosning-Online-FO.pdf` — Swedbank online acquiring agreement, FO edition
- `Swedbank Pay - Bekræftelse af konto.pdf` — bank account confirmation form
- `Prohibited lines of business.pdf` — sector 1 (refuse) and sector 2 (higher price + extra docs)

Skriva's partner API is snapshotted at `docs/skriva-external.openapi.json` from
`https://klintraelectronicsigningapi.azurewebsites.net/swagger/external/swagger.json`.

Robin also called the Eyga walkthrough "klasse". Use that as the quality bar for the
wizard: one question at a time, resume-safe, never a staff form dumped on the merchant.

## What Swedbank always wants

Every Faroese merchant going to Swedbank must produce this pack:

1. **Signed acquiring agreement** — the FO PDF, not a DK one.
   - Country code on the agreement must be `FO`, with the FO price list.
   - Signature is either **Samleikin via Skriva**, or **wet-ink PDF + photo ID**.
2. **Skásetingar prógv** — company registration from TAKS / Vinnuskráin. This is the
   Faroese stand-in for a Danish tegningsudskrift / CVR printout.
3. **Eigarabók** — owners book.
4. **Kontobekræftelse** — the Swedbank bank-confirmation form, filled and stamped by
   the merchant's bank.

Sometimes, after the first screen:

5. Latest annual accounts, or a YTD balance report.
6. Extra industry questions.

Those last two are not optional once the vertical is sector 2, or once equity /
operations look thin. They are also how we satisfy "skærpede krav til dokumentation".

## Appetite and routing

Swedbank pays out **gross** (`bruttoudbetalingsprincippet`). That is why they are
strict on Faroese capital: they are exposed until fees are collected later.

Robin reduced the appetite to three red flags. Any one of them means **do not send
the merchant to Swedbank**.

| Flag | Swedbank | What we do |
|---|---|---|
| Negative equity | Refuse | Clearhaus, or Shift4 if the volume is real |
| Negative operations (`negativ drift`) | Refuse | Same |
| Sector 1 prohibited vertical | Refuse | Same, or decline the merchant |
| Sector 2 vertical | Accept, higher price, extra docs | Stay on Swedbank, switch the FO price list, require accounts + industry questions |

The screening decision is ours, recorded, and replayable. Staff can override it, but
the override is an audit event, not a silent edit. We do not generate a Swedbank
agreement for a merchant we have already flagged off Swedbank — that is how you
accidentally send the wrong contract.

`processor` is still deprecated and ePay routing is still backoffice-only. The
platform decides *who the merchant should be placed with*. A human still sets that
placement in ePay until an API exists.

## What Klintra gives us

Teitur's mail, plus the external swagger:

| | Staging | Production |
|---|---|---|
| UI | `https://sign.klintra.fo/` | `https://skriva.klintra.fo/` |
| API | `https://klintraelectronicsigningapi.azurewebsites.net` | `https://skrivaapi.klintra.fo` |
| Test P-numbers | `320000001` … `320000020` | real P-tal + Samleikin |

The partner surface (`Skriva íbinding`) is eight endpoints. We use these:

1. `POST /api/Login` — email + password (+ optional `tenantId`) → bearer token.
2. `POST /api/Signing/create-signing-request` — PDF bytes, signers (`name`, `email`,
   `personalIdentificationNumber`), title, `redirectUrl`, optional mail + expiry.
   Returns `signingRequestId` and per-signer `{token, signingUrl}`.
3. `GET /api/Signing/task/status/token/{token}` — poll. There is **no webhook** on
   the external API. Internal Skriva has webhooks; we are not that client.
4. `GET /api/Document/signed/downloadByTokenAndPersonalIdentificationNumber` — pull
   the signed PDF once status says it is done.

`POST /api/Signing/create-from-identification-numbers-and-pdf-content` is the thinner
variant (P-tal list + PDF, no names/emails/mail). Prefer `create-signing-request` so
we can mail the signer and send them back to Betal via `redirectUrl`.

Login credentials were not in the mail. We need a dedicated Skriva tenant user,
stored as Worker secrets, never in the repo. Staging first.

## How this sits on what we already have

| Already in the app | What changes |
|---|---|
| `POST /partner/accounts` + POS + webhook + price plan | Stays. Creates the ePay **test** account so the merchant can try payment links. |
| `onboarding_step.acquiring = manual` | Becomes a real application, not a checkbox. |
| `acquiring_application` (`not_started` … `rejected`) | Keep the states. Drive them from the pack, do not type them in by hand. |
| `contract` | Use it for the generated FO agreement and the signed PDF pointer. |
| `merchant.country_code = FO`, `v_tal`, `legal_name`, address | Reused as the company profile. Missing: owners, vertical, equity, operations, bank. |
| EasyOnboard | Still no API. Staff-only, after the pack is ready, if ePay still requires it. |

Do not create the **live** ePay path, and do not tell the merchant they can take card
payments, until the acquirer has approved. Test money and live money stay distinct.

## Two surfaces

### Merchant wizard

A resume-safe application the merchant owns. Stripe Connect is the shape
([verify a business](https://mobbin.com/flows/46860e68-4922-421b-8cf9-06e6953a61f5),
[Connect setup checklist](https://mobbin.com/flows/cd7a208f-2712-4dee-8c02-c9768a57f33d)):
one centered task at a time, dashboard checklist while something is missing, never a
dead end. Company facts and public ownership come from the private Eyga API.

Steps, in this order, because later steps depend on earlier answers:

1. **Company** — search Eyga, confirm legal name, company type and address, then add
   the TAKS V-tal (which is not Skráseting Føroya's registration number).
2. **Business** — website, what they sell, and a vertical from our list, tagged
   sector 1 / sector 2 / allowed.
   Sector 1 stops the Swedbank path here. Sector 2 unlocks the extra-doc steps.
3. **Owners** — confirm public owners from Eyga, then add email, role and ownership
   corrections. Signatories must be people who can bind the company. P-tal is never
   typed here; Samleikin returns it for the signing person.
4. **Finances** — equity positive / negative / unknown; operations the same. Unknown
   is allowed only if they upload accounts. Negative routes off Swedbank.
5. **Bank** — Faroese account number, then a transactional request sent by Betal with
   the prefilled Swedbank confirmation attached. The bank adviser is `To`; the
   merchant's required email is `CC` and `Reply-To`. Resend's idempotency key prevents
   a retried form POST from sending twice. The bank stamps the form and replies to the
   merchant, who uploads it; this is not a Skriva signature.
6. **Documents** — skásetingar prógv, eigarabók if not assembled from step 3,
   accounts if required.
7. **Sign** — we fill `Kortindlosning-Online-FO.pdf` with FO + the price list that
   matches the vertical, send it through Skriva, and send the merchant to
   `signingUrl`. They come back via `redirectUrl`. Fallback: upload a wet-ink PDF
   plus photo ID.
8. **Wait** — "Swedbank hevur pakkan" / "Vit rætta hetta móti Clearhaus". No fake
   progress.

Faroese throughout. Numbers in Inter. The merchant never sees ePay, EasyOnboard, or
Swedbank's email thread.

### Staff queue

`/betal/umbonir` (or similar): every application as a row with appetite flags,
missing documents, recommended acquirer, and age. Opening one shows the pack, the
signed PDF, the screening record, and three actions:

- submit to Swedbank (or mark submitted with a reference)
- reroute to Clearhaus / Shift4
- reject, with a reason the merchant can see

Staff can request the optional documents without inventing a new state: the
application goes back to `collecting` with a reason.

## Domain model

New tables, not more columns stuffed onto `merchant`.

```
onboarding_application
  merchant_id | lead_id
  state          draft | screening | collecting | signing | pack_ready
                 | submitted | approved | rejected | routed
  recommended_acquirer   swedbank | clearhaus | shift4 | decline
  chosen_acquirer        staff-confirmed, may differ
  country_code           FO
  registry_source        eyga | manual
  registry_id, registry_snapshot, registry_checked_at
  company_type, company_details_confirmed
  vertical_id
  equity                 positive | negative | unknown
  operations             positive | negative | unknown
  screening_at, screening_by, screening_reason

onboarding_owner
  application_id
  name, email, role, ownership_bps
  is_signatory

onboarding_document
  application_id
  kind    agreement | photo_id | company_registration | owners_book
          | bank_confirmation | annual_accounts | industry_answers
  required | uploaded | reviewed
  r2_key, content_type, uploaded_by, uploaded_at

onboarding_signing
  application_id
  provider         skriva
  environment      staging | production
  signing_request_id
  signer_token, signing_url, p_tal
  status           sent | viewed | signed | expired | failed
  last_polled_at
  signed_r2_key

onboarding_event
  application_id
  kind, actor, payload, at
```

`acquiring_application` stays as the acquirer-facing record (`submitted` /
`approved` / `rejected`). The new tables are how we *got* there.

Documents live in R2. D1 holds metadata only. We do not have an R2 binding yet.

## Screening is a function

Same rule as rating: given the same inputs, the same recommendation. Inputs are the
vertical, equity, operations, and (later) the prohibited-list version.

```
if vertical.sector == 1          → decline | clearhaus | shift4
if equity == negative            → clearhaus | shift4
if operations == negative        → clearhaus | shift4
if vertical.sector == 2          → swedbank + sector2_price_list + extra_docs
if equity or operations unknown  → swedbank + standard_fo_price_list + accounts
else                             → swedbank + standard_fo_price_list
```

Shift4 only when staff (or a later volume field) says the book is large enough.
"Larger business with good volume" is Robin's phrase, not a number yet.

The prohibited list is versioned in our database, transcribed from Swedbank's PDF.
We do not hardcode it in a UI select without a version, because Swedbank will send
a new PDF.

## Signing details

- Generate the FO agreement as PDF bytes (template + filled company / owners /
  prices / `FO`).
- Start the Skriva/Samleikin identity flow for each signatory; persist the verified
  P-tal returned by the provider rather than asking the merchant to type it.
- Store tokens. Mail can come from Skriva (`sendMailToSigningPersons`) so we do not
  block on our own email provider.
- `redirectUrl` = `https://app.betal.fo/umbon/{id}/skriva` with
  `appendTokenToRedirectUrl: true`.
- Poll from a cron or a Durable Object alarm, **not** from the request that created
  the signing. Also refresh when the merchant or staff opens the page.
- On `signed`, download the PDF to R2 and move the application to `pack_ready`.

Staging uses P-numbers `320000001`–`320000020`. Never send a real P-tal to staging.

## Bindings and secrets

Needed before the first staging signature and bank request:

| Name | Where |
|---|---|
| `SKRIVA_BASE_URL` | var, staging URL first |
| `SKRIVA_EMAIL` | secret |
| `SKRIVA_PASSWORD` | secret |
| `SKRIVA_TENANT_ID` | secret or var, if login returns several tenants |
| `RESEND_API_KEY` | secret |
| `BANK_EMAIL_FROM` | var, verified sender such as `Betal <banki@betal.fo>` |
| R2 bucket `DOCUMENTS` | wrangler binding, private |
| Cron, ~every minute | poll open Skriva tokens |

Do not put Skriva credentials in `.dev.vars.example` as real values.

## What we will not automate

- EasyOnboard. Still a portal.
- ePay acquirer routing. Still backoffice.
- Talking to Swedbank's own API. There isn't one for this pack. Submission is email
  or however Nicolai wants the first merchants, recorded as `submitted` + `external_ref`.
- Fetching skásetingar prógv from TAKS. Upload first. A register lookup is a later
  gift if one exists.
- The bank confirmation. The bank fills that, we only collect it.

## Sequence

Build in this order. Each slice is usable without the next.

1. **Screening + application record.** Staff can open a merchant, record vertical /
   equity / operations, and see the recommended acquirer. No uploads yet.
2. **Document checklist + R2.** Merchant or staff uploads the four always-required
   files. Pack completeness is visible.
3. **Skriva staging.** One signatory, the FO agreement as an uploaded PDF (not yet
   generated), poll, download signed copy.
4. **Merchant wizard.** The Eyga-quality flow on top of (1)–(3).
5. **FO agreement generation.** Fill `Kortindlosning-Online-FO.pdf` with `FO` and
   the correct price list. This is the step that can silently send the wrong
   contract if we get it wrong.
6. **Staff submit + route.** Closes `acquiring_application`, unblocks live ePay.
7. **Transcribe the prohibited PDF** into a versioned list. Until then, staff pick
   the sector by hand.

Slice 1 is the first thing to implement. It makes the Swedbank rules real inside
Betal without waiting on Klintra credentials or R2.

## Open questions

1. **Skriva tenant login.** Teitur sent environments and test P-numbers, not an API
   user. We need one for staging.
2. **FO price lists.** Nicolai said the agreement must go out with FO pricing.
   Which numbers go on the standard list vs sector 2? That is commercial, from
   Robin / Swedbank, not something we invent.
3. **Sector list.** Transcribe `Prohibited lines of business.pdf` before we let a
   merchant self-serve the vertical step.
4. **Agreement fields.** Transcribe `Kortindlosning-Online-FO.pdf` so we know what
   we must fill vs what Swedbank pre-prints.
5. **Bank form.** Same for `Bekræftelse af konto.pdf` — which fields the merchant
   fills vs the bank.
6. **Who signs.** One tegningsberettiget, or every owner above some threshold?
7. **Shift4 volume threshold.** Robin said "større forretning med god volumen".
   Ask for a number.
8. **First-customer follow-up.** Nicolai offered a meeting when the first merchant
   is ready. The submit action should make that easy, not a forgotten email.
9. **Photo-ID fallback.** Needed only if Samleikin fails. Do we build the upload
   in slice 2, or wait until someone cannot use Skriva?

Until (1) and (3) are answered, do not put the wizard in front of a real merchant.
The staff screening view can go live without them.
