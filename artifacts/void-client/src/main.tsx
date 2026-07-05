// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { clampOpusBitrate } from "./lib/webrtcSdp";

createRoot(document.getElementById("root")!).render(<App />);

// DEV-only hook exposing the *real* SDP munge so the cross-engine
// Playwright flow can apply the production strip to a genuine,
// browser-generated WebRTC offer/answer and prove the negotiated
// session carries no DTMF (telephone-event) codec. Gated behind
// import.meta.env.DEV so it never ships to production. See
// tests/playwright/cross-engine-flow.spec.ts ("no DTMF in a real
// negotiated audio session").
if (import.meta.env.DEV) {
  (
    window as unknown as {
      __voidWebrtcTesting?: { clampOpusBitrate: (sdp: string) => string };
    }
  ).__voidWebrtcTesting = { clampOpusBitrate };
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL || "/";
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
  });
}
