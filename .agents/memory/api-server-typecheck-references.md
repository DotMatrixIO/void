---
name: api-server typecheck & composite references
description: Why a workspace consumer's bare `tsc -p --noEmit` reads stale lib types, and the robust fix.
---

A consumer that lists `references` to a composite workspace lib (emitDeclarationOnly,
outDir dist) resolves that import to the lib's **declaration output** (`dist/*.d.ts`),
NOT its source — even though the package `exports` map points `.` → `./src/index.ts`.

**Symptom:** `pnpm run typecheck` (bare `tsc -p tsconfig.json --noEmit`) fails with
TS2724 "no exported member …" / TS2322 for symbols that clearly exist in the lib's
`src/generated.ts`, because the committed `dist/*.d.ts` is stale. Delete the dist and
it flips to TS6305 "Output file … has not been built from source file …".

**Why `tsc -b` is NOT a robust fix here:** build mode's up-to-date check is **mtime**
based (`--verbose` prints "Project … is up to date because newest input X is older
than output tsbuildinfo"). In a fresh checkout / after restoring committed artifacts,
the committed `tsbuildinfo`/`dist` mtimes can look newer than source, so it skips
rebuilding and keeps reading stale types. `dist` + `*.tsbuildinfo` are gitignored, so
their freshness in any given checkout is non-deterministic.

**Fix:** drop the `references` array from the consumer's tsconfig. With no references,
`tsc` resolves the dep through the package `exports` map straight to `./src/index.ts`
and reads **source** — always fresh, no dist, no tsbuildinfo, no mtime games.
**Why safe:** api-server is bundled by esbuild (`build.mjs`) and typechecked with
`--noEmit`; nothing builds it via `tsc -b`, so references served no purpose except to
trigger this stale-output read.

**How to apply:** for a `--noEmit` typecheck of a non-composite consumer in this
monorepo, prefer no `references` + bare `tsc -p`. Contrast: void-client keeps
references but runs `tsc -b` (and so happens to rebuild deps) — viable but fragile for
the mtime reason above. Each artifact typecheck should have its own validation
workflow (isValidation=true) so it can't silently regress.
