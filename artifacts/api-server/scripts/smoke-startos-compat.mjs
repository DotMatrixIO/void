#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real-tool StartOS config round-trip.
//
// The vitest suite in src/__tests__/startos-entrypoint.test.ts asserts the
// config-screen -> env-var mapping against a *captured* fixture
// (CAPTURED_COMPAT_CONFIG) — the verbatim bytes the real StartOS packaging tool
// (`start9/compat`) once emitted for assets/config_spec.yaml. That capture is
// manual: if the spec changes, someone has to remember to re-run `compat` and
// paste the new bytes, or the fixture silently drifts back to a stand-in.
//
// This smoke test removes the manual step. It drives the *real* published
// `start9/compat:latest` Docker image — the same binary the manifest's
// `config.get` / `config.set` procedures invoke — against the shipped
// assets/config_spec.yaml + assets/config_rules.yaml, feeds the bytes the tool
// writes through deploy/startos/docker_entrypoint.mjs (the production `main`
// entrypoint), and asserts the env mapping the API server would end up reading.
// If the spec and the entrypoint drift apart, this fails.
//
// It degrades gracefully: where Docker is unavailable (no daemon, no network to
// pull the image), it prints a SKIP notice and exits 0 rather than failing, so
// it does not break CI on hosts without a working Docker daemon.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(artifactDir, "..", "..");
const SPEC_SRC = path.join(repoRoot, "assets", "config_spec.yaml");
const RULES_SRC = path.join(repoRoot, "assets", "config_rules.yaml");
const ENTRYPOINT_SRC = path.join(repoRoot, "deploy", "startos", "docker_entrypoint.mjs");

const IMAGE = "start9/compat:latest";
const ENV_MARKER = "__VOID_ENV__";

function log(msg) {
  console.log(`[smoke-startos-compat] ${msg}`);
}

function skip(reason) {
  log(`SKIP: ${reason}`);
  log("Docker-dependent real-tool round-trip skipped (this is not a failure).");
  process.exit(0);
}

function fail(msg) {
  console.error(`[smoke-startos-compat] FAIL: ${msg}`);
  process.exit(1);
}

// The complete config the StartOS Config-screen Save sends to `compat config
// set` — one entry per spec field, exactly as the front end builds it from the
// spec (operator values for the fields touched, the spec default for
// ntfy_server, and `~` for every nullable left unset). `compat config set`
// itself does NOT validate against the spec or fill defaults (verified: it
// passes unknown keys, bad patterns, and out-of-range numbers straight
// through) — the StartOS UI does that — so feeding the full payload is what
// faithfully reproduces a real Save.
//
// The colon-bearing URLs are deliberately passed UNQUOTED here so the
// round-trip actually exercises the one transformation the real tool performs
// that a hand-rolled stand-in would miss: `compat` double-quotes colon-bearing
// scalars on output (and the entrypoint must strip those quotes again). Plain
// hex/alnum secrets, numbers and booleans stay unquoted. Every key here must
// match a spec field — the coverage check below enforces that.
const OPERATOR_VALUES = {
  "lightning-backend": "lnbits",
  "paywall-secret": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "lnbits-url": "https://lnbits.example.onion",
  "lnbits-api-key": "abc123def456",
  "btcpay-url": "~",
  "btcpay-api-key": "~",
  "btcpay-store-id": "~",
  "turn-url": "turns:relay.example.onion:5349",
  "turn-secret": "supersecretturnvalue",
  "turn-credential-ttl": "4500",
  "stun-url": "~",
  "trust-proxy-hops": "2",
  "log-level": "info",
  "tor-only": "true",
  "paywall-jitter-min-ms": "10000",
  "paywall-jitter-max-ms": "60000",
  "paywall-jitter-disable": "false",
  "ntfy-topic": "~",
  "ntfy-server": "https://ntfy.sh",
  "ntfy-token": "~",
};
const OPERATOR_INPUT =
  Object.entries(OPERATOR_VALUES)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n") + "\n";

// Env vars the round-trip must produce, with their exact string values.
const EXPECTED_ENV = {
  LIGHTNING_BACKEND: "lnbits",
  PAYWALL_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  LNBITS_URL: "https://lnbits.example.onion",
  LNBITS_API_KEY: "abc123def456",
  TURN_URL: "turns:relay.example.onion:5349",
  TURN_SECRET: "supersecretturnvalue",
  TURN_CREDENTIAL_TTL: "4500",
  TRUST_PROXY_HOPS: "2",
  LOG_LEVEL: "info",
  TOR_ONLY: "1",
  PAYWALL_JITTER_MIN_MS: "10000",
  PAYWALL_JITTER_MAX_MS: "60000",
  PAYWALL_JITTER_DISABLE: "0",
  // ntfy_server carries its spec default in the payload (as the Config screen
  // would) -> compat writes it -> the entrypoint sets the env var.
  NTFY_SERVER: "https://ntfy.sh",
};

