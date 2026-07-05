---
name: Navigating "home" inside the Replit proxied preview
description: Why a full nav to a constructed BASE_URL strands the user in the preview iframe, and what to do instead.
---

# Returning to home/root from inside the Replit preview iframe

The Replit workspace preview serves each artifact through a path-based proxy
(mTLS iframe). Inside that iframe, a **full document navigation to a
constructed path** — `window.location.replace(import.meta.env.BASE_URL)` /
`location.assign("/")` — can escape the artifact's served path and land on a
blank page with no app chrome (looks like the user is "stuck", no menus, no
back/forward).

**What works instead:**
- `history.replaceState(null, "", <same-origin url>)` — pure in-document URL
  rewrite, no network round-trip, no proxy path resolution. Safe.
- `window.location.reload()` — re-requests the *exact* URL the document is
  already served from, so it stays on the correct proxy path. Use this for a
  hard reset (discard React tree / AudioContext / media refs) instead of
  navigating to a guessed base path.

**Pattern for "burn it all and go home" in a hash-routed SPA:**
strip the phrase/state from the current URL (`const u = new URL(location.href);
u.hash=""; history.replaceState(null,"",u.toString())`), then
`location.reload()`. The reload boots the app fresh with no hash, so route
derivation (e.g. `parseHashPhrase(location.hash)`) returns null and you land on
the landing page — in preview AND on a root-domain production deploy.

**Why:** the void-client SESSION BURNED overlay was a permanent dead-end in the
preview because its dismiss did `location.replace(BASE_URL)`. The shared leave
button used only `replaceState` + React state reset and worked fine — that
contrast is the tell: replaceState OK, constructed full-nav not OK.

**Also:** if a single-use overlay (one-shot `firedRef`) runs teardown before
the navigation, wrap the teardown in try/catch — a throw there permanently
strands the user because the dismiss can't fire twice.
