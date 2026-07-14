// SPDX-License-Identifier: AGPL-3.0-or-later
import StartScreen from "@/pages/StartScreen";

/**
 * Task #1042 — DEV-only test route.
 *
 * Mounts the real `StartScreen` in its FULL-FRAME (non-chromeless) form so
 * the Playwright real-browser gate
 * (`tests/playwright/clearnet-path-indicator.spec.ts`) can prove the
 * Task #1027 home-screen header surfaces render with genuine browser layout:
 *
 *   - the `clearnet-path-indicator` ("CLEARNET PATH") badge and the
 *     `onion-copy-offer` ("Copy our .onion") switch render together when a
 *     `.onion` mirror is published but the page was reached over clearnet, and
 *   - on the `.onion` origin the clearnet badge is suppressed and the positive
 *     `tor-onion-indicator` ("Connected via Tor onion") badge shows instead.
 *
 * The landing page (`/`) embeds `StartScreen` with `chromeless`, which
 * suppresses the entire header — so the only place these affordances render is
 * the full-frame form. jsdom has no real layout, so a badge could be hidden by
 * CSS and still pass `toBeVisible()` there; this route renders the shipped
 * component with the real global stylesheet so a true browser can measure it.
 *
 * Gated behind `import.meta.env.DEV` in `App.tsx` exactly like the
 * `/__test/joined-call`, `/__test/share-warnings`, and `/__smoke/room`
 * routes, so the production bundle never ships it.
 */
const NOOP = () => {};

export default function TestStartScreen() {
  return <StartScreen onJoinRoom={NOOP} />;
}
