// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for the SRI post-build steps (tasks #243 and #258).
 *
 * If the production build has not been run, the test is skipped — the
 * dev/CI machine that runs `vitest` is not always the one that runs the
 * full build. When `dist/public/index.html` exists we treat it as the
 * authoritative output:
 *
 *   1. (Task #243) Every <script src> and every <link rel="stylesheet"
 *      | "modulepreload" href> that points at a file under /assets/ MUST
 *      carry an integrity attribute whose sha384 matches the on-disk
 *      bytes, AND must carry crossorigin="anonymous". The same checks run
 *      against every per-route social-card HTML emitted by gen-og-pages.mjs
 *      because those files share byte-identical script/link tags with
 *      index.html and are equally exposed to a tampered-asset attacker.
 *
 *   2. (Task #258) Every chunk reachable from any entry via the transitive
 *      dynamic-import closure (walking both `imports` and `dynamicImports`
 *      from the Vite manifest) MUST appear as a
 *      <link rel="modulepreload" integrity="sha384-…" crossorigin="…">
 *      tag in EVERY emitted HTML — not just index.html. This catches the
 *      regression where the manifest walker silently misses chunks, or the
 *      modulepreload injection runs before gen-og-pages and only
 *      index.html ends up covered.
 *
 *   3. (Task #258) Parameterized tamper-test: for each lazy chunk in the
 *      closure, append a byte to the built file, recompute sha384,
 *      confirm it no longer matches the modulepreload integrity attribute
 *      in index.html, then restore the file. This proves the integrity
 *      attribute is a real cryptographic baseline against tampering and
 *      that the manifest walker actually picked the chunk up.
 *
 * These tests catch the regression modes most likely to break SRI
 * silently: someone reorders the build pipeline so add-sri.mjs or
 * add-modulepreload-sri.mjs no longer runs after gen-og-pages.mjs and the
 * per-route HTMLs end up unprotected; someone introduces a new HTML
 * output path that inherits the script/link tags but is not passed
 * through the SRI step; or someone disables the Vite build manifest so
 * the dynamic-import closure can no longer be computed.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "..", "..", "dist", "public");
const manifestPath = resolve(distDir, ".vite", "manifest.json");

interface TaggedRef {
  tag: string;
  url: string;
  rel: string | null;
  integrity: string | null;
  crossorigin: string | null;
}

function* iterTaggedRefs(html: string): Generator<TaggedRef> {
  const scriptRe = /<script\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) {
    const attrs = m[1];
    const src = attrs.match(/\bsrc="([^"]+)"/)?.[1];
    if (!src) continue;
    yield {
      tag: "script",
      url: src,
      rel: null,
      integrity: attrs.match(/\bintegrity="([^"]+)"/)?.[1] ?? null,
      crossorigin:
        attrs.match(/\bcrossorigin(?:="([^"]*)")?/)?.[1] ??
        (attrs.includes("crossorigin") ? "" : null),
    };
  }
  const linkRe = /<link\b([^>]*)>/gi;
  while ((m = linkRe.exec(html))) {
    const attrs = m[1];
    const rel = attrs.match(/\brel="([^"]+)"/)?.[1]?.toLowerCase() ?? null;
    if (rel !== "stylesheet" && rel !== "modulepreload") continue;
    const href = attrs.match(/\bhref="([^"]+)"/)?.[1];
    if (!href) continue;
    yield {
      tag: "link",
      url: href,
      rel,
      integrity: attrs.match(/\bintegrity="([^"]+)"/)?.[1] ?? null,
      crossorigin:
        attrs.match(/\bcrossorigin(?:="([^"]*)")?/)?.[1] ??
        (attrs.includes("crossorigin") ? "" : null),
    };
  }
}

function htmlFiles(): string[] {
  if (!existsSync(distDir)) return [];
  const fs = require("node:fs") as typeof import("node:fs");
  return fs
    .readdirSync(distDir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => resolve(distDir, f))
    .sort();
}

