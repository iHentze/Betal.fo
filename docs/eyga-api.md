# Eyga → Betal company API

Betal consumes the live, read-only `api.eyga.fo` service. The browser only calls
Betal; it never receives the Eyga credential.

## Transport and authentication

Production calls the `eyga-api` Worker through a private Cloudflare service binding:

```jsonc
{
  "services": [
    {
      "binding": "EYGA_API",
      "service": "eyga-api"
    }
  ]
}
```

Eyga still requires `Authorization: Bearer <token>`, including service-binding calls.
Set the same `EYGA_API_TOKEN` secret on `eyga-api` and the Betal app Worker. For local
development, `EYGA_API_BASE_URL=https://api.eyga.fo` uses normal HTTPS instead.

## Live endpoints

| Endpoint | Betal use |
|---|---|
| `GET /v1/leita?q=&limit=8` | Find a company by name or registration number |
| `GET /v1/felag/{regnr}` | Company type, status, address, management and signing rules |
| `GET /v1/felag/{regnr}/eigarar` | Direct and beneficial ownership |
| `GET /v1/heilsa` | API/register health |

The live API uses Faroese field names. Betal maps them at the server boundary:

| Eyga | Betal |
|---|---|
| `regnr` | `registryNumber` |
| `navn` | `name` |
| `slag` | `legalForm` / display company type |
| `stoda` | normalized application status |
| `heimstadur.postnr/bygd/adressa` | registered address |
| `eigarar[].partur_prosent` | `ownershipBps` |
| `veruligir_eigarar` | beneficial owners |
| `leidsla` + `nevnd` | management |

Search returns `{ "urslit": [...] }`. Company and ownership are separate API requests
and are combined before the merchant sees the confirmation screen.

## Data boundaries

- Eyga provides public registry facts: legal name, company type, status, registered
  address, ownership, management and signing rules.
- Skráseting Føroya's `regnr` is **not** the merchant's TAKS V-tal.
- Eyga withholds residential street addresses and never provides P-tal.
- The signing person's P-tal comes from Samleikin/Skriva and is not typed into the
  ownership form.
- Betal stores the confirmed public response as `registry_snapshot` for review and
  audit. It never stores the Eyga token in D1 or sends it to the browser.
