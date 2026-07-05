// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { hashClientSriDigests, writeProvenance } from "../../build.mjs";

// Load-bearing invariant for /api/provenance.json (task #491 / M-6).
//
// The threat-model page promises that the `sriDigests` set published in
// provenance.json is byte-identical to the `integrity="sha384-..."`
// attributes that `scripts/add-sri.mjs` stamps into the served HTML for
// the SAME asset bytes. A verifier extracts both sets and compares them;
// if writeProvenance() and add-sri.mjs ever drift on hash algorithm,
// encoding, prefix, or key shape, the verifier reports a false-positive
// "tampered bundle" on every honest deploy.
//
// This test pins that invariant by running both code paths against the
// same synthetic asset directory and asserting the resulting digest
// strings match exactly, keyed by the same /assets/ paths.

const __dirname = dirname(fileURLToPath(import.meta.url));
const addSriScript = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "void-client",
  "scripts",
  "add-sri.mjs",
);

describe("provenance.json SRI digests match add-sri.mjs output", () => {
  let tmpRoot: string;
  let clientDist: string;
  let serverDist: string;
  let scriptCopy: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "provenance-sri-"));

    // Mirror the void-client layout add-sri.mjs expects: it resolves
    // its target as `<scriptDir>/../dist/public`, so we put the script
    // copy at `<tmp>/scripts/` and the fake bundle at `<tmp>/dist/public/`.
    clientDist = resolve(tmpRoot, "dist", "public");
    const assetsDir = resolve(clientDist, "assets");
    mkdirSync(assetsDir, { recursive: true });

    // Two assets with non-trivial, distinguishable bytes so a digest
    // collision between them would be conspicuous.
    writeFileSync(
      resolve(assetsDir, "index-abc123.js"),
      'export const greeting = "hello, provenance";\n',
    );
    writeFileSync(
      resolve(assetsDir, "index-def456.css"),
      ":root { --void: #000; }\n/* sri fixture */\n",
    );

    // Minimal index.html that references both assets as add-sri.mjs
    // expects (script src + stylesheet link, /assets/ prefixed).
    writeFileSync(
      resolve(clientDist, "index.html"),
      [
        "<!doctype html>",
        '<html><head>',
        '<link rel="stylesheet" href="/assets/index-def456.css">',
        '</head><body>',
        '<script type="module" src="/assets/index-abc123.js"></script>',
        "</body></html>",
        "",
      ].join("\n"),
    );

    const scriptsCopyDir = resolve(tmpRoot, "scripts");
    mkdirSync(scriptsCopyDir, { recursive: true });
    scriptCopy = resolve(scriptsCopyDir, "add-sri.mjs");
    cpSync(addSriScript, scriptCopy);

    // Server dist dir where writeProvenance() will drop provenance.json.
    serverDist = resolve(tmpRoot, "server-dist");
    mkdirSync(serverDist, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("the build script and add-sri.mjs produce identical sha384 SRI digests for the same /assets/ files", async () => {
    // 1. Generate provenance.json against the fake bundle.
    // writeProvenance reads CLIENT_DIST_DIR off process.env; set + restore
    // around the call so the test doesn't leak env to other tests.
    const prevClientDist = process.env.CLIENT_DIST_DIR;
    process.env.CLIENT_DIST_DIR = clientDist;
    try {
      await writeProvenance(serverDist);
    } finally {
      if (prevClientDist === undefined) delete process.env.CLIENT_DIST_DIR;
      else process.env.CLIENT_DIST_DIR = prevClientDist;
    }

    const provenance = JSON.parse(
      readFileSync(resolve(serverDist, "provenance.json"), "utf8"),
    ) as { sriDigests: Record<string, string> };

    // Sanity: we should have a digest for both fixture assets.
    expect(Object.keys(provenance.sriDigests).sort()).toEqual([
      "/assets/index-abc123.js",
      "/assets/index-def456.css",
    ]);

    // 2. Run add-sri.mjs against the same fake bundle.
    execFileSync(process.execPath, [scriptCopy], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stampedHtml = readFileSync(
      resolve(clientDist, "index.html"),
      "utf8",
    );

    // Parse integrity attributes from the stamped HTML, keyed by the
    // /assets/ reference path (same key shape provenance uses).
    const integrityByUrl = new Map<string, string>();
    const scriptRe = /<script\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRe.exec(stampedHtml))) {
      const attrs = m[1];
      const src = attrs.match(/\bsrc="([^"]+)"/)?.[1];
      const integrity = attrs.match(/\bintegrity="([^"]+)"/)?.[1];
      if (src && integrity) integrityByUrl.set(src, integrity);
    }
    const linkRe = /<link\b([^>]*)>/gi;
    while ((m = linkRe.exec(stampedHtml))) {
      const attrs = m[1];
      const rel = attrs.match(/\brel="([^"]+)"/)?.[1]?.toLowerCase();
      if (rel !== "stylesheet" && rel !== "modulepreload") continue;
      const href = attrs.match(/\bhref="([^"]+)"/)?.[1];
      const integrity = attrs.match(/\bintegrity="([^"]+)"/)?.[1];
      if (href && integrity) integrityByUrl.set(href, integrity);
    }

    // 3. Both sets must cover the same /assets/ paths.
    expect([...integrityByUrl.keys()].sort()).toEqual(
      Object.keys(provenance.sriDigests).sort(),
    );

    // 4. Per-asset string equality — the actual load-bearing invariant.
    for (const [url, integrity] of integrityByUrl) {
      expect(
        provenance.sriDigests[url],
        `provenance.sriDigests[${url}] must equal the integrity attribute add-sri.mjs stamped`,
      ).toBe(integrity);
    }
  });

  it("hashClientSriDigests keys every /assets/ file with sha384-<base64>", async () => {
    // Direct unit-level guard so a refactor that breaks the key shape
    // or hash format fails with a more targeted message than the
    // end-to-end equality test above.
    const digests = await hashClientSriDigests(clientDist);
    for (const [key, value] of Object.entries(digests)) {
      expect(key).toMatch(/^\/assets\//);
      expect(value).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
    }
  });
});
