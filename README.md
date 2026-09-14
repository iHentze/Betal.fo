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

### Auditing the rendered copy

`npm run spell` checks source files and allows Faroese compounds, which keeps it
quiet enough to run constantly but lets a wrong compound linking form through.
The audit script is the stricter counterpart: it reads the visible text off every
rendered page, including `aria-label`, `alt`, `title` and placeholder text, and
runs each word through plain Hunspell with no compound splitting.

```bash
npm run preview                                   # or npx wrangler dev --port 8787
npm run spell:audit -- --base http://localhost:4321
```

It needs the `hunspell` binary (`sudo apt-get install hunspell`) and Playwright
(`npm install --no-save playwright && npx playwright install chromium`). Expect
around sixty results on a clean run: nearly all are correct compounds the
wordlist does not carry. Read the suggestion next to each one, because a
near-identical alternative usually means a real mistake — that is how
<!-- cspell:ignore persónsupplýsingum samtvinnað óbiðna -- misspellings quoted as examples -->
`persónsupplýsingum`, `samtvinnað` and `óbiðna` were caught.

### Checking grammar

For agreement, [BRAGD](https://huggingface.co/Setur/BRAGD) is the useful tool: a
Faroese morphological tagger from the University of the Faroe Islands that labels
every token with word class, gender, number and case, so an adjective can be
compared against the noun it modifies. It is not wired into this repo — it is a
1&nbsp;GB PyTorch model, too heavy for a routine check — but it is worth reaching
for when copy changes substantially. It needs `transformers==4.57.1`; version 5
cannot load its tokenizer. Note that BRAGD marks indeclinable words such as
`bindandi` and `sjálvvirkandi` with not-applicable gender, number and case, and
that punctuation must be split off its own token or the tags go wrong.
