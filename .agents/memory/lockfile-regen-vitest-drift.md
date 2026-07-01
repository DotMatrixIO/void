---
name: lockfile regen breaks vitest peer resolution
description: Why a fresh pnpm-lock.yaml rebuild fails void-client-tests even with a version-neutral diff, and the packageExtensions fix that makes it land green.
---

# Lockfile regen drill — vitest peer-resolution drift

Deleting `pnpm-lock.yaml` and running a fresh `pnpm install` produces a
**version-neutral** diff (no package added/removed/bumped; `vite` stays pinned
at 7.3.2) **yet still broke** `void-client-tests`:

```
Error: Cannot find package 'vitest' imported from
  node_modules/.pnpm/@testing-library+jest-dom@.../jest-dom/dist/vitest.mjs
```

`@testing-library/jest-dom/vitest` (imported in `void-client/src/test/setup.ts`,
the only jest-dom consumer in the repo) imports `vitest`, but jest-dom does not
declare `vitest` in its manifest. Under strict pnpm isolation a fresh tree won't
hoist `vitest` into jest-dom's resolution scope, so the import fails.

**Why this matters:** a clean-looking version-neutral lockfile diff is NOT proof
the rebuild is safe — the resolved node_modules layout can still break a merge
gate. This is exactly what the regen drill exists to catch.

## The fix (idiomatic, minimal)

Add a `pnpm.packageExtensions` entry in the root `package.json` declaring
`vitest` as an **optional peer** of `@testing-library/jest-dom`:

```json
"packageExtensions": {
  "@testing-library/jest-dom": {
    "peerDependencies": { "vitest": "*" },
    "peerDependenciesMeta": { "vitest": { "optional": true } }
  }
}
```

**Why:** `packageExtensions` is pnpm's mechanism for patching third-party
manifest gaps without forking. Optional peer (not a hard dep) is the right shape
— it wires resolution only when vitest is present, never pulls vitest into
non-test consumers. Do NOT try to fix this with a `pnpm-workspace.yaml`
override/catalog; the problem is a missing peer relationship, not a version pin.

**How to apply:** after editing, regenerate the lockfile and confirm
`void-client-tests` goes green. The regen diff stays version-neutral (just the
checksum line + jest-dom peer wiring + a cosmetic `vitest@4.1.4` snapshot-key
normalization).

## Attributing reds in the drill (regen-caused vs not)

A regen-caused break is a **module-resolution error** (the signature above).
Behavioral/content reds are almost never lockfile-caused — check before
reverting:
- A flaky WebRTC E2E test in `api-server-tests` passes on isolated re-run.
- `marketing-voice` `check:onion-mirror-sync` failing on a dangling doc
  cross-reference is content drift from a merged task, not the lockfile.

Full `void-client-tests` (build + ~1000 tests) exceeds a 120s bash timeout and
nohup background runs get reaped — run it via the managed `void-client-tests`
workflow (restart_workflow) and read its log. Drill log lives at
`docs/lockfile-regen-drill.md` (most-recent-first); launch checklist §0.5 cites
it by name.
