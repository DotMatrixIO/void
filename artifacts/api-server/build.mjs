// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { execSync } from "node:child_process";
import {
  rm,
  mkdir,
  readdir,
  readFile,
  writeFile,
  stat,
} from "node:fs/promises";
import { createHash } from "node:crypto";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    loader: { ".yaml": "text" },
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
}

// Build-time provenance file consumed by the /proof/build endpoint
// (task #383). The endpoint reports `{ gitSha, builtAt, sha256sums: {...} }`
// for the bundle THIS server is currently serving, so an external
// verifier can `curl /api/proof/build` from a second network path and
// compare against the published, cosign-signed SHA256SUMS for the same
// release tag without trusting the browser-side delivery path.
//
// Inputs (all optional except gitSha — falls back to `git rev-parse`):
//   GIT_SHA           — full 40-hex commit SHA the build was made from
//   GIT_SHA_SHORT     — convenience; derived from GIT_SHA if absent
//   BUILD_TIMESTAMP   — ISO-8601 timestamp the release workflow stamped
//   CLIENT_DIST_DIR   — path to the void-client `dist/public` bundle
//                       whose files should be hashed and inlined. The
//                       release workflow points this at the artifact
//                       output; local dev builds skip the hash map.
async function readGitSha() {
  if (process.env.GIT_SHA && /^[0-9a-f]{40}$/.test(process.env.GIT_SHA)) {
    return process.env.GIT_SHA;
  }
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

async function hashClientBundle(distDir) {
  const sums = {};
  async function walk(dir, prefix = "") {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        const bytes = await readFile(full);
        const hash = createHash("sha256").update(bytes).digest("hex");
        sums[rel] = hash;
      }
    }
  }
  await walk(distDir);
  return sums;
}

async function readBuiltAt(gitSha) {
  // Priority order:
  // 1. Explicit BUILD_TIMESTAMP env (release workflow stamps this).
  // 2. Committer date of the gitSha — deterministic for a given SHA so
  //    two clean rebuilds of the same release produce the same builtAt,
  //    which is what the reproducibility check relies on.
  // 3. `new Date().toISOString()` as a last resort for dev builds where
  //    git is unavailable; flagged via the caveat.
  const fromEnv = process.env.BUILD_TIMESTAMP;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  if (gitSha && gitSha !== "unknown") {
    try {
      return execSync(`git show -s --format=%cI ${gitSha}`, {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      // Fall through to wall-clock.
    }
  }
  return new Date().toISOString();
}

async function writeBuildInfo(distDir) {
  const gitSha = await readGitSha();
  const builtAt = await readBuiltAt(gitSha);
  const clientDist = process.env.CLIENT_DIST_DIR;
  let sha256sums = {};
  let clientDistPath = null;
  if (clientDist) {
    const abs = path.isAbsolute(clientDist)
      ? clientDist
      : path.resolve(artifactDir, "..", "..", clientDist);
    try {
      const s = await stat(abs);
      if (s.isDirectory()) {
        sha256sums = await hashClientBundle(abs);
        clientDistPath = abs;
      }
    } catch {
      // Bundle hashing is best-effort at build time; the release
      // workflow always sets CLIENT_DIST_DIR after the void-client build.
      // Local dev builds leave it empty and the endpoint reports {}.
    }
  }
  const info = {
    schemaVersion: 1,
    gitSha,
    gitShaShort: process.env.GIT_SHA_SHORT ?? gitSha.slice(0, 12),
    builtAt,
    releaseTag: process.env.RELEASE_TAG ?? null,
    nodeVersion: process.version,
    clientDist: clientDistPath ? path.basename(clientDistPath) : null,
    sha256sums,
    // Honesty caveat (task #383 §5): an attacker that controls the
    // edge between the user and this server can rewrite both the JS
    // bundle and this response together. The cross-check that defeats
    // that is fetching /api/proof/build from a DIFFERENT network path
    // (mobile data, a friend's machine, a Tor exit) and confirming
    // both responses agree with the published, signed SHA256SUMS.
    caveat:
      "This is what this server claims to be serving over this network path. " +
      "A targeted attacker controlling the edge can rewrite both the bundle " +
      "and this response together. Fetch /api/proof/build from a second " +
      "network path and compare; verify gitSha against the cosign-signed " +
      "SHA256SUMS for the same release tag.",
  };
  await mkdir(distDir, { recursive: true });
  await writeFile(
    path.join(distDir, "BUILD_INFO.json"),
    JSON.stringify(info, null, 2),
    "utf8",
  );
}

// Task #491 / M-6 — build provenance file consumed by the
// /api/provenance.json endpoint. Separate from BUILD_INFO.json
// because (a) the SRI digests are sha384 (matching what add-sri.mjs
// stamps into the served HTML), where BUILD_INFO uses sha256 of the
// full bundle, and (b) the route's cache discipline differs
// (provenance is immutable for a given commit and served at
// max-age=3600, mirroring /api/openapi.yaml; /api/proof/build is
// served at max-age=300 because the placeholder caveat changes
// across dev/prod restarts).
//
// `sriDigests` is keyed by the in-HTML reference path (`/assets/...`)
// so a verifier can extract every `integrity="sha384-..."` attribute
// from the served `index.html`, look up the same key in this file,
// and confirm the two strings agree without ambiguity over which
// asset goes with which hash. The values are byte-identical to what
// `artifacts/void-client/scripts/add-sri.mjs` computes.
async function hashClientSriDigests(distDir) {
  const digests = {};
  const assetsDir = path.join(distDir, "assets");
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        const bytes = await readFile(full);
        const sha384 = createHash("sha384").update(bytes).digest("base64");
        digests[`/${rel}`] = `sha384-${sha384}`;
      }
    }
  }
  await walk(assetsDir, "assets");
  return digests;
}