// Nullables the operator left unset: compat writes `~`, the entrypoint skips
// them, so they must NOT appear in the resolved env (server fallbacks apply).
const EXPECTED_UNSET = [
  "BTCPAY_URL",
  "BTCPAY_API_KEY",
  "BTCPAY_STORE_ID",
  "STUN_URL",
  "NTFY_TOPIC",
  "NTFY_TOKEN",
];

// Top-level field keys declared in assets/config_spec.yaml (a key at column 0
// whose value is empty; the field's properties follow indented).
function specFieldKeys() {
  const text = readFileSync(SPEC_SRC, "utf8");
  const keys = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-z0-9-]+):\s*$/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...opts });
}

function dockerAvailable() {
  const which = spawnSync("docker", ["--version"], { encoding: "utf8" });
  if (which.error || which.status !== 0) return false;
  // Daemon reachable?
  const ver = docker(["version", "--format", "{{.Server.Version}}"]);
  return !ver.error && ver.status === 0;
}

// Remove a host dir that may contain root-owned files written by the container.
function cleanupDataDir(dataDir) {
  // The container writes /root/start9/* as root, so a plain rmSync would EACCES.
  // Use the same image to delete the root-owned subtree, then drop the (host-
  // owned) temp dir.
  try {
    docker(["run", "--rm", "-v", `${dataDir}:/root`, "--entrypoint", "rm", IMAGE, "-rf", "/root/start9"]);
  } catch {
    // best effort
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

function main() {
  if (!dockerAvailable()) {
    skip("Docker daemon not available (cannot run the real start9/compat tool).");
  }

  log(`pulling ${IMAGE} ...`);
  const pull = docker(["pull", IMAGE], { stdio: "inherit" });
  if (pull.error || pull.status !== 0) {
    skip(`could not pull ${IMAGE} (no network / registry access?).`);
  }

  const work = mkdtempSync(path.join(tmpdir(), "void-startos-compat-"));
  const dataDir = path.join(work, "data");
  const assetsDir = path.join(work, "assets");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });
  copyFileSync(SPEC_SRC, path.join(assetsDir, "config_spec.yaml"));
  copyFileSync(RULES_SRC, path.join(assetsDir, "config_rules.yaml"));

  // Coverage guard: the operator payload must name exactly the spec's fields,
  // and the assertions must cover exactly those env vars. If a field is added
  // to or removed from config_spec.yaml without updating this round-trip, fail
  // here so a new operator setting can never ship with its mapping unchecked.
  const specKeys = specFieldKeys().sort();
  const payloadKeys = Object.keys(OPERATOR_VALUES).sort();
  if (JSON.stringify(specKeys) !== JSON.stringify(payloadKeys)) {
    const missing = specKeys.filter((k) => !payloadKeys.includes(k));
    const extra = payloadKeys.filter((k) => !specKeys.includes(k));
    fail(
      "OPERATOR_VALUES is out of sync with assets/config_spec.yaml.\n" +
        (missing.length ? `  spec fields not in the payload: ${missing.join(", ")}\n` : "") +
        (extra.length ? `  payload keys not in the spec: ${extra.join(", ")}\n` : "") +
        "Update OPERATOR_VALUES + EXPECTED_ENV/EXPECTED_UNSET in this script to cover the new field set.",
    );
  }
  const assertedEnv = new Set([
    ...Object.keys(EXPECTED_ENV),
    ...EXPECTED_UNSET,
  ]);
  const expectedEnvNames = new Set(specKeys.map((k) => k.replace(/-/g, "_").toUpperCase()));
  for (const name of expectedEnvNames) {
    if (!assertedEnv.has(name)) {
      fail(
        `spec field maps to env var ${name}, but neither EXPECTED_ENV nor ` +
          "EXPECTED_UNSET asserts it. Add an assertion for the new field.",
      );
    }
  }

  try {
    // 1. config get — render the Config screen defaults. We don't assert the
    //    shape (that's the OS front end), but a non-zero exit means the spec is
    //    malformed and would break the real Config screen, so we fail on it.
    log("running `compat config get` against assets/config_spec.yaml ...");
    const get = docker([
      "run", "--rm",
      "-v", `${dataDir}:/root`,
      "-v", `${assetsDir}:/mnt/assets`,
      "--entrypoint", "compat", IMAGE,
      "config", "get", "/root", "/mnt/assets/config_spec.yaml",
    ]);
    if (get.error || get.status !== 0) {
      fail(`compat config get failed (spec rejected by the real tool):\n${get.stderr || get.stdout}`);
    }

    // 2. config set — write the operator's choices, exactly as the Config
    //    screen Save does: compat serialises the payload (quoting colon-bearing
    //    scalars) and writes /root/start9/config.yaml.
    log("running `compat config set` with operator choices ...");
    const set = docker([
      "run", "--rm", "-i",
      "-v", `${dataDir}:/root`,
      "-v", `${assetsDir}:/mnt/assets`,
      "--entrypoint", "compat", IMAGE,
      "config", "set", "void", "/root", "/mnt/assets/config_rules.yaml",
    ], { input: OPERATOR_INPUT });
    if (set.error || set.status !== 0) {
      fail(`compat config set failed (rules rejected the operator input):\n${set.stderr || set.stdout}`);
    }

    // 3. Read back the bytes the tool wrote (root-owned -> read via container).
    log("reading the config.yaml the tool wrote ...");
    const cat = docker([
      "run", "--rm",
      "-v", `${dataDir}:/root`,
      "--entrypoint", "cat", IMAGE,
      "/root/start9/config.yaml",
    ]);
    if (cat.error || cat.status !== 0 || !cat.stdout) {
      fail(`could not read /root/start9/config.yaml after config set:\n${cat.stderr}`);
    }
    const compatConfig = cat.stdout;
    log("compat wrote:\n" + compatConfig.replace(/^/gm, "    "));

    // 4. Feed those exact bytes through the production entrypoint with a clean
    //    env (so the parent shell's PAYWALL_JITTER_DISABLE
    //    cannot mask the false->"0" mapping via the OS-precedence rule) and a
    //    stub server that dumps the resolved process.env.
    const entryDir = path.join(work, "entry");
    mkdirSync(path.join(entryDir, "dist"), { recursive: true });
    const entrypointCopy = path.join(entryDir, "docker_entrypoint.mjs");
    writeFileSync(entrypointCopy, readFileSync(ENTRYPOINT_SRC));
    writeFileSync(
      path.join(entryDir, "dist", "index.mjs"),
      `process.stdout.write(${JSON.stringify(ENV_MARKER)} + JSON.stringify(process.env) + "\\n");\n`,
    );
    const cfgPath = path.join(entryDir, "config.yaml");
    writeFileSync(cfgPath, compatConfig);

    log("running deploy/startos/docker_entrypoint.mjs against those bytes ...");
    const run = spawnSync(process.execPath, [entrypointCopy], {
      env: { PATH: process.env["PATH"] ?? "", VOID_STARTOS_CONFIG: cfgPath },
      encoding: "utf8",
    });
    if (run.status !== 0) {
      fail(`entrypoint exited non-zero:\n${run.stderr}`);
    }
    const line = run.stdout.split(/\r?\n/).find((l) => l.startsWith(ENV_MARKER));
    if (!line) fail("stub server did not emit the env marker");
    const env = JSON.parse(line.slice(ENV_MARKER.length));

    // 5. Assert the mapping.
    const problems = [];
    for (const [k, want] of Object.entries(EXPECTED_ENV)) {
      if (env[k] !== want) {
        problems.push(`${k}: expected ${JSON.stringify(want)}, got ${JSON.stringify(env[k])}`);
      }
    }
    for (const k of EXPECTED_UNSET) {
      if (k in env) {
        problems.push(`${k}: expected to be unset (compat wrote \`~\`), got ${JSON.stringify(env[k])}`);
      }
    }
    if (problems.length) {
      fail(
        "config_spec.yaml and docker_entrypoint.mjs have drifted apart:\n  - " +
          problems.join("\n  - ") +
          "\nRe-check assets/config_spec.yaml against deploy/startos/docker_entrypoint.mjs " +
          "(and refresh the CAPTURED_COMPAT_CONFIG fixture in startos-entrypoint.test.ts).",
      );
    }

    log(`OK: ${Object.keys(EXPECTED_ENV).length} env vars mapped, ${EXPECTED_UNSET.length} nullable(s) skipped, real-tool round-trip matches the entrypoint.`);
  } finally {
    cleanupDataDir(dataDir);
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

main();
