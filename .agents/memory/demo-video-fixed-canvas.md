---
name: Demo-video fixed-canvas scaling
description: Why biometric/coordination demo-video scenes must scale a whole 1280×720 canvas, and why viewport units inside scenes break.
---

The demo-video artifacts (biometric-demo-video, coordination-demo-video) author every
scene on a fixed 1280×720 frame using absolute pixel typography/offsets (Tailwind
`text-8xl`, `text-3xl`, `text-[10px]`, fixed `top/left`).

**Rule:** when the live scene renders in a fluid container (landing-page
`DemoVideoEmbed` ~340px wide, or a phone), do NOT patch individual font sizes.
Render the scenes inside a fixed 1280×720 inner div and uniformly
`transform: scale(stageWidth/1280)` it (ResizeObserver on the fluid 16:9 stage,
`transformOrigin` top-left, hide until first measure to avoid a `scale(0)` flash).

**Why:** fixed px stays huge relative to a narrow frame → the V[]ID wordmark wraps,
the LIVE badge collides with captions, overlays overflow. The recorded MP4 looked
fine only because it rasterizes at 1280×720 then downscales; the live iframe is what
breaks. At the 1280×720 recording viewport scale==1, so re-records stay byte/pixel
identical and drift checks pass.

**Gotcha:** inside the scaled canvas, viewport units (`vw`/`vh`) reference the iframe
viewport, NOT the canvas — so anything using them (e.g. Scene6 ember rise) mispositions
at small sizes. Use canvas-relative px (derived from 1280×720). Note framer-motion
`x`/`y` are translate transforms, so `%` would reference the element itself, not the
parent — px is the correct unit there.

**How to apply:** editing ANY biometric scene file is a watched source; you must
re-record the MP4 + poster.jpg and refresh the FFmpeg reference, or the drift
workflows fail. See the biometric-mp4-record memory for the record/rm-temp dance.
