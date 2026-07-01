// SPDX-License-Identifier: AGPL-3.0-or-later
// ICE state monitor — owns the per-peer ICE-restart debounce timer
// map manipulation extracted from webrtc.ts during the Refactor 2
// decomposition (task #448).
//
// The 2s debounce setTimeout at the bottom of this file is the
// existing wire-stable behavior preserved verbatim from the original
// webrtc.ts (~line 1075). Phase 2 may make the restart trigger
// configurable; this module is the seam.

export type IceRestartTimerMap = Map<string, ReturnType<typeof setTimeout>>;

export function clearIceRestartTimer(
  timers: IceRestartTimerMap,
  remotePeerId: string,
): void {
  const timer = timers.get(remotePeerId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(remotePeerId);
  }
}

/**
 * Schedule an ICE restart attempt for `remotePeerId` after the
 * debounce window. If the peer reconnects on its own during the
 * window, the caller is responsible for clearing the timer (see
 * `clearIceRestartTimer`).
 *
 * The 2-second window is preserved verbatim from the original
 * inline implementation — it is the empirically tuned interval
 * that lets transient "disconnected" blips heal without our
 * restart-storming, and Phase 2 must not change it without an
 * explicit task scoped to the network behavior.
 */
export function scheduleIceRestart(
  timers: IceRestartTimerMap,
  remotePeerId: string,
  pc: RTCPeerConnection,
  onElapsed: (remotePeerId: string, pc: RTCPeerConnection) => void,
): void {
  clearIceRestartTimer(timers, remotePeerId);
  const timer = setTimeout(() => {
    timers.delete(remotePeerId);
    if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
      onElapsed(remotePeerId, pc);
    }
  }, 2000);
  timers.set(remotePeerId, timer);
}
