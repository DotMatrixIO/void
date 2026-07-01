---
name: void-client route + copy-rename guard fan-out
description: What else breaks when you add a route or rename user-facing button copy in void-client
---

Adding a new `<Route>` or renaming a user-facing control in void-client trips several
guards that live OUTSIDE the component being edited. Touch all of them in lockstep.

**New route registered in `App.tsx`:**
- `check:routes-overview` (part of the `marketing-voice` workflow) fails unless the route
  also has a row in `VOID_TECHNICAL_OVERVIEW.md` §6.2 ("Page Structure") routes table at
  the REPO ROOT (not under artifacts/). DEV-gated routes are exempt; production routes are not.

**Renaming button/label copy (e.g. SESSION → ROOM):**
- vitest specs that query `getByRole("button", { name: /OLD/i })` — e.g. `StartScreen.test.tsx`.
- Playwright specs assert the EXACT name string (not regex): `tests/playwright/cross-engine-flow.spec.ts`
  AND `tests/playwright/safari-webrtc-devicecloud.spec.ts` both hardcode the landing host/join
  control names. Miss these and the chromium/webkit landing-controls e2e tests fail.

**Why:** these guards intentionally pin copy/structure so drift fails loudly; the assertions
are far from the source they protect, so a local edit looks complete while CI is already red.

**How to apply:** after any route add or visible-copy rename, grep the whole void-client tree
(incl. `tests/playwright` and `VOID_TECHNICAL_OVERVIEW.md`) for the old string before declaring done.

**Pre-existing-failure context (don't chase these):** `still-poster-drift` fails whenever
RoomPage/webrtc deps changed without re-capturing the OG JPEG; the Playwright `[flow-firefox]`
project fails with "browser has been closed" because Firefox isn't installed on Replit
(chromium+webkit only). Both are unrelated to landing/media copy edits.
