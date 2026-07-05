---
name: still-poster-drift transitive deps
description: Why editing a RoomPage direct dependency (e.g. PaywallModal) trips still-poster-drift, and how to clear it.
---

# still-poster-drift watches RoomPage's direct deps, not just RoomPage

The void-client social-OG drift guard treats the one-level local imports of
RoomPage/SocialPoster as watched sources. So a pure copy edit to a dependency
like PaywallModal counts as drift — even though that component is not visible in
the captured social-OG frame.

**Why:** the social card is a live screenshot of RoomPage; the guard can't tell a
cosmetic dep edit from one that moves the frame, so it conservatively demands a
re-capture. It also inspects the working tree, so it fails pre-commit too.

**How to apply:** when CI flags `still-poster-drift` after editing any RoomPage
dependency, run `gen:still-poster` and commit the regenerated JPEG. The capture
is puppeteer+vite (give it a generous timeout) and emits a non-byte-identical
JPEG, so the guard passes even when nothing visible changed.

Unrelated flake: `smoke-serve-static` (api-server) can fail with "Cannot find
module dist/index.mjs" under concurrent builds — a restart clears it; not caused
by void-client edits.
