---
name: pnpm overrides live in package.json, not pnpm-workspace.yaml
description: Where this repo's pnpm dependency-security overrides actually take effect, and the major-bump trap
---

In this workspace, pnpm reads dependency overrides from root `package.json` `pnpm.overrides` — NOT from the `overrides:` block in `pnpm-workspace.yaml`.

**Why it matters:** The `pnpm-workspace.yaml > overrides:` block (vite, lodash, picomatch, brace-expansion, postcss, plus the platform `'-'` removals) is silently inert — pnpm-lock.yaml's recorded `overrides:` only ever lists what's in `package.json` (path-to-regexp, ws, …). Editing `pnpm-workspace.yaml` overrides and re-running `pnpm install` prints "Lockfile is up to date, resolution step is skipped" and changes nothing — no error, no warning. To actually pin a transitive dep, add it to `package.json > pnpm.overrides` and run `pnpm install --no-frozen-lockfile`.

**How to apply:** Any task that needs a transitive version floor (CVE override) must edit `package.json > pnpm.overrides`. Parts of `docs/security-audit-internal-2026-04.md` narrate earlier overrides as living in `pnpm-workspace.yaml`; that points at the inert file — trust the lockfile's `overrides:` section for what is actually applied. (Possible tech-debt: consolidate the two locations.)

**Major-bump trap:** An open floor like `fast-uri@<3.1.2: ">=3.1.2"` resolves to the *latest* match — e.g. `fast-uri@4.0.0`, a major the consumer (`ajv@8.18.0`) doesn't declare. Cap to the patched line instead: `"^3.1.2"`. Verify the consumer's expected range and run the consumer's build/codegen (`pnpm --filter @workspace/api-spec run codegen`) after the bump.

**Versioned-selector key trap:** When *raising* an existing override whose key is a version selector (e.g. `ws@<8.20.1`), you must bump the KEY too, not just the value. A new patched floor `>=8.21.0` under the old key `ws@<8.20.1` won't match the installed vulnerable `8.20.1` (it's not `<8.20.1`), so the bump silently no-ops. Raise both: `ws@<8.21.0: ^8.21.0`. Confirm in `pnpm-lock.yaml`'s `overrides:` block + the resolved `pkg@x.y.z` entries after `pnpm install --no-frozen-lockfile`.

**Verify a CVE override the same way CI does:** `pnpm audit --json > /tmp/a.json` then `node scripts/audit/parse-audit.mjs --mode=fail < /tmp/a.json` ("Surfaced … 0" = no High/Crit); plus `node scripts/audit/ignore-list.drift.test.mjs` and `node scripts/regen-cve-appendix.mjs --strict`. Don't hand-regen the appendix mid-task (lockfile uncommitted). void-client/mockup-sandbox full `build` need env gates (VITE_VOID_ONION_HOST, PORT, BASE_PATH) — a build failure there is env, not your bump; typecheck + api-server build + a scoped void-client vitest cover the dep change.

**Audit/release gate context:** `node scripts/regen-cve-appendix.mjs --strict` is the release gate — it fails only on High/Critical advisories that pnpm audit actually surfaces AND have no `AUDIT_LEDGER` entry. Fixing a dep (override) removes the row entirely so the gate passes even without a ledger entry; ledger entries for fixed rows are pure traceability (won't render in the appendix). pnpm audit in this env serves advisories from a fixture DB, so even fictional 2026 CVEs really do surface/clear.
