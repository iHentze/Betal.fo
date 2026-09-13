# Eyga → Betal company API

Betal consumes Eyga as a server-to-server API. The browser only calls Betal; it never
receives an Eyga credential or calls the registry directly.

## Transport

Production uses a private Cloudflare Worker service binding named `EYGA_API`. The
Eyga API Worker should have no public route. For local or staging development, Betal
can use `EYGA_API_BASE_URL` and the secret `EYGA_API_TOKEN`.

The Betal Worker binding, once the Eyga API Worker exists:

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

The binding is intentionally not added to `wrangler.jsonc` until `eyga-api` is
deployed; an unresolved binding would break local startup and deployments.

## Endpoints

### Search companies

`GET /v1/companies?query=banki&limit=8`

```json
{
  "results": [
    {
      "id": "10",
      "name": "P/F Føroya Banki",
      "companyType": "P/F Partafelag",
      "location": "110 Tórshavn",
      "registryNumber": "10",
      "status": "active",
      "statusLabel": "Virkið",
      "href": "https://eyga.fo/felag/10"
    }
  ]
}
```

Only companies are returned. Search by company name or Skráseting Føroya number.

### Company detail

`GET /v1/companies/10`

```json
{
  "id": "10",
  "registryNumber": "10",
  "name": "P/F Føroya Banki",
  "legalForm": "P/F",
  "companyType": "P/F Partafelag",
  "status": "active",
  "statusLabel": "Virkið",
  "address": "Oknarvegur 5",
  "postalCode": "110",
  "city": "Tórshavn",
  "updatedAt": "2026-04-10",
  "sourceUrl": "https://eyga.fo/felag/10",
  "owners": [
    {
      "name": "Føroya Landsstýri",
      "kind": "entity",
      "reference": "eind/17515",
      "description": "Landstýrið · Føroyar",
      "ownershipBps": 3482,
      "role": null
    }
  ],
  "beneficialOwners": [],
  "management": [
    {
      "name": "Turið Finnbogadóttir Arge",
      "kind": "person",
      "reference": "personur/15520",
      "description": "Stjóri · Tórshavn",
      "ownershipBps": null,
      "role": "Stjóri"
    }
  ]
}
```

`ownershipBps` is basis points (`3482` = `34.82%`). Lists may be empty but must be
present.

## Data boundaries

- Eyga provides public registry facts: legal name, company type, status, registered
  address, ownership and management.
- Skráseting Føroya's number is **not** the merchant's TAKS V-tal.
- Eyga never provides P-tal or private residential addresses.
- The signing person's P-tal comes back from Samleikin/Skriva and is not typed into
  the ownership form.
- Betal stores the confirmed public response as `registry_snapshot` for review and
  audit. It never stores an Eyga access token.
