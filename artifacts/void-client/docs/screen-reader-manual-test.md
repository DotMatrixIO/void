# Screen-reader manual test runbook — key flows

Automated `axe` + focus-management tests (`src/components/a11y.test.tsx`) prove the
*structure* is correct, but they cannot prove a flow is **usable** with a real
screen reader. This runbook is the human pass that must be walked before claiming
the app is "screen-reader accessible". It is intentionally a hand-test: VoiceOver
and NVDA are GUI assistive technologies that require a human operator on macOS/iOS
or Windows respectively — they cannot be driven headless/in CI.

## Machine-verified vs. human-only

The **objective** half of this runbook — the accessibility-tree facts a screen
reader consumes (roles, accessible names, ARIA state, focus movement, Escape focus
return) — is now executed in a real browser by
`tests/playwright/a11y-tree-audit.spec.ts` (Playwright reads Chromium's
accessibility tree, the same tree assistive tech consumes). Run it with:

```
pnpm --filter @workspace/void-client exec playwright test --project a11y-chromium
```

It drives the production in-call UI via the DEV-only `/__test/joined-call` route
and asserts, for the surfaces reachable there:

- **Overflow menu** — trigger announced as a collapsed menu button
  (`aria-haspopup="menu"`, `aria-expanded` toggles), the container is a `menu`
  named "More controls", focus moves into the menu on open, every actionable
  child is a `menuitem` (no bare buttons), and Escape closes it and returns focus
  to the trigger. **STATUS: PASS (Chromium).**
- **Burn overlay** — `role="alertdialog"`, `aria-live="assertive"`, accessible
  name "SESSION BURNED", focus moved onto the overlay. **STATUS: PASS (Chromium).**
- **SAS dialog accessible description** — exposed as natural words via the jsdom
  unit test in `src/components/a11y.test.tsx` ("SAS dialog screen-reader
  announcement"). **STATUS: PASS (jsdom).** The dialog is not reachable from the
  test harness (it needs live per-peer SAS state), so its *spoken* behavior on
  open stays a human check below.

What remains **human-only** (this runbook): whether the SAS words are actually
*spoken* on dialog open across VoiceOver and NVDA, the pronunciation/clarity of
the natural words, and overall comprehensibility of each flow with the SR's own
voice and verbosity. The machine audit cannot judge those — walk them below.

Walk the **join → in-call → verify → burn** flow end-to-end on each of:

- **macOS Safari + VoiceOver** (`Cmd+F5` to toggle VO; `VO` = `Ctrl+Option`)
- **Windows Firefox or Chrome + NVDA** (`Insert` is the NVDA key; `Insert+Down`
  to start "say all")
- (Optional but recommended) **iOS Safari + VoiceOver** for the narrow-viewport
  dialog layout.

For each checkpoint, record PASS / FAIL and, on FAIL, the SR + browser + a short
note. File any FAIL as a new task — do not fold gaps back into an axe test.

---

## 0. Setup

1. Start the client: restart the `artifacts/void-client: web` workflow.
2. Open the preview, create a room, and join a second peer (a second tab / second
   device) so the peer tiles, the SAS verify control, and moderation controls are
   all live.
3. Turn on the screen reader **before** loading the room so the initial
   announcements are captured.

---

## 1. Join → in-call (orientation)

- [ ] The room loads and the SR can reach the header controls by Tab and by SR
      navigation (VO: `VO+Right`; NVDA: `Down`).
- [ ] Each peer tile's verify control is announced with a meaningful name
      (expected: "Phrase verification with P1: …. Opens verification dialog." or,
      after key rotation, "Keys rotated — re-verify SAS with P1").

## 2. Verify (SAS dialog) — highest-risk surface

Trigger: activate a peer's verify control.

- [ ] On open, focus moves **into** the dialog (not left on the trigger).
- [ ] The dialog is announced as a dialog with its title ("VERIFY SAS").
- [ ] **The two verification words are announced as natural words** on open
      (e.g. "Verification words: abandon foam") — read as words, **not** spelled
      letter-by-letter and **not** NATO phonetic. This is the security primitive
      both peers compare aloud.
      - NOTE: focus currently lands on the "WORDS MATCH" button rather than the
        dialog container, so whether the words description is spoken on open is
        SR-dependent. Confirm on **both** VO and NVDA. If either fails to speak
        the words on open, that is a real gap (tracked separately as the
        verification-dialog screen-reader-label task).
- [ ] The "WORDS MATCH" and "DON'T MATCH" buttons are both reachable and
      announced as buttons.
- [ ] Tab / Shift+Tab cycle stays trapped inside the dialog.
- [ ] **Escape closes the dialog and returns focus to the verify control** that
      opened it.
- [ ] If the peer has a voice mask active, the "VOICE MASK ACTIVE" warning is
      announced (it is a `role="alert"`).

## 3. In-call overflow ("kebab") menu

Trigger: the "More controls" (⋮) button in the header.

- [ ] The trigger is announced as a button with a popup menu (`aria-haspopup`),
      and its expanded/collapsed state is announced as it toggles.
- [ ] On open, focus moves into the menu (onto its first item).
- [ ] The container is announced as a menu named "More controls".
- [ ] **Every item is announced as a menu item** and is reachable by SR menu
      navigation: SHARE, SHOW QR, the SOUND FX toggle, and (host) KNOCK and LOCK.
      None should be announced as a plain button.
- [ ] Disabled moderation items (KNOCK / LOCK when moderation is paused) announce
      their disabled state.
- [ ] **Escape closes the menu and returns focus to the ⋮ trigger.**
- [ ] Outside-click closes the menu (no SR assertion needed; just confirm it does
      not strand focus).

## 4. Burn (terminal overlay)

Trigger: end the session via BURN.

- [ ] The "SESSION BURNED" / "ALL KEYS DESTROYED" overlay is **announced
      automatically** without the user navigating to it (it is an
      `aria-live="assertive"` `role="alertdialog"`).
- [ ] Focus is moved onto the overlay (the user is not stranded on a now-removed
      in-call control).
- [ ] If a cleanup reason is present, it is announced.
- [ ] If the host-token cleanup failed, "BURN INCOMPLETE — TOKEN MAY PERSIST" is
      announced (it is a `role="alert"`).
- [ ] "PRESS ESC TO CLOSE" works; the overlay also auto-dismisses after ~3s and
      lands the user back on the home page.

---

## What "done" means

All checkpoints PASS on **both** VoiceOver and NVDA, or every FAIL has been filed
as a follow-up task with the SR + browser noted. An axe pass alone does not
satisfy this runbook.
