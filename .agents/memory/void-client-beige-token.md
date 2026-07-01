---
name: void-client beige --bg is duplicated as raw literals
description: Lightening/changing the page beige requires updating hardcoded copies beyond the --bg token; text-color beige is a separate role.
---
The page beige `--bg` (index.css :root) is NOT the single source of truth — the same
beige is hardcoded as raw literals in several BACKGROUND-role spots that must be changed
in lockstep when `--bg` changes:
- `body` background-image gradient (`rgba(...,0.88)` over /concrete.jpeg) in index.css
- `.void-overlay` background (`rgba(...,0.96)`) in index.css
- PaywallModal: the fixed light scrim backdrop (`rgba(...,0.95)`), the QR container
  background (use `var(--bg)`), and `<QRCodeSVG bgColor>` (needs a literal hex, can't take a CSS var)

**Why:** the beige predates tokenization; check:contrast reads only `--bg`, so it passes
even when these literal copies drift darker, leaving a visible mismatch the guard won't catch.

**Separate role — do NOT retint these when lightening the background:** `#BEB3A2` is also
used as a light FOREGROUND text color on dark (#14110D) surfaces (HamburgerMenu, Docs*Page,
BulletList, longFormStyles --lf-card-fg, CompareTable) and in the dev-only PanelOpacityTuner.
Those are text-on-dark, not the page background; changing them is out of scope for a
"lighten the background" request.
