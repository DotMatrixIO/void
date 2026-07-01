// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useCallback } from "react";
import { GB, playSlide, VideoGrid, DeviceShell } from "./_shared/DeviceShell";

const FONT = "'Press Start 2P', monospace";

function LobbyScreen() {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: GB.darkest,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
    }}>
      <div style={{
        fontFamily: FONT, fontSize: "7px", color: GB.lightest,
        letterSpacing: "2px", textAlign: "center", lineHeight: "2",
        textShadow: "0 0 8px rgba(139,172,15,0.6)",
      }}>DOT•MATRIX</div>
      <div style={{
        width: "80%", background: "#1a2a0a",
        border: `2px solid ${GB.dark}`, padding: "8px",
        display: "flex", flexDirection: "column", gap: "6px",
      }}>
        <div style={{ fontFamily: FONT, fontSize: "4px", color: GB.light, letterSpacing: "1px" }}>ROOM CODE:</div>
        <div style={{ fontFamily: FONT, fontSize: "13px", color: GB.lightest, letterSpacing: "6px", textAlign: "center" }}>DEMO</div>
      </div>
      <div style={{ fontFamily: FONT, fontSize: "4px", color: GB.dark, letterSpacing: "0.5px" }}>► PRESS START</div>
    </div>
  );
}

export function VerticalTransition() {
  const [inCall, setInCall] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const handleToggle = useCallback(() => {
    if (transitioning) return;
    playSlide("vertical");
    setTransitioning(true);
    setInCall((v) => !v);
    setTimeout(() => setTransitioning(false), 700);
  }, [transitioning]);

  const screenSlot = (
    <>
      <div style={{
        position: "absolute", inset: 0,
        transform: inCall ? "translateY(-100%)" : "translateY(0)",
        transition: "transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
      }}>
        <LobbyScreen />
      </div>
      <div style={{
        position: "absolute", inset: 0,
        transform: inCall ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
      }}>
        <VideoGrid style={{ height: "100%" }} />
      </div>
    </>
  );

  return (
    <div style={{
      minHeight: "100vh",
      background: "#111",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px 12px 12px",
      fontFamily: FONT,
      gap: "14px",
    }}>
      <button
        onClick={handleToggle}
        style={{
          fontFamily: FONT, fontSize: "7px",
          background: inCall ? "#222" : GB.darkest,
          color: inCall ? GB.light : GB.lightest,
          border: "none", padding: "10px 20px",
          cursor: transitioning ? "default" : "pointer",
          letterSpacing: "1px", borderRadius: "3px",
          boxShadow: "2px 2px 0 #000",
          opacity: transitioning ? 0.6 : 1,
          transition: "opacity 0.2s",
          flexShrink: 0,
        }}
      >
        {inCall ? "◄ RESET" : "TRANSFORM →"}
      </button>

      <DeviceShell
        inCall={inCall}
        screenSlot={screenSlot}
        screenHeight={inCall ? "210px" : "148px"}
        screenTransition="height 0.5s cubic-bezier(0.4, 0, 0.2, 1)"
        doorOpen={inCall}
      />

      <div style={{
        fontFamily: FONT, fontSize: "5px", color: "#555",
        letterSpacing: "0.5px", textAlign: "center", lineHeight: "2",
        flexShrink: 0,
      }}>
        VARIANT A — VERTICAL<br />
        <span style={{ color: "#333" }}>SCREEN EXPANDS UP · DOOR SLIDES RIGHT→LEFT</span>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        @keyframes blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
      `}</style>
    </div>
  );
}
