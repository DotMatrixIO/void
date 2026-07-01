---
name: video-js timed-animation verification
description: How to reliably screenshot a specific phase of a timed (timer-driven) scene in video-js artifacts despite HMR/Fast Refresh and screenshot caching
---

# Verifying a specific phase of a timed video scene

Video-js scenes commonly drive their animation with a `useState(0)` phase plus
`setTimeout` steps. The player loops via timers and has **no seek mechanism**, so
the screenshot tool almost always captures the very first scene at ~0.3–0.8s.

To screenshot a *later* phase (e.g. the final room/paywall state), three traps
compound and make naive attempts show stale/early frames:

1. **React Fast Refresh preserves hook state.** Editing a component to bump its
   `useState(N)` initializer does NOT re-run the initializer on the persistent
   preview page — the old phase value (still cycling via timers) is kept. So
   `useState(5)` "for debugging" silently has no effect.
2. **The preview/screenshot path caches aggressively.** Repeated captures of the
   same URL can return a byte-identical image.
3. The screenshot tool captures early in the scene lifecycle.

**Reliable recipe:**
- Force a real remount by *changing the hook count*: temporarily replace
  `const [phase,setPhase]=useState(0); useEffect(...timers...)` with a plain
  `const phase = 5;` (removes hooks → Fast Refresh does a full remount → the
  constant takes effect).
- Temporarily point the first scene slot at the scene you want
  (`SCENE_COMPONENTS.open = SceneX`) so it shows immediately on load.
- Bust the screenshot cache with a fresh query param (`/?v=room30`) and/or a
  different `viewport_size`.
- Remember a staggered reveal (clip-path with per-index delay) may still be
  mid-flight at capture; the *last* tile can look clipped/short even though the
  layout is correct.

**Always revert** the constant back to `useState(0)`+timers and restore
`SCENE_COMPONENTS.open` before finishing.

**Critical addition (learned the hard way):** the app-preview screenshot tool
*reloads the page fresh on every call* (you'll see `[vite] connecting...` each
time). So even after pinning the AnimatePresence `key` and forcing the scene to
mount first, a scene whose `useEffect` *resets* phase via `setTimeout` (e.g.
`setPhase(1)` at 150ms) will be back at the early phase by the time the shot is
taken — sleeping before the screenshot does nothing because the reload restarts
the timers. To freeze a late phase you must ALSO neuter the timer `useEffect`
(comment it out or early-return), not just set the initial phase.

**Faster alternative for asset/image swaps:** don't fight the timing at all.
`curl` the asset URLs directly against the dev server
(`http://localhost:<vite-port>/<base>/masks/foo.png`) to confirm `200 image/png`
+ byte size, and `file` them on disk to confirm dimensions/RGBA. If the only
change is swapping a `src` in otherwise-unchanged grid/layout code, a 200 + valid
PNG is sufficient proof; skip the screenshot gymnastics.

**Why:** verifying scenes otherwise wastes many expensive screenshots on
identical early frames and produces false "layout is broken" conclusions.
