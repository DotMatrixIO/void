---
name: void-client typecheck gate
description: How void-client app type errors are gated in CI, and why the script uses tsc -b (build refs)
---

The void-client app now HAS a typecheck CI gate: the `void-client-typecheck`
validation workflow runs `pnpm --filter @workspace/void-client run typecheck`,
mirroring `sdk-typecheck`. Before it existed, app `tsc` errors shipped silently
because `void-client-tests` builds with Vite (esbuild transpile, no type-check)
and the only typecheck gate was `sdk-typecheck` (for `lib/void-agent-sdk`).

**Rule:** the void-client `typecheck` script is `tsc -b` (build mode), NOT
`tsc -p tsconfig.json --noEmit`.

## void-client typecheck must build its project references (`tsc -b`, not `tsc -p`)

void-client `tsconfig.json` has `references` to the composite libs
`lib/signaling-types` and `lib/api-client-react`. TS project references resolve
imports of those packages to their **built `dist/*.d.ts`**, not the source —
even though the package `exports` point at `./src/index.ts` (the source path is
only used at runtime/Vite). The repo-wide `pnpm run typecheck` sidesteps this by
running `typecheck:libs` (`tsc --build`) first, but a standalone filtered run
(what the CI gate does) must build its own refs.

**Consequence:** a plain `tsc -p tsconfig.json --noEmit` does NOT build the refs;
it validates against whatever `dist` already exists. A **stale `dist`** (built
before the spec changed) silently hides newly-added generated types — e.g. a
`burn-room` event added to `asyncapi.yaml` + regenerated `signaling-types/src/generated.ts`
is present in source but missing from the stale `dist`, so the void-client emit
call fails to typecheck against the action union. A **missing `dist`** gives
`TS6305` ("output ... has not been built from source"). Both `dist` and the
`*.tsbuildinfo` are gitignored.

**Fix / rule:** void-client's `typecheck` script is `tsc -b tsconfig.json` (build
mode), which rebuilds the composite refs from current source before checking, so
the consumed types are always fresh. `tsc -b` still fully type-checks void-client
(it respects `noEmit` for the root project and reports app errors). Do NOT revert
it to `tsc -p`. Do not "fix" a missing generated event by hand-adding it to
`src/lib/socket.ts`'s `ClientToServerEventsExtended` if it's already in
`asyncapi.yaml` — that intersection is only for events NOT yet in the spec;
rebuild the refs instead.

**Footgun:** `tsc -b` reads `tsconfig.tsbuildinfo` and a stale tsbuildinfo makes
it skip rebuilding (thinks it's up to date). Fresh checkouts (neither `dist` nor
tsbuildinfo present) build cleanly; only manual `rm -rf dist` *alone* triggers a
spurious `TS6305` — also delete the sibling `tsconfig.tsbuildinfo` in that case.

**How to apply:** after editing any void-client TS, the gate covers you, but you
can still run `pnpm --filter @workspace/void-client run typecheck` locally.

## Test files are now type-checked too (separate tsconfig.test.json)

The `typecheck` script is now `typecheck:libs && tsc -b tsconfig.json && tsc -p tsconfig.test.json`.
`tsconfig.json` excludes test files (so the app build stays clean); `tsconfig.test.json`
extends it but overrides `exclude` to only `["node_modules","build","dist"]` so `*.test.ts(x)`
files ARE checked. This catches arg/prop drift in tests at typecheck time, not just runtime.

**Why:** outdated tests with wrong/missing helper args used to pass typecheck (excluded) and
only fail at runtime. Now object-literal extra/missing props in helper calls (e.g.
`runRelayFlipHandshake({...})`, component props) fail `tsc -p tsconfig.test.json`.

**How to apply:** when editing void-client tests, run the full `typecheck` script — the second
`tsc -p tsconfig.test.json` pass is the one that gates test files. Test mocks that intentionally
diverge from real types need explicit `as unknown as <Type>` casts (e.g. socket.io `Socket`
mocks, scheduler mocks using `typeof setTimeout`, fake RTCDataChannel `__peer`). A `.mjs` script
imported by a test needs a sibling `.d.mts` declaration (resolution drops `.mjs`→`.mts`/`.d.mts`).
