---
name: Publishing an internal audit into its public copy — cross-link gotchas
description: When publishing internal→public audit copy and repointing citations, the published copy is itself a scanned shipping doc, so verbatim content citing the internal doc trips the cross-links guard too.
---

# Publishing internal audit → public copy + repointing citations

When a task publishes an internal doc's content into a public/shipping copy and
must repoint EVERY citation internal→public so `check:publish-cross-links` reports
zero live refs:

- **The public copy is itself a scanned shipping doc.** Verbatim content you paste
  from the internal doc that *internally cited the internal doc* (e.g. a finding
  whose prose says "the workflow comments cite `…internal-2026-04.md §7.1`") will
  trip the cross-links guard against the public copy. Repoint refs INSIDE the
  published block, not just the external citers.
  **How to apply:** after the bulk repoint, run the guard and a tree-wide
  `rg 'security-audit-internal-2026-04' --glob '!<the-internal-doc>'`; expect hits
  ONLY in PRIVATE/never-ship docs (pre-publish-scrub, manifest-review) and in the
  guards' OWN never-ship target lists (check-publish-cross-links/-doc-hygiene name
  the file by design) — everything else is a real violation.

- **A drift test that reads the internal doc by path** (e.g.
  `ignore-list.drift.test.mjs`'s `AUDIT_DOC_PATH`) keeps passing after repointing
  to the public copy ONLY because the public copy carries the same R-0 table +
  CVE mentions verbatim. Repoint the path constant AND its message strings (the
  cross-links guard scans the whole file), then re-run the test.

- **Anchor reconciliation:** a citation like registry.ts §3.9 can reference a
  section absent from the public copy. Publishing that section verbatim (end of
  its parent §) resolves the anchor without inventing a new one — prefer that over
  repointing to a "nearest" anchor.
