// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Round-trips a StartOS `config.yaml` through the real
// `deploy/startos/docker_entrypoint.mjs` and asserts the environment variables
// the API server ends up reading. This automates a one-off manual verification
// pass so a regression in the
// config-screen -> env-var mapping (a boolean that stops becoming "1"/"0", an
// empty optional that starts clobbering a server default, a lost OS-env
// precedence guard) is caught in CI instead of silently misconfiguring every
// StartOS install.
//
// The primary fixture (CAPTURED_COMPAT_CONFIG) is NOT hand-reconstructed: it is
// the verbatim byte output of the *real* StartOS packaging tool. It was
// produced by running `compat config set` (the same binary the manifest's
// `config.set` procedure invokes) from the published `start9/compat` image
// against the shipped `assets/config_spec.yaml`, then copying the file the tool
// wrote to `/root/start9/config.yaml`. This closes an earlier caveat — that the
// round-trip had only ever been checked against a representative stand-in, never
// against bytes the real `compat config set` emits. To regenerate after a spec
// change:
//
//   docker pull start9/compat:latest
//   compat config get  /root /mnt/assets/config_spec.yaml      # render defaults
//   compat config set  void  /root /mnt/assets/config_rules.yaml < operator.yaml
//   cat /root/start9/config.yaml   # <- paste below verbatim
//
// The entrypoint runs its mapping at module load and then `await import`s the
// real server (`./dist/index.mjs`). To exercise the mapping in isolation we
// copy the entrypoint's actual bytes into a temp dir alongside a stub
// `dist/index.mjs` that dumps `process.env`, then run it as a child process
// with the `VOID_STARTOS_CONFIG` override the entrypoint already honours — the
// same harness shape §8.1 describes.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRYPOINT_SRC = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../deploy/startos/docker_entrypoint.mjs",
);
const SPEC_SRC = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../assets/config_spec.yaml",
);

const ENV_MARKER = "__VOID_ENV__";

let workDir: string;
let entrypointCopy: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "void-startos-entry-"));
  // Copy the *real* entrypoint bytes — we test the shipped logic, not a fork.
  entrypointCopy = join(workDir, "docker_entrypoint.mjs");
  writeFileSync(entrypointCopy, readFileSync(ENTRYPOINT_SRC));
  // Stub the server the entrypoint hands off to: dump the resolved env so the
  // test can read exactly what the server would have seen.
  mkdirSync(join(workDir, "dist"), { recursive: true });
  writeFileSync(
    join(workDir, "dist", "index.mjs"),
    `process.stdout.write(${JSON.stringify(ENV_MARKER)} + JSON.stringify(process.env) + "\\n");\n`,
  );
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Run the entrypoint copy against the given config text (or no file, when
 * `configText` is null) with an isolated child env, and return the env the
 * stub server received plus the entrypoint's stderr notices.
 */
function runEntrypoint(
  configText: string | null,
  overrides: Record<string, string> = {},
): { env: Record<string, string>; stderr: string } {
  const childEnv: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    ...overrides,
  };
  if (configText === null) {
    childEnv["VOID_STARTOS_CONFIG"] = join(workDir, "does-not-exist.yaml");
  } else {
    const cfgPath = join(workDir, "config.yaml");
    writeFileSync(cfgPath, configText);
    childEnv["VOID_STARTOS_CONFIG"] = cfgPath;
  }

  const res = spawnSync(process.execPath, [entrypointCopy], {
    env: childEnv,
    encoding: "utf8",
  });
  expect(res.status, `entrypoint exited non-zero: ${res.stderr}`).toBe(0);
  const line = res.stdout
    .split(/\r?\n/)
    .find((l) => l.startsWith(ENV_MARKER));
  expect(line, "stub server did not emit env marker").toBeTruthy();
  const env = JSON.parse((line as string).slice(ENV_MARKER.length));
  return { env, stderr: res.stderr };
}

/**
 * Run the entrypoint copy against a config that is expected to abort boot, and
 * return the exit status and stderr without asserting success. Mirrors
 * `runEntrypoint`'s child-env isolation.
 */
