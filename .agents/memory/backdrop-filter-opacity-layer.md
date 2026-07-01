---
name: backdrop-filter vs opacity compositing layers
description: Why frosted (backdrop-filter) text intermittently vanishes when a large opacity<1 element overlaps it, and the fix.
---

On the void-client landing page, frosted labels use `.void-tan-frost`
(`backdrop-filter: blur(6px)`). Text in these labels would intermittently
disappear and only reappear when selected (which forces a repaint).

**Cause:** A nearby decorative element set `opacity: 0.25`. Any `opacity < 1`
promotes the whole element to its own offscreen compositing layer; when that
element is huge (here a ~100000px-tall full-page band), the extra GPU layer
intermittently breaks the backdrop-filter's backdrop sampling on overlapping
elements, so the frosted text paints empty until a recomposite is forced.

**Fix / rule:** Do NOT use the `opacity` property to make large decorative
overlays translucent when they sit behind `backdrop-filter` content. Bake the
alpha into an `rgba()` background color instead (visually identical for a
childless element, but creates no opacity compositing layer).

**How to apply:** Any time you need a translucent solid-color block that
overlaps or sits behind frosted/`backdrop-filter` UI, reach for
`backgroundColor: rgba(r,g,b,a)` rather than `opacity`.

**Recurring source — the whole "Gold Voyager" decorative geometry block**
at the top of LandingPage (the tiles/lines/dots behind the hero) used
`opacity: <1` on every element. This is the layer behind the frosted
hero tagline ("Send anyone a link. / They click. You talk."), so it
re-triggers the vanishing-text bug whenever the page's compositing tree
shifts (e.g. after adding/removing a full-bleed section elsewhere). It
regressed at least twice for this reason. Fix applied: convert ALL of
them to baked `rgba()` and delete every `opacity` prop. Note for the
textured tiles (concrete jpeg + same-hue 0.84 gradient + opacity): the
opaque jpeg can't be made translucent by lowering rgba alpha, so just
drop the texture and use a single flat `rgba(color, oldOpacity)` — the
tiles are essentially flat color anyway, and flat tints already match
the orange-square / teal-band decoratives elsewhere on the page.
