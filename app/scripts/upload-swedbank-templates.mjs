import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "..", "assets", "swedbank");
const remote = process.argv.includes("--remote");

const templates = [
  {
    file: "Kortindlosning-Online-FO.pdf",
    key: "templates/swedbank/Kortindlosning-Online-FO.pdf",
    sha256: "06cfdbdb6d7d2ea023cc811d1e5b919d2686a02305f62a584e2f9a01c567fc60",
  },
  {
    file: "Swedbank Pay - Bekræftelse af konto.pdf",
    key: "templates/swedbank/Swedbank Pay - Bekræftelse af konto.pdf",
    sha256: "6839e5e6d403f3792adc14b101b85e314bc8fe8e6985acc1fedfa238c2caf6c1",
  },
  {
    file: "Prohibited lines of business.pdf",
    key: "templates/swedbank/Prohibited lines of business.pdf",
    sha256: "5aee60f343b8f7322009d9ca0ec9a5f5a26c1b28770277a9ea75b8a7c83a3e22",
  },
];

for (const template of templates) {
  const path = join(assets, template.file);
  const contents = await readFile(path);
  const digest = createHash("sha256").update(contents).digest("hex");
  if (digest !== template.sha256) {
    throw new Error(`${template.file}: expected ${template.sha256}, got ${digest}`);
  }

  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "wrangler",
      "r2",
      "object",
      "put",
      `betal-documents/${template.key}`,
      remote ? "--remote" : "--local",
      "--file",
      path,
      "--content-type",
      "application/pdf",
      "--force",
    ],
    { cwd: join(here, ".."), stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
