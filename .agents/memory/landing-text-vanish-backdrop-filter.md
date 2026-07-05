---
name: Landing text vanish — backdrop-filter root cause
description: Why landing text intermittently vanished-until-clicked and the opaque-panel rule that prevents it.
---

# Landing "text vanishes until clicked" bug

The intermittently-disappearing text on the VOID landing page was caused by the
shared CSS class `.void-tan-frost` (in `void-client/src/index.css`), which applies
`backdrop-filter: blur(6px)` over a transparent background. `backdrop-filter`
promotes the element to its own compositing layer; that layer intermittently fails
to repaint until a click/scroll forces a recomposite — so the text is invisible
until the user interacts.

**Trigger:** a *nearby* promoted layer recompositing — on Landing these are the
sub-1-alpha decorative squares and the 100000px-tall teal band.

**Why:** the victim is always a `backdrop-filter` (or other compositing-layer)
element; plain non-positioned text in normal flow paints with the body and does
not exhibit this. So removing every compositing-spawning property from the text
makes it structurally immune regardless of the decorative layers.

**Durable rule:** the victim is always a compositing-layer element, so keep
persistent landing TEXT effect-free. Never put `opacity` < 1, `backdrop-filter`,
`transform`, `will-change`, or `filter` ON or WRAPPING landing text. Confine
those effects to a *single* background-only layer that paints BELOW all text
(e.g. an absolute wrapper at a negative z-index). One background layer is safe;
dozens of per-span/per-block frosted elements are not (they fan out fragile
compositing layers that trigger each other's repaint failures).

**Implementation history (current → oldest):** `.landing-haze` (one frosted veil
inside a `z-index:-1` decorative wrapper, tint via `--haze-alpha` + blur via
`--haze-blur`) replaced the per-block opaque `.void-panel` rule, which itself
replaced the original per-span `.void-tan-frost` backdrop-filter spans. If you see
references to `.void-panel`, they are stale — the live mechanism is `.landing-haze`.

**How to apply:** give landing text an opaque backing (its own panel, or an
already-opaque band) and avoid the forbidden properties; use an alpha-channel
color (`color-mix(... transparent)`) instead of the `opacity` property, and
`position/left` instead of `transform`. Transient `:active` press feedback
repaints on release, so a pressed-state opacity is acceptable.

Two non-obvious facts that shaped the fix:
- `.void-tan-frost` is shared with non-landing pages (e.g. `DocsBiometricPage`,
  where the frosted look is intentional), so it must NOT be neutralized globally —
  scope the de-frost to landing render paths (a prop, or an opt-out).
- At runtime `StartScreen` is only ever rendered embedded inside the landing page
  (every other reference is a test), so its landing-facing styling can be changed
  without affecting any other live page.

No static CI guard enforces this rule; it lives only as the doc comment on
`.landing-haze` in index.css. A landing-scoped check would make it permanent.

Known scope gap: the refusal section's ~100000px teal band lives in content flow,
NOT in the `z-index:-1` decorative wrapper, so the haze does not cover it. It is
faint (low-alpha teal over beige) and the dark refusal text stays legible, so this
is an accepted compromise — not the vanish bug.
