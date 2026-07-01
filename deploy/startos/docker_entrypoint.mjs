// SPDX-License-Identifier: AGPL-3.0-or-later
//
// StartOS entrypoint shim for VOID.
//
// StartOS does not pass env vars to a container the way docker-compose does.
// Instead, the package's `config.set` procedure (the StartOS "Config" screen,
// driven by assets/config_spec.yaml) writes the operator's choices to
// `/root/start9/config.yaml` on the package data volume. This shim runs as the
// `main` action's entrypoint: it reads that file, exports each field as the
// UPPER_SNAKE_CASE environment variable the API server already consumes, then
// hands off to the real server (`dist/index.mjs`).
//
// Mapping rules (kept deliberately mechanical so the spec stays the single
// source of truth):
//   - field key `lightning-backend` -> env `LIGHTNING_BACKEND` (hyphens to
//     underscores, then uppercased). The spec uses kebab-case keys because that
//     is the only form the compat config-rule engine can reference (see
//     assets/config_rules.yaml); this conversion keeps the env var names the
//     server reads unchanged.
//   - boolean true  -> "1", boolean false -> "0" (the form the code tests for,
//     e.g. `process.env.PAYWALL_JITTER_DISABLE === "1"`).
//   - numbers       -> their string form.
//   - null / empty optional strings are skipped, so the server's own defaults
//     and fail-closed fallbacks apply unchanged.
//   - an env var already present in the process environment is NOT overwritten,
//     so an operator who also sets something via the OS still wins.
//
// The YAML produced by `compat config set` for this spec is a flat map of
// scalar `key: value` pairs (the spec declares no nested objects or unions), so
// a small dependency-free reader is sufficient and avoids adding a YAML library
// or a `yq` binary to the production image. If the spec ever grows nested
// fields this reader must grow with it — and to make that failure loud rather
// than silent, the reader throws (aborting boot with a non-zero exit) the
// moment it encounters an indented/nested line instead of quietly dropping the
// setting it cannot represent.

import { readFileSync } from "node:fs";

const CONFIG_PATH = process.env["VOID_STARTOS_CONFIG"] ?? "/root/start9/config.yaml";

/**
 * Parse the flat scalar subset of YAML that `compat config set` emits for this
 * spec. Returns a map of key -> { raw, value } where `value` is a string|null
 * with surrounding quotes stripped and YAML booleans/null recognised.
 *
 * Only top-level `key: value` lines are handled. Comments (`#`), blank lines,
 * and document markers (`---`) are ignored. An indented line (the YAML form of
 * a nested object/list/union value the flat reader cannot represent) is NOT
 * silently skipped: it throws so boot aborts loudly rather than starting with a
 * setting quietly missing — see the file header.
 */
function parseFlatYaml(text) {
  const out = {};
  let lastTopLevelKey = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;
    if (/^\s*#/.test(line)) continue;
    if (/^\s*---\s*$/.test(line)) continue;
    // An indented, non-blank, non-comment line is the nested value of the
    // preceding top-level field. The flat reader cannot represent it, so rather
    // than drop the operator's setting silently, fail loudly and name the field.
    if (/^\s/.test(line)) {
      const owner = lastTopLevelKey
        ? `field "${lastTopLevelKey}"`
        : "the document root";
      throw new Error(
        `cannot parse StartOS config at ${CONFIG_PATH}: ${owner} has a nested/indented value ` +
          `(line: ${JSON.stringify(line)}). The entrypoint's flat-YAML reader only understands ` +
          `scalar "key: value" settings; teach deploy/startos/docker_entrypoint.mjs the nested ` +
          `shape before this setting can be applied, rather than booting with it silently missing.`,
      );
    }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    lastTopLevelKey = key;
    let value = m[2];
    // Strip an inline comment that is not inside quotes (best effort: our
    // values are hex/URLs/enums/numbers with no '#').
    if (!/^["']/.test(value)) {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash);
    }
    value = value.trim();
    out[key] = value;
  }
  return out;
}

/** Convert a parsed YAML scalar string into the env-var string (or null to skip). */
function toEnvValue(raw) {
  // YAML null markers -> skip (server default applies).
  if (raw === "~" || raw === "null" || raw === "Null" || raw === "NULL") {
    return null;
  }
  // Booleans are emitted unquoted; map to the "1"/"0" the server tests for.
  if (raw === "true" || raw === "True" || raw === "TRUE") return "1";
  if (raw === "false" || raw === "False" || raw === "FALSE") return "0";
  // Strip a single layer of matching quotes.
  let value = raw;
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  // Empty (bare or quoted "") optional value -> skip so the server's own
  // default / fail-closed fallback applies rather than an empty override.
  if (value === "") return null;
  return value;
}

function applyConfig() {
  let text;
  try {
    text = readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    // No config file yet (first boot before the operator opens the Config
    // screen, or a non-StartOS launch). Fall through on Dockerfile/OS defaults.
    if (err && err.code === "ENOENT") {
      console.error(
        `[void] no StartOS config at ${CONFIG_PATH}; starting on environment/Dockerfile defaults`,
      );
      return;
    }
    throw err;
  }

  const parsed = parseFlatYaml(text);
  const applied = [];
  for (const [key, raw] of Object.entries(parsed)) {
    const envName = key.replace(/-/g, "_").toUpperCase();
    const value = toEnvValue(raw);
    if (value === null) continue;
    if (process.env[envName] !== undefined && process.env[envName] !== "") {
      continue; // already set in the OS env — do not override.
    }
    process.env[envName] = value;
    applied.push(envName);
  }
  console.error(
    `[void] applied ${applied.length} setting(s) from ${CONFIG_PATH}: ${applied.join(", ") || "(none)"}`,
  );
}

applyConfig();

// Hand off to the real server. Importing (rather than spawning) keeps a single
// process so StartOS signal handling and the server's own SIGTERM drain work
// unchanged.
await import(new URL("./dist/index.mjs", import.meta.url));