function runEntrypointExpectingFailure(configText: string): {
  status: number | null;
  stderr: string;
} {
  const cfgPath = join(workDir, "config.yaml");
  writeFileSync(cfgPath, configText);
  const res = spawnSync(process.execPath, [entrypointCopy], {
    env: { PATH: process.env["PATH"] ?? "", VOID_STARTOS_CONFIG: cfgPath },
    encoding: "utf8",
  });
  return { status: res.status, stderr: res.stderr };
}

// Verbatim bytes written by the real `compat config set` (start9/compat image)
// for assets/config_spec.yaml — NOT a hand-reconstruction. See the file header
// for how this was captured. The
// operator input that produced it set a non-default enum, a masked hex secret,
// colon-bearing URLs (which the tool quotes), plain alphanumeric secrets (which
// it leaves unquoted), numbers, booleans true/false, and left every other
// nullable unset. The real tool normalises every unset nullable to `~` (it does
// not emit `""` or `null`) and bakes a field's spec default into the file when
// the operator does not override it (note `ntfy_server` below).
const CAPTURED_COMPAT_CONFIG = `---
lightning-backend: lnbits
paywall-secret: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
lnbits-url: "https://lnbits.example.onion"
lnbits-api-key: abc123def456
btcpay-url: ~
btcpay-api-key: ~
btcpay-store-id: ~
turn-url: "turns:relay.example.onion:5349"
turn-secret: supersecretturnvalue
turn-credential-ttl: 4500
stun-url: ~
trust-proxy-hops: 2
log-level: info
tor-only: true
paywall-jitter-min-ms: 10000
paywall-jitter-max-ms: 60000
paywall-jitter-disable: false
ntfy-topic: ~
ntfy-server: "https://ntfy.sh"
ntfy-token: ~
`;

