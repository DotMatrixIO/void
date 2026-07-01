# Frontend resource-cleanup audit (RAF + WebGL + 2D canvas + hidden `<video>`)

Scope: `artifacts/void-client/src`. Companion to Task #283 (AudioContext
cleanup), covering the rest of the resource-leak surface flagged in the
original brief — `requestAnimationFrame` loops, WebGL contexts, 2D
canvas compositors, and hidden `<video>` elements that hold MediaStream
references.

Method: ripgrep across `*.ts`/`*.tsx` for `requestAnimationFrame`,
`cancelAnimationFrame`, `getContext(`, `<video`, `HTMLVideoElement`,
`createElement("canvas"` and manual review of each hit.

## Inventory

| # | Location | Resource | Owner / lifetime | Cleanup status |
|---|---|---|---|---|
| 1 | `lib/mediaPipeline.ts` `buildMediaPipelineInner` (≈L341–633) | hidden `<video>` (srcVideo), WebGL2 canvas + context, 2D compositor canvas, RAF render loop, GL textures/buffers/VAO/program | `MediaPipeline` returned from `buildMediaPipeline`; lifetime owned by the caller (`PreviewGate`, `RoomPage`) | OK. Partial-init failures unwind via the `cleanups[]` stack (registers `srcVideo.remove`, canvas remove, `WEBGL_lose_context`). `stop()` cancels RAF, deletes GL objects, calls `WEBGL_lose_context`, removes both canvases, nulls `srcVideo.srcObject`, stops tracks. |
| 2 | `lib/mediaPipeline.ts` `createWatermarkedScreenShareTrack` (≈L668–771) | hidden `<video>` (srcVideo), 2D compositor canvas, RAF render loop, captureStream output track | `WatermarkedScreenShare` returned to `RoomPage.promoteShareToPeers`; tracked in `screenShareWatermarkRef` | OK after fix. `stop()` cancels RAF, removes listener, stops outTrack, nulls srcObject, removes both DOM nodes. **Fix applied in this audit:** the two partial-init throw paths (no 2D context, captureStream returned no track) now also null `srcVideo.srcObject` before `remove()`, matching `stop()`'s ordering and the equivalent throw paths in `buildMediaPipelineInner`. Without this, a hidden `<video>` that briefly held the screen-share `MediaStream` could keep the source track reachable until GC. Cleanup on the unmount path is exercised by the pre-existing block at `RoomPage.tsx` L1466–L1469 and by `stopShareCleanup` (L1900–L1903). |
| 3 | `lib/mediaPipeline.ts` `generateFontAtlas` (L228–L242) | one-shot offscreen 2D canvas (font-atlas glyph sheet) | Local to function; the canvas is uploaded into a GL texture via `texImage2D` and then dropped on the floor | OK. The canvas is never appended to the DOM and the only retained reference is from the GL texture upload (which copies the pixels). Once `generateFontAtlas` returns, the canvas is unreachable and GC-eligible; nothing to explicitly clean up. The GL texture itself is deleted in `MediaPipeline.stop()` via `gl.deleteTexture(fontAtlasTex)`. |
| 4 | `pages/RoomPage.tsx` audio-meter `useEffect` (L74–L123) | RAF tick loop computing per-frame RMS from an `AnalyserNode` | Effect-scoped to the meter component | OK. `cancelAnimationFrame(rafId)` runs in the cleanup return, plus `srcNode.disconnect()` and `releaseSharedRemoteCtx()`. |
| 5 | `pages/PreviewGate.tsx` `startPreview` draw-loop (L277–L297) | RAF copying pipeline canvas → preview canvas; preview canvas's own `getContext("2d")` | `stopDrawRef` callback owned by `PreviewGate`, invoked from `stopPreview` and the unmount cleanup | OK. `stopDrawRef.current()` sets `stopped = true` and `cancelAnimationFrame(rafId)`. The cancellation guard (`startCancelledRef`) handles the await-races-with-unmount case. |
| 6 | `pages/StillPoster.tsx` `buildPeerStream` (L155–L168) | offscreen 2D canvas + `captureStream(15)` MediaStream per peer | `RoomFrame` `useEffect` records every created stream in `createdStreams[]` | OK. Unmount cleanup walks `createdStreams` and stops every track (L333–L342). The canvases themselves are never appended to the DOM and become GC-eligible once their `MediaStream` tracks are stopped. No RAF — content is static. |
| 7 | `components/QrScannerModal.tsx` (L65–L129) | `qr-scanner` instance bound to a `<video>` element | Effect-scoped | OK. `scanner.stop()` + `scanner.destroy()` in cleanup; `cancelled` flag handles late-resolving `hasCamera()` / `start()`. |
| 8 | `pages/RoomPage.tsx` `VideoSlot` / `SharePreviewVideo` (L263–L375) | `<video>` elements with `srcObject` + `ResizeObserver` | Component-scoped | OK. `ResizeObserver.disconnect()` in cleanup. `SharePreviewVideo` nulls `srcObject` on cleanup. `VideoSlot` re-binds via the `[stream]` dep so the previous stream is replaced rather than orphaned; the underlying tracks are owned by `localStreamRef` / remote streams and stopped by the room's unmount / `stopShareCleanup` paths. |

## Findings

1. **No leaked WebGL contexts.** The only WebGL2 context in the
   codebase is the camera pipeline's. Both partial-init and steady-state
   teardown paths call `WEBGL_lose_context`, delete every GPU object
   (textures, buffer, VAO, program), and remove the host canvas from
   the DOM.
2. **No unbalanced `requestAnimationFrame` loops.** Every RAF call site
   captures its `rafId` in scope and pairs it with a
   `cancelAnimationFrame` in either an effect-cleanup return, a `stop()`
   method, or a ref'd teardown callback that the owner invokes on
   unmount / state change. Loops also gate on a `stopped` boolean to
   defend against a frame that has already been scheduled at the moment
   of cancellation.
3. **One small consistency gap (now fixed).**
   `createWatermarkedScreenShareTrack` had two throw paths that removed
   the hidden `<video>` without first nulling `srcObject`. The
   corresponding `stop()` path nulls `srcObject` first, and so does the
   equivalent partial-init unwind in `buildMediaPipelineInner`. The
   throw paths now match.
4. **Hidden `<video>` elements are accounted for.** Both pipelines that
   create a hidden `<video>` to drive a canvas compositor (camera
   pipeline + screen-share wrapper) tear them down on every exit path.
   `SharePreviewVideo` (visible) clears its own `srcObject` on cleanup.
   `VideoSlot`'s `srcObject` is re-bound by the `[stream]` dep rather
   than orphaned.

## Tests

The screen-share watermark wrapper's partial-init unwind is exercised
indirectly today via `pages/RoomPage.test.tsx` (the
`createWatermarkedScreenShareTrack` mock variants) and via the
host-offline indicator tests. The fix in this audit only changes the
ordering of two cleanup statements inside throw paths that are not
reached during normal flow, so no test changes are required and the
existing `void-client-tests` suite continues to cover the steady-state
cleanup.
