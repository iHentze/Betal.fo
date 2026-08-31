# betal.fo

Two applications in one repository.

- **`/`** — the Faroese marketing site. Static Astro build, hosted as
  [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/).
- **`/app`** — the Betal platform: the merchant portal and Betal's own operating
  tools, built on ePay's Partner API. See [`app/README.md`](app/README.md).

## Marketing site

```bash
npm install
npm run dev
```

Build and deploy:

```bash
npm run build
npx wrangler deploy
```

Or in the Cloudflare dashboard: Workers → create → connect this GitHub repo.

- Build command: `npm run build`
- Output directory: `dist`
- Wrangler config: `wrangler.jsonc` (no Pages project, no Node adapter)

Copy lives in `src/content/fo.ts`. Contact details are in `src/content/site.ts`.

The contact form posts enquiries to the platform's intake endpoint so they land in
the sales pipeline, falling back to a `mailto:` link if the platform is unreachable.

## Documentation

- [`docs/epay.md`](docs/epay.md) — what ePay's API can do, the constraints that shape
  the architecture, and the three different things it calls a "fee".
- [`docs/epay-questions.md`](docs/epay-questions.md) — open questions for ePay,
  ordered by how much they block us.
