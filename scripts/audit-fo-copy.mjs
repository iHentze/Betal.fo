// Reads the visible text off every rendered page and runs each distinct word
// through the Fróðskaparsetur Føroya wordlist with plain Hunspell.
//
// This complements `npm run spell`, which checks source files with cspell and
// allows Faroese compounds. Hunspell here is strict about compounds, which is
// noisier but catches wrong linking forms that compound-splitting hides -- it
// is how persónsupplýsingum, samtvinnað and óbiðna were found. It also reads
// aria-labels, alt text and placeholders, so copy that only a screen reader or
// a hover would surface is covered too.
//
// Usage: start the site (`npm run preview` or `npx wrangler dev`) and run
//   npm run spell:audit -- --base http://127.0.0.1:8787
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dictionary from "dictionary-fo";

const baseFlag = process.argv.indexOf("--base");
const BASE = (baseFlag !== -1 ? process.argv[baseFlag + 1] : "http://127.0.0.1:4321").replace(/\/$/, "");
const PATHS = ["/", "/alnetinum/", "/stadnum/", "/hald/", "/lon/", "/samband/", "/privativ/", "/does-not-exist/"];

// Brand names, foreign product names and technical terms are not Faroese, so
// holding the wordlist responsible for them would only create noise.
const ALLOWED = new Set(
  `betal epay softpay apple google pay iphone android nfc secure api webhooks backoffice sms taks als
   excel v-tal id 3d cvc mm åå navn fyritoka fo com level live visa mastercard pci dss sca ap gp gl sp kr`
    .split(/\s+/)
    .filter(Boolean),
);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("This audit needs Playwright: npm install --no-save playwright && npx playwright install chromium");
  process.exit(2);
}

try {
  execFileSync("hunspell", ["-vv"], { stdio: "ignore" });
} catch {
  console.error("This audit needs the hunspell binary: sudo apt-get install hunspell");
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 2000 } });

const occurrences = new Map();
for (const path of PATHS) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  // The 404 route is meant to 404; every other page must actually be there.
  if (!response?.ok() && path !== "/does-not-exist/") {
    console.error(`Could not load ${BASE}${path} (status ${response?.status()}). Is the site running?`);
    await browser.close();
    process.exit(2);
  }
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));

  const text = await page.evaluate(() => {
    const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!skip.has(node.parentElement?.tagName ?? "")) out.push(node.textContent);
    }
    for (const el of document.querySelectorAll("[aria-label],[alt],[title],[placeholder]")) {
      out.push(el.getAttribute("aria-label"), el.getAttribute("alt"), el.getAttribute("title"), el.getAttribute("placeholder"));
    }
    return out.filter(Boolean).join("\n");
  });

  for (const raw of text.split(/[^\p{L}\p{M}'’-]+/u)) {
    const word = raw.replace(/^[-'’]+|[-'’]+$/g, "");
    if (word.length < 2 || !/\p{L}/u.test(word)) continue;
    if (!occurrences.has(word)) occurrences.set(word, new Set());
    occurrences.get(word).add(path);
  }
}
await browser.close();

const words = [...occurrences.keys()].sort((a, b) => a.localeCompare(b, "fo"));

const staging = await mkdtemp(join(tmpdir(), "betal-fo-audit-"));
let stdout;
try {
  await writeFile(join(staging, "fo.dic"), dictionary.dic);
  await writeFile(join(staging, "fo.aff"), dictionary.aff);
  stdout = execFileSync("hunspell", ["-d", join(staging, "fo"), "-a", "-i", "UTF-8"], {
    input: words.join("\n") + "\n",
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
  });
} finally {
  await rm(staging, { recursive: true, force: true });
}

// `hunspell -a` prints a banner, then one blank-line-delimited block per input
// line. A block holds one verdict per word Hunspell found on that line, so a
// hyphenated compound yields several -- group on the blank lines rather than
// counting them, or every verdict after the first hyphen lands on the wrong word.
const blocks = stdout
  .split("\n")
  .slice(1)
  .join("\n")
  .split(/\n\s*\n/)
  .map((block) => block.split("\n").filter((line) => line.trim() !== ""))
  .filter((block) => block.length > 0);

if (blocks.length !== words.length) {
  console.error(`Parsed ${blocks.length} result blocks for ${words.length} words, so the mapping cannot be trusted.`);
  process.exit(2);
}

const unknown = [];
words.forEach((word, i) => {
  const rejected = blocks[i].filter((line) => !/^[*+-]/.test(line));
  if (rejected.length > 0 && !ALLOWED.has(word.toLowerCase())) {
    unknown.push({
      word,
      pages: [...occurrences.get(word)].join(" "),
      suggests: rejected[0].split(":")[1]?.trim() ?? "",
    });
  }
});

console.log(`Base URL:        ${BASE}`);
console.log(`Pages audited:   ${PATHS.length}`);
console.log(`Distinct words:  ${words.length}`);
console.log(`Not in wordlist: ${unknown.length}\n`);
for (const entry of unknown) {
  console.log(`  ${entry.word.padEnd(22)} ${entry.pages.padEnd(28)} ${entry.suggests ? `suggests: ${entry.suggests}` : ""}`);
}
console.log(
  `\nMost entries above are correct Faroese compounds the wordlist does not carry.\nRead the suggestions: a near-identical alternative usually means a real mistake.`,
);
