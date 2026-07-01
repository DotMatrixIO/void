---
name: void-client a11y patterns
description: Conventions learned doing the accessibility pass on VOID client key flows (dialogs, menus, SAS announcement, axe-in-jsdom).
---

## SAS verification announcement = natural words only
The user-confirmed format for announcing the Short Authentication String to a blind
user is the **natural BIP39 words read aloud** (e.g. "abandon foam") via the dialog's
accessible description (`aria-describedby` -> a visually-hidden "Verification words: …"
node). **No** letter-by-letter spelling and **no** NATO phonetic alphabet.
**Why:** the words are the security primitive both peers compare out loud; spelling/NATO
adds noise and diverges from what the sighted peer reads.
**How to apply:** if asked to "improve" the SAS readout, keep it natural-words; don't
add spelling/NATO without re-confirming with the user.

## axe-core in jsdom is component-scoped, not page-scoped
Shared helper `src/test/axe.ts` (`expectNoAxeViolations(container)`) disables rules that
are meaningless for an isolated component render: `color-contrast` (no layout engine in
jsdom — contrast is gated separately by `scripts/check-contrast.mjs`) and the page-level
rules (`region`, `landmark-one-main`, `page-has-heading-one`, `document-title`,
`html-has-lang`, `html-lang-valid`, `bypass`, duplicate-banner). For portaled dialogs,
pass the dialog element itself (e.g. `screen.getByRole("dialog")`), not the RTL render
container — portal content lives on `document.body`, outside the container.

## role="menu" requires ALL interactive children to be menuitems
The in-call overflow ("kebab") menu uses `role="menu"`. axe `aria-required-children`
(critical) fires if any focusable descendant is a plain button. Every actionable child
must carry `role="menuitem"` — including the shared `UiSoundsToggle` (it takes an
optional `role` prop, set only when rendered inside the menu) and the SHARE / SHOW QR
buttons built in `RoomHeaderBar`. Non-interactive caption text is fine.
**Why:** mixing menuitems and bare buttons under role=menu is a real SR-navigation bug,
not a lint nit.
**How to apply:** adding any new control to that menu? give it `role="menuitem"`. Tests
that query those controls must use `getByRole("menuitem")`, not `getByRole("button")`.

## Full-page axe audits (StartScreen / PreviewGate / LandingPage)
Page-level surfaces are audited by passing the RTL `container` (not a portaled
dialog). Reuse the existing per-file mocks (socket, sounds/uiSounds) — they
already stub the side-effecting libs. Two gotchas for the *landing* render:
LandingPage probes `window.matchMedia` on mount (jsdom lacks it → stub the
non-standalone path like the `App.*` tests), and it embeds HamburgerMenu /
PageFooter which use wouter `<Link>`, so wrap the render in `<Router>`. For
PreviewGate, `await flushMicrotasks()` first so the mocked WebRTC probe settles
into the steady state before auditing. No real violations were found across
these surfaces — don't add aria bandaids chasing phantom ones.

## Human SR check is still required after axe passes
Per task #665: axe + focus tests passing does NOT equal "screen-reader accessible".
Always hand off a manual SR-testing checklist (VoiceOver/NVDA: SAS words announced on
open, focus lands in dialogs/menus, Escape returns focus to trigger, burn overlay
announced) and never claim SR-accessibility on an axe pass alone.
