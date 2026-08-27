# betal.fo

Faroese marketing site for Betal. Static Astro build, hosted as [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/).

## Develop

```bash
npm install
npm run dev
```

## Build and deploy

```bash
npm run build
npx wrangler deploy
```

Or in the Cloudflare dashboard: Workers → create → connect this GitHub repo.

- Build command: `npm run build`
- Output directory: `dist`
- Wrangler config: `wrangler.jsonc` (no Pages project, no Node adapter)

Copy lives in `src/content/fo.ts`. Contact email is in `src/content/site.ts`.
