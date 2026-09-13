#!/usr/bin/env node
/**
 * Local Klintra Skriva + Samleikin stand-in.
 *
 * Implements the endpoints Betal calls, plus a signing page that returns a staging
 * P-tal. Not the real Samleikin — labeled TEST so nobody mistakes it for Talgildu
 * Føroyar. Start with `npm run fixtures:skriva`.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.SKRIVA_FIXTURE_PORT ?? 8790);
const HOST = process.env.SKRIVA_FIXTURE_HOST ?? "127.0.0.1";
const EMAIL = process.env.SKRIVA_EMAIL ?? "skriva-local@betal.fo";
const PASSWORD = process.env.SKRIVA_PASSWORD ?? "local-skriva";
const TOKEN = "local-skriva-token";
const ORIGIN = `http://${HOST}:${PORT}`;
const PUBLIC_ORIGIN = (process.env.SKRIVA_PUBLIC_URL ?? ORIGIN).replace(/\/+$/, "");

/** @type {Map<number, { title: string, redirectUrl: string, appendToken: boolean, pdf: Buffer, signers: Map<string, object> }>} */
const requests = new Map();
let nextRequestId = 1001;
let nextPersonId = 1;
let nextPtal = 320000001;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function text(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, { "content-type": type });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function authorized(request) {
  return request.headers.authorization === `Bearer ${TOKEN}`;
}