async function writeProvenance(distDir) {
  const gitSha = await readGitSha();
  const builtAt = await readBuiltAt(gitSha);
  const clientDist = process.env.CLIENT_DIST_DIR;
  let sriDigests = {};
  if (clientDist) {
    const abs = path.isAbsolute(clientDist)
      ? clientDist
      : path.resolve(artifactDir, "..", "..", clientDist);
    try {
      const s = await stat(abs);
      if (s.isDirectory()) {
        sriDigests = await hashClientSriDigests(abs);
      }
    } catch {
      // Best-effort at build time; the release workflow always sets
      // CLIENT_DIST_DIR after the void-client build completes.
    }
  }
  // `builder` records *who/what* produced this build, so a reader of
  // provenance.json can tell whether the artifact came from the
  // canonical CI release pipeline (verifiable against the cosign-
  // signed release asset) or from a local-developer machine (not
  // verifiable). The release workflow exports BUILDER=github-actions.
  const builder =
    process.env.BUILDER ??
    (process.env.GITHUB_ACTIONS === "true"
      ? `github-actions/${process.env.GITHUB_WORKFLOW ?? "release"}`
      : "local-dev");
  const info = {
    schemaVersion: 1,
    commit: gitSha,
    builtAt,
    builder,
    sriDigests,
    releaseTag: process.env.RELEASE_TAG ?? null,
    caveat:
      "This is what this server claims to be serving over this network path. " +
      "A targeted attacker controlling the edge can rewrite both the bundle " +
      "and this response together. Cross-verify by fetching /api/provenance.json " +
      "from a second network path AND by comparing against the cosign-signed " +
      "provenance.json release asset for the same commit.",
  };
  await mkdir(distDir, { recursive: true });
  await writeFile(
    path.join(distDir, "provenance.json"),
    JSON.stringify(info, null, 2),
    "utf8",
  );
}

// Guard the top-level pipeline so this file can be imported by tests
// (which need `hashClientSriDigests` and `writeProvenance`) without
// kicking off an esbuild bundle as a side-effect of `import`.
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  buildAll()
    .then(async () => {
      const distDir = path.resolve(artifactDir, "dist");
      await writeBuildInfo(distDir);
      await writeProvenance(distDir);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { hashClientSriDigests, writeProvenance };
