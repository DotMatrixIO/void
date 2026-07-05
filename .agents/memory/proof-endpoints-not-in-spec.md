---
name: proof endpoints excluded from openapi spec
description: /api/proof/* routes are intentionally not in openapi.yaml, so overview-http-drift does not gate them
---

The `/api/proof/*` verification endpoints (build, latest-release,
server-state) are intentionally NOT declared in `lib/api-spec/openapi.yaml`.

**Why:** they are out-of-band provenance/diagnostic surfaces, not part of
the product API contract that external SDK consumers code against. The
`overview-http-drift` guard (check-overview-http-drift.mjs) only reconciles
openapi.yaml paths against VOID_TECHNICAL_OVERVIEW.md §2 — so adding a new
`/proof/*` route does NOT require a spec or overview-doc edit.

**How to apply:** when adding another `/proof/*` endpoint, skip the
openapi.yaml + overview §2 changes; the relevant guards are the per-artifact
typecheck/tests and marketing-voice (phrases/literals/contrast/doc-code-drift),
not overview-http-drift. Verify by running overview-http-drift anyway — it
stays green without the new route.
