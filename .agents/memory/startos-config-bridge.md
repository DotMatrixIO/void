---
name: StartOS config bridge
description: How VOID exposes operator env vars through the StartOS Config screen (0.3.5 compat approach)
---

# StartOS config bridge

VOID's `manifest.yaml` is a StartOS 0.3.5.x (compat) package, NOT a 0.4 TS SDK
package. StartOS does not inject env vars docker-compose-style. To let operators
set Lightning/TURN/secrets through the StartOS **Config** screen, four pieces
work together:

- `assets/config_spec.yaml` — the field definitions StartOS renders. One field
  per operator env var; field keys are the lowercase of the env var.
- `assets/config_rules.yaml` — **empty list `[]` by design.** Cross-field
  requirements stay enforced fail-closed in the server (placeholder-secret
  startup aborts, backend-missing-creds fail at first invoice). An unverified
  compat rule expr risks blocking every config save, which is strictly worse.
- `deploy/startos/docker_entrypoint.mjs` — the `main` action's entrypoint.
  Reads `/root/start9/config.yaml` (written by `config set`), exports each
  field as UPPER_SNAKE_CASE env (bool→"1"/"0", empty/null skipped, existing OS
  env not overridden), then `import()`s `dist/index.mjs` in the **same process**
  (keeps SIGTERM drain intact). Dependency-free flat-YAML reader — adds no
  yq/YAML lib to the image.
- `manifest.yaml` — `config.get`/`config.set` run the StartOS `compat` system
  image; `main.entrypoint` points at the shim; needs `mounts: {main: /root}`
  and `volumes: {main: {type: data}, compat: {type: assets}}`.

**Why:** resolved the manifest-review §6.2 BLOCKER (no StartOS config UI).

**How to apply:** adding a new operator env var = add a field to config_spec
(+ doc the default that must match code). The entrypoint maps it automatically;
no shim edit needed unless the spec gains nested (non-flat) structures, which
the parser does NOT handle. Plain-Docker/Umbrel bypass all of this (Dockerfile
CMD + docker-compose env), so the shim must stay a no-op when config.yaml is
absent.

**Empty-string trap:** a quoted empty value (`stun_url: ""`) must be skipped,
not exported as an empty env var — order the entrypoint's value coercion so
both bare and quoted empties return null (use server default), else an empty
override can change server behavior.
