# Lockfile regeneration drill log

This file is the receipt for `LAUNCH-CHECKLIST.md` item 10 (v2 §0.5): the
supply-chain integrity drill. Delete the pnpm lockfile, regenerate it from
scratch via a fresh `pnpm install`, confirm the project still passes every
CI gate it merges on, and read the resulting diff.

Each drill appends one dated entry, **most-recent-first**, capturing: the
pre-drill commit, the regeneration date, an exit code for every gate
command run, a one-line diff summary, and the kept/reverted decision with
its reason.

It is **evidence**, not decoration. A reader should be able to tell at a
glance whether the lockfile can be rebuilt cleanly and whether the rebuild
introduced any dependency drift.

**Limit of this drill (do not over-read its closure):** it confirms the
lockfile regenerates and the project still builds/tests green. It does
**not** catch subtle behavioural changes in updated dependencies; those
surface in the dogfood log and launch-day operational protocol, not here.

All dates are ISO 8601 (`YYYY-MM-DD`).

---

## Log

- 2026-06-04 — **KEPT**. The regen-caused failure from the first run was
  root-caused and fixed: pnpm could not resolve
  `@testing-library/jest-dom`'s implicit `vitest` peer under a fresh tree,
  fixed with a `pnpm.packageExtensions` entry declaring it as an optional
  peer. A second drill the same day was kept: on the regenerated lockfile
  `pnpm install` (0), `pnpm run build` (0), `pnpm run typecheck` (0), and
  `void-client-tests` (0 — 1037 tests) all pass. The diff is
  version-neutral — no package added, removed, or bumped; `vite` held at
  7.3.2. Two unrelated reds were seen and dispositioned (a flaky WebRTC
  E2E test that passes on re-run, and a pre-existing `onion-mirror-sync`
  docs drift) — neither is lockfile-caused.
