// Compiles the Faroese Hunspell dictionary shipped in `dictionary-fo` into the
// trie format that cspell (and the Code Spell Checker extension) can read.
// The result is committed to `.cspell/` so a fresh clone spell-checks Faroese
// without needing an install step first. Re-run with `npm run spell:build`.
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import dictionary from "dictionary-fo";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, ".cspell");
const packageDir = dirname(require.resolve("dictionary-fo"));

// cspell-tools names its output after the input file and looks for the affix
// file as a sibling, so stage the pair under the name we want to end up with.
const staging = await mkdtemp(join(tmpdir(), "betal-fo-dict-"));

try {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(staging, "fo.dic"), dictionary.dic);
  await writeFile(join(staging, "fo.aff"), dictionary.aff);
  await copyFile(join(packageDir, "license"), join(outputDir, "fo.LICENSE"));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("@cspell/cspell-tools/bin.mjs")),
      "compile-trie",
      "--trie3",
      "--output",
      outputDir,
      join(staging, "fo.dic"),
    ],
    { cwd: root },
  );

  process.stdout.write(stdout);
  process.stderr.write(stderr);
  console.log(`Wrote ${join(outputDir, "fo.trie.gz")}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