interface ManifestEntry {
  file: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

function loadManifest(): Record<string, ManifestEntry> | null {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    ManifestEntry
  >;
}

function computeDynamicClosure(
  manifest: Record<string, ManifestEntry>,
): string[] {
  const closure = new Set<string>();
  const stack: string[] = [];
  for (const entry of Object.values(manifest)) {
    if (!entry.isEntry) continue;
    for (const dep of entry.dynamicImports ?? []) stack.push(dep);
  }
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (closure.has(key)) continue;
    const e = manifest[key];
    if (!e) throw new Error(`manifest missing chunk ${key}`);
    closure.add(key);
    for (const dep of e.imports ?? []) {
      if (!manifest[dep]?.isEntry) stack.push(dep);
    }
    for (const dep of e.dynamicImports ?? []) stack.push(dep);
  }
  return [...closure].sort();
}

function listAssetFilesRecursive(dir: string): string[] {
  const fs = require("node:fs") as typeof import("node:fs");
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = resolve(dir, name);
    const s = fs.statSync(abs);
    if (s.isDirectory()) out.push(...listAssetFilesRecursive(abs));
    else if (s.isFile()) out.push(abs);
  }
  return out;
}

const files = htmlFiles();

// Task #294: STRICT_SRI=1 turns the self-skip-on-missing-build behaviour
// below into a hard failure, so the pre-deploy CI gate cannot pass on a
// missing or partial build. Local `pnpm test` runs without STRICT_SRI keep
// the skip-on-missing-build convenience.
const strictMode =
  process.env.STRICT_SRI === "1" || process.env.STRICT_SRI === "true";

if (strictMode) {
  describe("SRI strict mode (task #294 CI gate)", () => {
    it("dist/public/index.html exists (production build ran before tests)", () => {
      expect(
        existsSync(resolve(distDir, "index.html")),
        `STRICT_SRI=1 but ${resolve(distDir, "index.html")} does not exist. ` +
          "Run `pnpm --filter @workspace/void-client build` before tests.",
      ).toBe(true);
    });
    it("dist/public/.vite/manifest.json exists (modulepreload walker input)", () => {
      expect(
        existsSync(manifestPath),
        `STRICT_SRI=1 but ${manifestPath} does not exist. ` +
          "Ensure `build.manifest=true` in vite.config.ts and the build completed.",
      ).toBe(true);
    });
    it("dist/public/sw-known-hashes.json exists (SW integrity table, task #489)", () => {
      expect(
        existsSync(resolve(distDir, "sw-known-hashes.json")),
        `STRICT_SRI=1 but ${resolve(distDir, "sw-known-hashes.json")} does not exist. ` +
          "Ensure `gen-sw-known-hashes.mjs` runs at the end of the void-client build script — " +
          "without it the service worker silently downgrades to pre-task-489 " +
          "stale-while-revalidate with no cryptographic re-verification of cached assets.",
      ).toBe(true);
    });
  });
}

const describeIfBuilt = files.length > 0 ? describe : describe.skip;

describeIfBuilt("SRI post-build (task #243)", () => {
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const refs = [...iterTaggedRefs(html)].filter((r) =>
      r.url.includes("/assets/"),
    );

    if (refs.length === 0) continue;

    describe(file.replace(distDir + "/", ""), () => {
      for (const ref of refs) {
        it(`<${ref.tag}> ${ref.url} carries a matching sha384 integrity and crossorigin="anonymous"`, () => {
          // Check string-ness up front so a missing attribute fails with an
          // actionable message (e.g. "add-sri.mjs did not run") rather than
          // the opaque "TypeError: .toMatch() expects to receive a string,
          // but got object" you get from passing null into toMatch.
          expect(
            typeof ref.integrity,
            `integrity attribute present on <${ref.tag} ${ref.url}> in ${file} — ` +
              `did the post-build add-sri.mjs step run?`,
          ).toBe("string");
          expect(
            ref.integrity as string,
            `integrity attribute is sha384 on <${ref.tag} ${ref.url}> in ${file}`,
          ).toMatch(/^sha384-/);
          expect(
            ref.crossorigin,
            `crossorigin="anonymous" on <${ref.tag} ${ref.url}> in ${file}`,
          ).toBe("anonymous");

          const onDisk = resolve(distDir, ref.url.replace(/^\/+/, ""));
          expect(
            existsSync(onDisk),
            `referenced asset exists at ${onDisk}`,
          ).toBe(true);
          const bytes = readFileSync(onDisk);
          const expected =
            "sha384-" + createHash("sha384").update(bytes).digest("base64");
          expect(
            ref.integrity,
            `integrity matches sha384 of on-disk ${onDisk}`,
          ).toBe(expected);
        });
      }
    });
  }
});

