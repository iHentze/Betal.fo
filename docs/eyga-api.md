# Eyga → Betal company register

Betal reads the same live register as [eyga.fo](https://eyga.fo). The browser only
calls Betal; it never talks to Eyga directly.

## Transport

Production binds the Eyga D1 databases into `betal-app`:

```jsonc
{
  "d1_databases": [
    {
      "binding": "EYGA_CORE",
      "database_name": "eyga-core",
      "database_id": "477f6899-52a1-4bd1-9e9b-6351be9ddb76"
    },
    {
      "binding": "EYGA_SEARCH",
      "database_name": "eyga-search",
      "database_id": "74076e4d-946b-4195-a9da-092436ac66f8"
    }
  ]
}
```

Those are the databases behind `api.eyga.fo`. Betal queries them read-only and maps
the Faroese columns at the server boundary. Do not run Betal migrations against them.

`api.eyga.fo` remains an optional HTTP fallback when `EYGA_API_TOKEN` is set:

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

A leftover `EYGA_API_BASE_URL=http://127.0.0.1:…` fixture must not win over the live
register. HTTPS + token is the only HTTP path that overrides D1.

## Live fields

| Eyga | Betal |
|---|---|
| `regnr` | `registryNumber` |
| `navn` / `name` | `name` |
| `slag` / `legal_form` | `legalForm` / display company type |
| `stoda` / `status` | normalized application status |
| `heimstadur.postnr/bygd/adressa` | registered address |
| `eigarar[].partur_prosent` | `ownershipBps` |
| `veruligir_eigarar` | beneficial owners |
| `leidsla` + `nevnd` | management |

Name search uses the FTS5 `eyga-search` index when that binding is present, otherwise
a folded `LIKE` over `company.name`. Registration-number search is exact.

## Data boundaries

- Eyga provides public registry facts: legal name, company type, status, registered
  address, ownership, management and signing rules.
- Skráseting Føroya's `regnr` is **not** the merchant's TAKS V-tal.
- Residential streets (`street_is_residential`) are withheld from the merchant form.
- Eyga never provides P-tal. The signing person's P-tal comes from Samleikin/Skriva.
- Betal stores the confirmed public response as `registry_snapshot` for review and
  audit.
