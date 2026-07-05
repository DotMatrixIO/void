---
name: void-client copy/color CI guards
description: What the marketing-voice CI guards enforce on user-facing copy/color edits, and the literal-matching gotcha that wastes a run.
---

# void-client marketing-voice CI guards

Any user-facing copy or color edit in `artifacts/void-client` must pass the `marketing-voice`
workflow before completing. Run it via `pnpm --filter @workspace/void-client run check:phrases check:literals check:contrast` (the workflow runs the full set: phrases, literals, feature-policy-sync, onion-mirror-sync, og-routes, routes-overview, fragments-sync, contrast, no-display-media-audio, signaling-envelope, threat-model-drift, landing-fonts).

- **Banned phrases** — `scripts/check-banned-phrases.mjs` rejects marketing clichés and over-claims (e.g. media-over-Tor wording). Keep copy in the `/why` register: short sentences, second person, plain words.
- **Required literals** — `scripts/check-required-literals.mjs` pins exact user-facing strings to specific page files so a tone rewrite can't silently drop/flip them. When you intentionally change a pinned string (or move the affordance to another page file), update the pinned literal AND its file pointer in the SAME commit.
- **Contrast** — `scripts/check-contrast.mjs` audits palette token pairs against WCAG; accent-on-bg text pairs are EXEMPT by design.

## Gotcha: required-literal match is on RAW SOURCE, not rendered text

`checkRequiredLiteral` does a substring `.includes()` against the raw `.tsx` source. If a
pinned literal is JSX text that the formatter wraps across lines, the source contains a
newline + indentation in the middle of the phrase and the match FAILS even though the page
renders the phrase correctly.

**Why:** the check never parses/normalizes JSX whitespace; it greps the file bytes.

**How to apply:** keep any pinned literal on ONE source line. If it's long enough to wrap,
wrap it in a JSX string expression instead, e.g. `{"…full pinned sentence…"}`, so the exact
phrase lives contiguously in the source. Headings inside `<h2>…</h2>` on their own line are
already contiguous; inline `<p>` body text is the usual offender.

## Smart-quote / typographic sweeps fan out into exact-string tests
A curly-quote codemod over user-facing copy (JSXText + string-literal consts)
breaks every test that asserts that copy VERBATIM with straight quotes. These
are spread across many specs and use several matcher styles, so a single grep
of one form misses them. After any apostrophe/quote sweep, hunt ALL of:
- `getByRole("button", { name: "...'..." })` (e.g. SAS DON'T MATCH)
- `toHaveTextContent("...'...")` / `toBe("...'...")` const compares
- `toContain("...'...")` (RoomPage COULDN'T EXTEND, threat-model host's)
- regex literals `/...'.../ ` (RoomShareSheet/PreviewGate "QR doesn't touch it",
  docsFaqSplit FAILURE_BODY_SAMPLES `/WE CAN'T DECRYPT THIS PEER'S MESSAGES/`)
- normalized verbatim consts (threatModel WON'T / VOID's paragraphs)
Negative assertions (`not.toContain`/`queryBy...toBeNull`) for REMOVED copy stay
inert either way — update for consistency, not correctness. The build doesn't
catch these (Vite, no tsc); only `void-client-tests` does — run the FULL suite.