const manifest = files.length > 0 ? loadManifest() : null;
const describeIfManifest = manifest ? describe : describe.skip;

describeIfManifest("modulepreload SRI on dynamic-import closure (task #258)", () => {
  // vitest 4's `describe.skip` still evaluates the callback body to
  // collect test names; without this guard a missing manifest would
  // crash module evaluation in `computeDynamicClosure(null)` and
  // turn the intended self-skip into a hard failure with an opaque
  // TypeError. The strict-mode block above is the place where a
  // missing build is meant to fail loudly with an actionable message.
  if (!manifest) return;
  const m = manifest;
  const closureKeys = computeDynamicClosure(m);

  it("computes a non-empty dynamic-import closure (sanity check that the walker is wired up)", () => {
    expect(
      closureKeys.length,
      "Vite manifest exposes at least one dynamically-imported chunk; if this fails, either the app no longer uses lazy() / import() (recheck) or build.manifest=true was disabled in vite.config.ts",
    ).toBeGreaterThan(0);
  });

  // Every emitted HTML must carry a modulepreload tag with valid sha384
  // integrity for every chunk in the closure. Parameterised over the
  // cross product of (HTML file, chunk) so a single missing tag is
  // attributable to its file.
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const modulepreloadByHref = new Map<string, TaggedRef>();
    for (const ref of iterTaggedRefs(html)) {
      if (ref.tag === "link" && ref.rel === "modulepreload") {
        modulepreloadByHref.set(ref.url, ref);
      }
    }

    describe(file.replace(distDir + "/", ""), () => {
      for (const key of closureKeys) {
        const file = m[key].file;
        it(`has <link rel="modulepreload" integrity="…"> for ${file}`, () => {
          // The href is base-prefixed in production. We accept any href
          // that ends with /<file> to stay tolerant of base-path changes.
          const matched = [...modulepreloadByHref.values()].find((r) =>
            r.url.endsWith("/" + file),
          );
          expect(matched, `modulepreload tag for ${file}`).toBeDefined();
          expect(
            typeof matched!.integrity,
            `integrity attribute present on modulepreload for ${file} — ` +
              `did add-modulepreload-sri.mjs run?`,
          ).toBe("string");
          expect(matched!.integrity as string).toMatch(/^sha384-/);
          expect(matched!.crossorigin).toBe("anonymous");

          const onDisk = resolve(distDir, file);
          const bytes = readFileSync(onDisk);
          const expected =
            "sha384-" + createHash("sha384").update(bytes).digest("base64");
          expect(matched!.integrity).toBe(expected);
        });
      }
    });
  }

  // Tamper-test: append one byte to each closure chunk in turn, recompute
  // sha384, assert it no longer matches the modulepreload integrity
  // attribute in index.html, then restore the file. The point of this
  // test is to fail loudly if the manifest walker silently drops a chunk
  // (in which case the tampered chunk would have no integrity baseline
  // to mismatch against). It runs against the index.html modulepreload
  // tag set, which the previous block already proved is identical across
  // every emitted HTML.
  describe("tamper-detection", () => {
    const indexHtml = readFileSync(resolve(distDir, "index.html"), "utf8");
    const indexPreloads = new Map<string, TaggedRef>();
    for (const ref of iterTaggedRefs(indexHtml)) {
      if (ref.tag === "link" && ref.rel === "modulepreload") {
        indexPreloads.set(ref.url, ref);
      }
    }

    for (const key of closureKeys) {
      const file = m[key].file;
      it(`appending a byte to ${file} invalidates its modulepreload integrity`, () => {
        const ref = [...indexPreloads.values()].find((r) =>
          r.url.endsWith("/" + file),
        );
        expect(ref, `modulepreload tag for ${file} present in index.html`).toBeDefined();
        const onDisk = resolve(distDir, file);
        const original = readFileSync(onDisk);
        try {
          const tampered = Buffer.concat([original, Buffer.from([0x00])]);
          writeFileSync(onDisk, tampered);
          const tamperedDigest =
            "sha384-" + createHash("sha384").update(tampered).digest("base64");
          expect(tamperedDigest).not.toBe(ref!.integrity);
          // And the original digest must still match — sanity check that
          // we are testing the right attribute.
          const originalDigest =
            "sha384-" + createHash("sha384").update(original).digest("base64");
          expect(originalDigest).toBe(ref!.integrity);
        } finally {
          writeFileSync(onDisk, original);
        }
      });
    }
  });
});