describe("StartOS docker_entrypoint config round-trip (real compat output)", () => {
  it("passes scalars through and stringifies numbers", () => {
    const { env } = runEntrypoint(CAPTURED_COMPAT_CONFIG);
    // enum
    expect(env["LIGHTNING_BACKEND"]).toBe("lnbits");
    // masked hex string (compat leaves it unquoted)
    expect(env["PAYWALL_SECRET"]).toBe(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    // colon-bearing URL -> compat double-quotes it -> entrypoint strips quotes
    expect(env["LNBITS_URL"]).toBe("https://lnbits.example.onion");
    expect(env["TURN_URL"]).toBe("turns:relay.example.onion:5349");
    // plain alphanumeric secret -> compat leaves unquoted -> passes through
    expect(env["LNBITS_API_KEY"]).toBe("abc123def456");
    expect(env["TURN_SECRET"]).toBe("supersecretturnvalue");
    // numbers stringify
    expect(env["TURN_CREDENTIAL_TTL"]).toBe("4500");
    expect(env["TRUST_PROXY_HOPS"]).toBe("2");
    expect(env["PAYWALL_JITTER_MIN_MS"]).toBe("10000");
    expect(env["PAYWALL_JITTER_MAX_MS"]).toBe("60000");
  });

  it("maps booleans to the '1'/'0' the server tests for", () => {
    const { env } = runEntrypoint(CAPTURED_COMPAT_CONFIG);
    expect(env["TOR_ONLY"]).toBe("1");
    expect(env["PAYWALL_JITTER_DISABLE"]).toBe("0");
  });

  it("skips compat's `~` null markers so server fallbacks apply", () => {
    const { env } = runEntrypoint(CAPTURED_COMPAT_CONFIG);
    // Every nullable the operator left unset is `~` in real compat output.
    for (const k of [
      "BTCPAY_URL",
      "BTCPAY_API_KEY",
      "BTCPAY_STORE_ID",
      "STUN_URL",
      "NTFY_TOPIC",
      "NTFY_TOKEN",
    ]) {
      expect(k in env, `${k} should be unset (compat wrote \`~\`)`).toBe(false);
    }
  });

  it("applies a field's baked-in spec default (compat writes it to the file)", () => {
    // ntfy_server was not overridden, so compat wrote its spec default into the
    // config file rather than `~`; the entrypoint therefore sets the env var.
    const { env } = runEntrypoint(CAPTURED_COMPAT_CONFIG);
    expect(env["NTFY_SERVER"]).toBe("https://ntfy.sh");
  });

  it("does not override an env var already set in the OS environment", () => {
    const { env } = runEntrypoint(
      `turn-secret: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n`,
      { TURN_SECRET: "preset-by-operator" },
    );
    expect(env["TURN_SECRET"]).toBe("preset-by-operator");
  });

  it("treats a pre-set but empty OS env var as overridable", () => {
    const { env } = runEntrypoint(`log-level: debug\n`, { LOG_LEVEL: "" });
    expect(env["LOG_LEVEL"]).toBe("debug");
  });

  it("applies nothing and logs the defaults notice when the config file is missing", () => {
    const { env, stderr } = runEntrypoint(null);
    expect("LIGHTNING_BACKEND" in env).toBe(false);
    expect("TOR_ONLY" in env).toBe(false);
    expect(stderr).toContain("starting on environment/Dockerfile defaults");
  });
});

// Defensive parser coverage for YAML scalar forms the real `compat config set`
// does NOT emit for this spec (it normalises unset nullables to `~` and quotes
// only colon-bearing values), but which the entrypoint's hand-rolled reader is
// written to tolerate so a future packaging-tool change cannot silently break
// the mapping. These are intentionally hand-written, not captured output.
describe("StartOS docker_entrypoint parser tolerance (non-compat forms)", () => {
  it("strips single quotes and treats `null` / `\"\"` as skip", () => {
    const { env } = runEntrypoint(
      [
        "lnbits-api-key: 'single-quoted-value'",
        "ntfy-token: null",
        'ntfy-server: ""',
        "btcpay-url: NULL",
        "",
      ].join("\n"),
    );
    expect(env["LNBITS_API_KEY"]).toBe("single-quoted-value");
    expect("NTFY_TOKEN" in env).toBe(false);
    expect("NTFY_SERVER" in env).toBe(false);
    expect("BTCPAY_URL" in env).toBe(false);
  });
});

// Defense-in-depth: if a config file ever contains a nested/indented structure
// (a hand-edited file, or a spec change that grows an object/list/union/pointer
// field and slips past the shape guard above), the flat reader cannot represent
// it. Rather than boot with that operator setting silently dropped, the
// entrypoint must abort loudly. These assert it exits non-zero with a message
// that names the offending field and points at the entrypoint to fix.
describe("StartOS docker_entrypoint rejects nested config instead of dropping it", () => {
  it("exits non-zero with a descriptive error on an indented/nested value", () => {
    const { status, stderr } = runEntrypointExpectingFailure(
      ["lightning_backend: lnbits", "btcpay:", "  url: https://btcpay.onion", ""].join(
        "\n",
      ),
    );
    expect(status, `expected non-zero exit, got ${status}: ${stderr}`).not.toBe(0);
    expect(stderr).toContain("nested/indented value");
    // The message must name the field that owns the nested value...
    expect(stderr).toContain('"btcpay"');
    // ...and point the operator/maintainer at the reader to teach the shape.
    expect(stderr).toContain("docker_entrypoint.mjs");
  });

  it("aborts even when the nested value follows valid scalar settings", () => {
    const { status, stderr } = runEntrypointExpectingFailure(
      [
        "lightning_backend: lnbits",
        "turn_secret: supersecretturnvalue",
        "stun:",
        "  - url: stun:stun.example.onion:3478",
        "",
      ].join("\n"),
    );
    expect(status, `expected non-zero exit, got ${status}: ${stderr}`).not.toBe(0);
    expect(stderr).toContain("nested/indented value");
    expect(stderr).toContain('"stun"');
  });
});

// Drift guard: the representative fixture and the assertions above are written
// against the field set in assets/config_spec.yaml. If a field is added to or
// removed from the spec, this fails so the round-trip test is updated in step
// (otherwise a new operator setting could ship with no coverage of its
// mapping).
describe("StartOS config_spec field set stays in sync with the test", () => {
  const EXPECTED_SPEC_FIELDS = [
    "lightning-backend",
    "paywall-secret",
    "lnbits-url",
    "lnbits-api-key",
    "btcpay-url",
    "btcpay-api-key",
    "btcpay-store-id",
    "turn-url",
    "turn-secret",
    "turn-credential-ttl",
    "stun-url",
    "trust-proxy-hops",
    "log-level",
    "tor-only",
    "paywall-jitter-min-ms",
    "paywall-jitter-max-ms",
    "paywall-jitter-disable",
    "ntfy-topic",
    "ntfy-server",
    "ntfy-token",
  ].sort();

  function specFieldKeys(): string[] {
    const text = readFileSync(SPEC_SRC, "utf8");
    const keys: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      // Top-level field definitions only: a key at column 0 with an empty
      // value (the field's properties follow indented). Comments and indented
      // lines (type/values/etc.) are ignored. Keys are kebab-case.
      const m = line.match(/^([a-z0-9-]+):\s*$/);
      if (m) keys.push(m[1]);
    }
    return keys.sort();
  }

  it("matches the spec's top-level field keys exactly", () => {
    expect(specFieldKeys()).toEqual(EXPECTED_SPEC_FIELDS);
  });

  it("uppercases every spec field key to a distinct env var name", () => {
    const fields = specFieldKeys();
    const envNames = new Set(
      fields.map((k) => k.replace(/-/g, "_").toUpperCase()),
    );
    expect(envNames.size).toBe(fields.length);
  });
});

