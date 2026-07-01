---
name: StartOS compat real-tool verification
description: How to verify the StartOS config_spec round-trip against the REAL packaging tool (not a stand-in) in this environment.
---

# Verifying StartOS settings against the real `compat` tool

**Key fact:** this Replit environment has a working Docker daemon (it can pull
and run images). The StartOS packaging tool the manifest's `config.get`/
`config.set` procedures invoke is published as **`start9/compat:latest`** on
Docker Hub (the `start9/x_system/compat` path is private/denied; `start9/compat`
is public). So the config round-trip can be checked against the real binary —
no `start-sdk` and no StartOS device needed for *this* half.

**Reproduce (real tool):**
```
docker pull start9/compat:latest
# spec render (what the Config screen shows) — empty data dir:
docker run --rm -v DATA:/root -v ASSETS:/mnt/assets --entrypoint compat \
  start9/compat:latest config get /root /mnt/assets/config_spec.yaml
# write operator choices (stdin), like the Config screen Save:
docker run --rm -i -v DATA:/root -v ASSETS:/mnt/assets --entrypoint compat \
  start9/compat:latest config set void /root /mnt/assets/config_rules.yaml < operator.yaml
# compat writes DATA/start9/config.yaml ; feed those bytes to the entrypoint:
VOID_STARTOS_CONFIG=DATA/start9/config.yaml node deploy/startos/docker_entrypoint.mjs
```

**Real-tool byte conventions (differ from a naive stand-in):**
- Leading `---`; flat `key: value`, no nesting.
- compat **double-quotes only colon-bearing values** (URLs) on output, even if
  you fed them unquoted; hex/alnum secrets, numbers, booleans stay unquoted.

**`compat config set` is a serialiser, NOT a validator/normaliser (verified
2026-06-12 against start9/compat:latest):**
- It does **NOT** validate the payload against the spec — bad patterns,
  out-of-range numbers, invalid enum values, and unknown keys all pass straight
  through with exit 0. Spec validation is the StartOS **UI** front end, not
  compat. So don't expect this round-trip to catch a tightened pattern/enum.
- It does **NOT** fill spec defaults or normalise unset nullables to `~` from a
  *partial* input — it just echoes the keys you give it. The `~` markers and the
  baked-in `ntfy_server: "https://ntfy.sh"` in a real config.yaml come from the
  **complete** Config-screen Save payload (the UI builds defaults+`~`), not from
  compat. To reproduce faithfully, feed the **full** field set (`~` for every
  unset nullable, the spec default for fields like ntfy_server).

**Automated as a validation step:** `artifacts/api-server/scripts/smoke-startos-compat.mjs`
(pnpm `smoke:startos-compat`, validation name `startos-compat`) does the whole
round-trip and asserts the env mapping; skips exit-0 when Docker is unavailable.

**Config RULES grammar (`config_rules.yaml`, verified against the real tool):**
- **References are kebab-case ONLY:** `#field` (number), `'field` (string —
  leading single-quote prefix, NO closing quote). An underscore key reference
  (`#paywall_jitter_min_ms`) fails to parse → this is why the spec keys were
  migrated snake_case→kebab-case (entrypoint then does `key.replace(/-/g,"_")
  .toUpperCase()`, so env var names are unchanged).
- **Operators:** `=`, `!=`, single-char `<`/`>` only (NO `<=`/`>=` — `#a <= #b`
  fails at the `=`); `!( ... )` negation; UPPERCASE `AND`/`OR`/`XOR`.
- **YAML gotcha:** a rule scalar starting with `#` is a YAML comment unless
  double-quoted — always quote rules in the file.
- **null is unequal to every string literal:** `'field != ""` is TRUE for an
  unset nullable (null), `'field = ""` is FALSE. So "required-when" rules for
  nullable strings can't reject the realistic blank→null case — keep those as
  runtime fail-closed guards. Numeric (non-nullable) cross-field rules like
  `!(#paywall-jitter-min-ms > #paywall-jitter-max-ms)` ARE cleanly verifiable.
- Reproduce reject/accept: `config get` then `config set` (or set alone), with
  explicit `key: null` in operator input to reproduce the `~` lines (omitting a
  nullable key entirely → omitted from output, not `~`, in current compat).

**Still genuinely gated on operator hardware:** full `.s9pk` build via
`start-sdk`, the StartOS **web-UI** Config-screen render (masked widgets, enum
dropdowns, pattern messages — that's the OS front end, not compat), and the
in-container on-hardware `process.env` spot-check.

**Gotchas:** docker writes the data dir as root → clean temp via a container
(`docker run --rm -v /tmp:/host alpine rm -rf ...`). When running the entrypoint
to inspect mapping, use a clean env (`env -i PATH=... VOID_STARTOS_CONFIG=...`)
— the parent shell here already has `ENABLE_AGENT_ROOMS`/`PAYWALL_JITTER_DISABLE`
set, and the entrypoint's OS-precedence rule will (correctly) not override them,
masking the false→"0" mapping.