function findSigner(token) {
  for (const request of requests.values()) {
    const signer = request.signers.get(token);
    if (signer) return { request, signer };
  }
  return null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function samleikinPage(signer, request) {
  const ptal = signer.personalIdentificationNumber ?? String(nextPtal);
  return `<!doctype html>
<html lang="fo">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Samleikin · roynsla</title>
  <style>
    :root {
      --surface-0: oklch(0.158 0.042 284);
      --surface-1: oklch(0.185 0.036 284);
      --surface-2: oklch(0.222 0.030 284);
      --ink: oklch(0.96 0.012 284);
      --muted: oklch(0.78 0.02 284);
      --faint: oklch(0.66 0.018 284);
      --line: oklch(0.32 0.018 284);
      --accent: #7AD966;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--surface-0);
      color: var(--ink);
      font: 16px/1.45 Inter, ui-sans-serif, system-ui, sans-serif;
      font-feature-settings: "tnum";
      padding: 1.5rem;
    }
    main {
      width: min(28rem, 100%);
      background: var(--surface-1);
      border: 1px solid var(--line);
      border-radius: 1rem;
      padding: 1.5rem;
      display: grid;
      gap: 1rem;
    }
    .kicker { color: var(--faint); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 1.35rem; font-weight: 600; }
    p { margin: 0; color: var(--muted); }
    dl { margin: 0; display: grid; gap: 0.65rem; }
    dt { color: var(--faint); font-size: 0.75rem; }
    dd { margin: 0; }
    button {
      appearance: none;
      border: 0;
      border-radius: 0.75rem;
      background: var(--accent);
      color: #10240c;
      font: inherit;
      font-weight: 600;
      padding: 0.85rem 1rem;
      cursor: pointer;
    }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  </style>
</head>
<body>
  <main>
    <div class="kicker">Samleikin · TEST · ikki almenni Samleikin</div>
    <h1>Vátta undirskriftina</h1>
    <p>${escapeHtml(request.title)}. P-talið kemur frá Samleikanum — tú skrivar tað ikki.</p>
    <dl>
      <div>
        <dt>Undirskrivari</dt>
        <dd>${escapeHtml(signer.name)}</dd>
      </div>
      <div>
        <dt>Teldupostur</dt>
        <dd>${escapeHtml(signer.email)}</dd>
      </div>
      <div>
        <dt>P-tal (roynsla)</dt>
        <dd>${escapeHtml(ptal)}</dd>
      </div>
    </dl>
    <form method="POST">
      <button type="submit">Vátta við Samleikanum</button>
    </form>
  </main>
</body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", ORIGIN);
  const method = request.method ?? "GET";

  try {
    if (method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true, service: "skriva-fixture" });
      return;
    }

    if (method === "POST" && url.pathname === "/api/Login") {
      const body = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      if (body.email !== EMAIL || body.password !== PASSWORD) {
        json(response, 200, { successful: false, error: "Ógyldug innritan" });
        return;
      }
      json(response, 200, {
        successful: true,
        token: TOKEN,
        loggedInUsername: EMAIL,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/Signing/create-signing-request") {
      if (!authorized(request)) {
        json(response, 401, { error: "Unauthorized" });
        return;
      }
      const body = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      const pdf = Buffer.from(String(body.pdfContent ?? ""), "base64");
      if (pdf.subarray(0, 5).toString() !== "%PDF-") {
        json(response, 400, { error: "pdfContent má vera ein PDF" });
        return;
      }
      const signingRequestId = nextRequestId++;
      const signers = new Map();
      const signerRows = [];
      for (const row of body.signers ?? []) {
        const token = randomUUID();
        const signingPersonId = nextPersonId++;
        const signer = {
          signingPersonId,
          token,
          name: row.name ?? "",
          email: row.email ?? "",
          personalIdentificationNumber: null,
          state: "sent",
        };
        signers.set(token, signer);
        signerRows.push({
          signingPersonId,
          token,
          personalIdentificationNumber: null,
          signingUrl: `${PUBLIC_ORIGIN}/samleikin/${token}`,
        });
      }
      requests.set(signingRequestId, {
        title: body.title ?? "FO-avtala",
        redirectUrl: body.redirectUrl ?? "",
        appendToken: body.appendTokenToRedirectUrl !== false,
        pdf,
        signers,
      });
      json(response, 200, {
        signingRequestId,
        created: new Date().toISOString(),
        expirationDate: body.expirationDate ?? null,
        signers: signerRows,
      });
      return;
    }

    const statusMatch = url.pathname.match(/^\/api\/Signing\/task\/status\/token\/([^/]+)$/);
    if (method === "GET" && statusMatch) {
      if (!authorized(request)) {
        json(response, 401, { error: "Unauthorized" });
        return;
      }
      const found = findSigner(decodeURIComponent(statusMatch[1]));
      if (!found) {
        json(response, 404, { error: "Ikki funnin" });
        return;
      }
      json(response, 200, {
        status: found.signer.state,
        signed: found.signer.state === "signed",
        personalIdentificationNumber: found.signer.personalIdentificationNumber,
        signingPerson: {
          personalIdentificationNumber: found.signer.personalIdentificationNumber,
        },
      });
      return;
    }

    const downloadMatch = url.pathname.match(
      /^\/api\/Document\/signed\/downloadBySigningRequestAndToken\/(\d+)\/([^/]+)\//,
    );
    if (method === "GET" && downloadMatch) {
      if (!authorized(request)) {
        json(response, 401, { error: "Unauthorized" });
        return;
      }
      const stored = requests.get(Number(downloadMatch[1]));
      const signer = stored?.signers.get(decodeURIComponent(downloadMatch[2]));
      if (!stored || !signer || signer.state !== "signed") {
        json(response, 404, { error: "Ikki undirskrivað" });
        return;
      }
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-length": stored.pdf.byteLength,
      });
      response.end(stored.pdf);
      return;
    }

    const signMatch = url.pathname.match(/^\/samleikin\/([^/]+)$/);
    if (signMatch) {
      const token = decodeURIComponent(signMatch[1]);
      const found = findSigner(token);
      if (!found) {
        text(response, 404, "Hendan Samleikin-leinkjan er ikki longur galdandi.");
        return;
      }
      if (method === "GET") {
        if (found.signer.state === "sent") found.signer.state = "viewed";
        text(response, 200, samleikinPage(found.signer, found.request), "text/html; charset=utf-8");
        return;
      }
      if (method === "POST") {
        if (found.signer.state !== "signed") {
          found.signer.state = "signed";
          found.signer.personalIdentificationNumber = String(nextPtal++);
        }
        const redirect = new URL(
          found.request.redirectUrl || `${ORIGIN}/samleikin/${token}?ok=1`,
        );
        if (found.request.appendToken) redirect.searchParams.set("token", token);
        response.writeHead(303, { location: redirect.toString() });
        response.end();
        return;
      }
    }

    json(response, 404, { error: "not found" });
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : "fixture-feilur" });
  }
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`Skriva/Samleikin fixture on ${ORIGIN}\n`);
});
