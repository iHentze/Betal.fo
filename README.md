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

## Faroese spellchecking

All the copy is Faroese, so the repo ships a Faroese dictionary for
[Code Spell Checker](https://marketplace.visualstudio.com/items?itemName=streetsidesoftware.code-spell-checker).
Open the project in Cursor or VS Code and accept the recommended extensions from
`.vscode/extensions.json` — misspellings in `.astro` and `.ts` files are then
underlined as you type, and "Add to project dictionary" appends to
`.cspell/project-words.txt`.

To check everything from the terminal:

```bash
npm run spell
```

The wordlist is compiled from the Hunspell dictionary published by
Fróðskaparsetur Føroya (via the [`dictionary-fo`](https://www.npmjs.com/package/dictionary-fo)
package) into `.cspell/fo.trie.gz`, which is committed so a fresh clone works
without an install step. `useCompounds` is on in `cspell.json` because Faroese
compounds freely, so `gjaldsvindeyga` and `nándgjaldsterminal` resolve from
their parts instead of needing an entry each. Rebuild the dictionary after
bumping `dictionary-fo`:

```bash
npm run spell:build
```

A spellchecker only catches words that do not exist. It will not catch a real
word in the wrong case, gender or number, so grammar still needs a human read.
