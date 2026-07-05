// SPDX-License-Identifier: AGPL-3.0-or-later
import PhraseShareModal from "@/components/PhraseShareModal";
import RoomShareSheet from "@/components/RoomShareSheet";

/**
 * Task #738 — DEV-only test route.
 *
 * Mounts the real `PhraseShareModal` and `RoomShareSheet` one at a time
 * (selected by the `?which=phrase|room` query) so the Playwright
 * real-browser visibility gate
 * (`tests/playwright/share-warnings-visible.spec.ts`) can prove the
 * link-mangling and fragment-leak cautions are *genuinely* on-screen —
 * not just present in the DOM the way the jsdom component tests
 * (`PhraseShareModal.test.tsx` / `RoomShareSheet.test.tsx`) can show.
 *
 * jsdom has no real layout, so a caution could be hidden by CSS
 * (display:none, opacity:0, zero height, off-screen, behind another
 * element) and still pass `toBeVisible()` there. This route renders the
 * shipped components with the real global stylesheet so a true browser
 * can measure them.
 *
 * Only one modal renders per load so the two `position:fixed` overlays
 * never stack on top of each other and obscure one another's text.
 *
 * Gated behind `import.meta.env.DEV` in `App.tsx` exactly like the
 * `/__test/joined-call`, `/__smoke/room`, and `/still/:variant` routes,
 * so the production bundle never ships it.
 */
const PHRASE = "midnight cobalt fern lantern quartz harbour";
const JOIN_URL =
  "https://void.example.com/#midnight-cobalt-fern-lantern-quartz-harbour";

const NOOP = () => {};

export default function TestShareWarnings() {
  const which = new URLSearchParams(window.location.search).get("which");

  if (which === "room") {
    return (
      <RoomShareSheet
        url={JOIN_URL}
        phrase={PHRASE}
        tierLabel="DAY"
        expiresAtWallClock={Date.now() + 47 * 60_000}
        onClose={NOOP}
      />
    );
  }

  return <PhraseShareModal phrase={PHRASE} joinUrl={JOIN_URL} onClose={NOOP} />;
}