/**
 * Task #493: catch the case where the SW integrity-hash list goes missing
 * (or goes stale) from a build.
 *
 * `gen-sw-known-hashes.mjs` (task #489) is the last step of the void-client
 * build and writes `dist/public/sw-known-hashes.json` — the cryptographic
 * baseline the service worker re-verifies cached `/assets/*` bytes against
 * before serving them. If a future pipeline reorder, cache bug, or missed
 * script wire-up drops the file or leaves it incomplete, the SW silently
 * downgrades to the pre-task-489 stale-while-revalidate behaviour and
 * `sri.test.ts`'s existing entry-HTML coverage would not notice.
 *
 * This block asserts the three properties that close that silent-downgrade
 * gap:
 *   (a) `sw-known-hashes.json` exists in the built output
 *   (b) it covers every file currently under `dist/public/assets/`
 *   (c) every hash in the table matches the sha384 of the on-disk bytes
 *
 * The STRICT_SRI=1 block above adds (a) as a hard failure during the
 * pre-deploy CI gate (matching the existing strict-mode pattern); the
 * assertions below run unconditionally whenever a build is present so the
 * coverage and per-file hash properties also fail loudly on regression.
 */
const swHashesPath = resolve(distDir, "sw-known-hashes.json");
const assetsDir = resolve(distDir, "assets");

describeIfBuilt("SW known-hashes integrity table (task #493)", () => {
  it("dist/public/sw-known-hashes.json exists (gen-sw-known-hashes.mjs ran)", () => {
    expect(
      existsSync(swHashesPath),
      `${swHashesPath} is missing — gen-sw-known-hashes.mjs (task #489) did not run as part of the build. ` +
        "Without this file the service worker silently downgrades to pre-task-489 " +
        "stale-while-revalidate with no cryptographic re-verification of cached assets.",
    ).toBe(true);
  });

  if (!existsSync(swHashesPath)) return;

  const table = JSON.parse(readFileSync(swHashesPath, "utf8")) as Record<
    string,
    string
  >;

  // basePath logic must match gen-sw-known-hashes.mjs verbatim so the
  // key shape produced here lines up with the keys the script emits.
  const basePath = (
    process.env.BASE_PATH ||
    process.env.BASE_URL ||
    "/"
  ).replace(/\/+$/, "");

  const assetFiles = existsSync(assetsDir)
    ? listAssetFilesRecursive(assetsDir).sort()
    : [];

  it("covers every file under dist/public/assets/", () => {
    expect(
      assetFiles.length,
      `dist/public/assets/ is empty — vite build did not produce any asset chunks?`,
    ).toBeGreaterThan(0);

    const expectedKeys = assetFiles
      .map((abs) => `${basePath}${abs.slice(distDir.length).replace(/\\/g, "/")}`)
      .sort();
    const tableKeys = Object.keys(table).sort();
    const missing = expectedKeys.filter((k) => !(k in table));
    expect(
      missing,
      `sw-known-hashes.json is missing ${missing.length} on-disk asset(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}. ` +
        "Either gen-sw-known-hashes.mjs ran before the asset(s) were emitted, " +
        "or BASE_PATH at build time differs from the test env. " +
        `(tableKeys head: ${tableKeys.slice(0, 3).join(", ")}; expected head: ${expectedKeys.slice(0, 3).join(", ")})`,
    ).toEqual([]);
  });

  for (const abs of assetFiles) {
    const key = `${basePath}${abs.slice(distDir.length).replace(/\\/g, "/")}`;
    it(`hash for ${key} matches on-disk sha384`, () => {
      const recorded = table[key];
      expect(
        typeof recorded,
        `sw-known-hashes.json has no entry for ${key} — see the coverage test above for the missing-key list`,
      ).toBe("string");
      const expected =
        "sha384-" + createHash("sha384").update(readFileSync(abs)).digest("base64");
      expect(
        recorded,
        `sw-known-hashes.json hash for ${key} is stale relative to on-disk bytes — ` +
          "the SW would treat valid bytes as tampered (or vice versa).",
      ).toBe(expected);
    });
  }
});
