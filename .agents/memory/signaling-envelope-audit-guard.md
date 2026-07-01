---
name: signaling-envelope audit guard
description: Adding/renaming any signaling socket event (or data-channel label) in void-client/api-server/sdk trips a guard that requires doc + whitelist updates in lockstep.
---

# signaling-envelope audit guard

Any new `socket.emit("x")` / `socket.on("x")` event name (or `createDataChannel` label)
in the scanned roots (`artifacts/void-client/src`, `artifacts/api-server/src`,
`lib/void-agent-sdk/src`) is rejected by `artifacts/void-client/scripts/check-signaling-envelope.mjs`
(run via the `marketing-voice` workflow / `pnpm --filter @workspace/void-client run check:signaling-envelope`)
unless you ALSO:
1. Add a row to Table 1 (events) or Table 2 (data-channel labels) in `docs/signaling-envelope-audit.md`
   (repo root `docs/`, NOT under the artifact) with file:line provenance and an honest
   "carries user content?" answer, and bump the count line ("the **N** signaling event names").
2. Add the exact name to `ALLOWED_SIGNALING_EVENTS` (or `ALLOWED_DATA_CHANNEL_LABELS`) in the script.

**Why:** the audit's privacy guarantee ("the signaling WebSocket carries no user content")
rests on the exhaustive enumeration in those two tables; an undocumented event silently
widens the wire surface.

**How to apply:** do the spec/codegen/server/client change first, then run the check, then
add the doc row + whitelist entry in the same change. Table 1 rows are numbered sequentially;
inserting mid-table means renumbering the rows below (a `perl -i -pe` over the line range is
fastest). The script validates the whitelist set, not the doc numbers, but keep them honest.

## Related codegen gotcha
`lib/signaling-types` is a composite TS project: consuming packages' `tsc --noEmit` typecheck
reads its built `dist/*.d.ts`, NOT `src`. After editing `lib/api-spec/asyncapi.yaml` +
`pnpm --filter @workspace/api-spec run codegen`, you must rebuild the declarations
(`npx tsc -b lib/signaling-types/tsconfig.json --force`) or the api-server typecheck fails with
stale "no exported member" / enum-mismatch errors. (Vitest uses src directly, so tests can pass
while typecheck fails.) Also: codegen regenerates the SignalingErrorCode enum from the YAML, so
any error code used in server code MUST exist in the asyncapi enum or regen will drop it.