// Shape guard: the entrypoint's reader (parseFlatYaml in
// deploy/docker_entrypoint.mjs) only understands a flat map of scalar
// `key: value` pairs and *silently skips* any indented/nested line. That is
// safe only as long as every spec field declares a scalar StartOS type, since
// `compat config set` emits those as a single scalar line. A field typed
// `object`, `list`, `union`, or `pointer` would be written as nested YAML, the
// entrypoint would drop it without warning, and the field-set drift guard above
// (which only compares top-level key names) would not catch the shape change.
//
// This guard fails the moment such a field is added, forcing the entrypoint
// reader to be taught the new shape before the operator setting can ship.
describe("StartOS config_spec declares only flat scalar field types", () => {
  // StartOS config types whose `compat config set` output is a single scalar
  // line the flat reader can parse. Everything else (object/list/union/pointer)
  // produces nested YAML the entrypoint cannot handle.
  const SCALAR_TYPES = new Set(["string", "number", "boolean", "enum"]);

  function specFieldTypes(): {
    types: Record<string, string>;
    fields: string[];
  } {
    const text = readFileSync(SPEC_SRC, "utf8");
    const types: Record<string, string> = {};
    const fields: string[] = [];
    let currentField: string | null = null;
    for (const line of text.split(/\r?\n/)) {
      const fieldMatch = line.match(/^([a-z0-9-]+):\s*$/);
      if (fieldMatch) {
        currentField = fieldMatch[1];
        fields.push(currentField);
        continue;
      }
      // First `type:` line indented under the current field.
      const typeMatch = line.match(/^\s+type:\s*(\S+)\s*$/);
      if (typeMatch && currentField && !(currentField in types)) {
        types[currentField] = typeMatch[1];
      }
    }
    return { types, fields: fields.sort() };
  }

  it("assigns every top-level field a recognised type", () => {
    const { types, fields } = specFieldTypes();
    // Every field key must have resolved a `type:` line.
    expect(Object.keys(types).sort()).toEqual(fields);
  });

  it("uses only scalar types the flat-YAML entrypoint reader can parse", () => {
    const { types } = specFieldTypes();
    const nonScalar = Object.entries(types).filter(
      ([, t]) => !SCALAR_TYPES.has(t),
    );
    expect(
      nonScalar,
      `non-scalar config_spec field types the entrypoint reader cannot parse: ${nonScalar
        .map(([k, t]) => `${k}:${t}`)
        .join(", ")}. Teach deploy/startos/docker_entrypoint.mjs the nested shape before adding it.`,
    ).toEqual([]);
  });
});
