// SPDX-License-Identifier: AGPL-3.0-or-later
import { ReactNode } from "react";

const FONT = "'Press Start 2P', monospace";

export const GB = {
  darkest: "#0f380f",
  dark: "#306230",
  light: "#8bac0f",
  lightest: "#9bbc0f",
  plastic: "#c0c0c0",
  plasticDark: "#a8a8a8",
  plasticShadow: "#808080",
  plasticHighlight: "#e0e0e0",
  buttonA: "#8b1a4a",
};

let _sharedCtx: AudioContext | null = null;

function getSharedAudioCtx(): AudioContext | null {
  if (_sharedCtx) return _sharedCtx;
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  _sharedCtx = new Ctor();
  return _sharedCtx;
}

export function playSlide(variant: "vertical" | "horizontal"): void {
  const ctx = getSharedAudioCtx();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const freq1 = variant === "vertical" ? 80 : 95;
  const freq2 = variant === "vertical" ? 55 : 60;
  const whirrDur = variant === "vertical" ? 0.38 : 0.35;

  const whirr = ctx.createOscillator();
  const whirrGain = ctx.createGain();
  whirr.type = "square";
  whirr.frequency.setValueAtTime(freq1, now);
  whirr.frequency.linearRampToValueAtTime(freq2, now + whirrDur - 0.03);
  whirrGain.gain.setValueAtTime(0.12, now);
  whirrGain.gain.exponentialRampToValueAtTime(0.001, now + whirrDur);
  whirr.connect(whirrGain);
  whirrGain.connect(ctx.destination);
  whirr.start(now);
  whirr.stop(now + whirrDur);

  const click = ctx.createOscillator();
  const clickGain = ctx.createGain();
  click.type = "square";
  click.frequency.setValueAtTime(220, now + whirrDur - 0.03);
  clickGain.gain.setValueAtTime(0.15, now + whirrDur - 0.03);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + whirrDur + 0.07);
  click.connect(clickGain);
  clickGain.connect(ctx.destination);
  click.start(now + whirrDur - 0.03);
  click.stop(now + whirrDur + 0.07);
}

function NoSignalTile({ label }: { label: string }) {
  return (
    <div style={{ position: "relative", background: GB.darkest, overflow: "hidden" }}>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: "3px",
      }}>
        <div style={{
          fontFamily: FONT, fontSize: "5px", color: GB.dark,
          letterSpacing: "1px", textAlign: "center", lineHeight: "2",
        }}>NO<br />SIGNAL</div>
      </div>
      <div style={{
        position: "absolute", bottom: 2, left: 3,
        fontFamily: FONT, fontSize: "4px", color: GB.light,
        zIndex: 5, letterSpacing: "0.3px",
        textShadow: "0 0 4px rgba(0,0,0,1)",
      }}>{label}</div>
    </div>
  );
}

export function VideoGrid({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gridTemplateRows: "1fr 1fr",
      width: "100%", height: "100%",
      gap: "2px",
      ...style,
    }}>
      {(["YOU", "P2", "P3", "P4"] as const).map((label) => (
        <NoSignalTile key={label} label={label} />
      ))}
    </div>
  );
}

export function ABButtons() {
  return (
    <div style={{ position: "relative", width: "62px", height: "70px", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
        <button style={{ width: "34px", height: "34px", borderRadius: "50%", background: GB.buttonA, border: "none", cursor: "pointer", fontFamily: FONT, fontSize: "5px", color: "#fff", boxShadow: "2px 2px 0 #5a0f30, -1px -1px 0 #c4437a" }}>A</button>
        <div style={{ fontFamily: FONT, fontSize: "3px", color: GB.plasticShadow }}>CAM</div>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
        <button style={{ width: "34px", height: "34px", borderRadius: "50%", background: GB.buttonA, border: "none", cursor: "pointer", fontFamily: FONT, fontSize: "5px", color: "#fff", boxShadow: "2px 2px 0 #5a0f30, -1px -1px 0 #c4437a" }}>B</button>
        <div style={{ fontFamily: FONT, fontSize: "3px", color: GB.plasticShadow }}>MIC</div>
      </div>
    </div>
  );
}

export function InCallControlsRow() {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto",
      gap: "6px",
      alignItems: "center",
      padding: "8px 10px 10px",
    }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
        <div style={{ fontFamily: FONT, fontSize: "4px", color: GB.plasticShadow, letterSpacing: "0.5px" }}>CONTRAST</div>
        <input type="range" style={{ width: "60px", height: "6px", accentColor: GB.dark }} defaultValue={50} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px" }}>
        <button style={{ fontFamily: FONT, fontSize: "5px", background: GB.plastic, color: GB.darkest, border: "none", padding: "4px 12px", borderRadius: "20px", cursor: "pointer", letterSpacing: "1px", boxShadow: "2px 2px 0 #555, -1px -1px 0 #ddd" }}>SELECT</button>
        <button style={{ fontFamily: FONT, fontSize: "5px", background: GB.light, color: GB.darkest, border: "none", padding: "5px 14px", cursor: "pointer", letterSpacing: "1px", boxShadow: "2px 2px 0 #555", borderRadius: "2px" }}>PRINT</button>
        <button style={{ fontFamily: FONT, fontSize: "4px", background: "transparent", color: GB.plasticShadow, border: "none", cursor: "pointer", letterSpacing: "0.5px" }}>◄ LEAVE</button>
      </div>
      <ABButtons />
    </div>
  );
}

export interface DeviceShellProps {
  inCall: boolean;
  screenSlot: ReactNode;
  screenHeight: string | number;
  screenTransition?: string;
  doorOpen: boolean;
}

export function DeviceShell({
  inCall,
  screenSlot,
  screenHeight,
  screenTransition,
  doorOpen,
}: DeviceShellProps) {
  return (
    <div style={{
      position: "relative",
      width: "310px",
      background: GB.plastic,
      backgroundImage: "repeating-linear-gradient(45deg, rgba(0,0,0,0.03) 0px, rgba(0,0,0,0.03) 1px, transparent 1px, transparent 8px)",
      borderRadius: "10px 10px 28px 28px",
      boxShadow: inCall
        ? "0 0 0 1px #555, 2px 2px 16px rgba(0,0,0,0.5)"
        : "0 0 0 1px #333, 4px 4px 24px rgba(0,0,0,0.7), -2px -2px 12px rgba(0,0,0,0.3)",
      overflow: "hidden",
      transform: inCall ? "scale(1.05)" : "scale(1)",
      transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.5s ease",
      flexShrink: 0,
    }}>
      <div style={{
        background: GB.darkest,
        padding: "6px 12px 5px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontFamily: FONT, fontSize: "4px", color: GB.dark, letterSpacing: "2px" }}>DOT CODE:</div>
          <div style={{ fontFamily: FONT, fontSize: "12px", color: GB.lightest, letterSpacing: "5px", textShadow: "0 0 10px rgba(139,172,15,0.8)" }}>DEMO</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px" }}>
          <div style={{
            fontFamily: FONT, fontSize: "4px", color: inCall ? "#ff3030" : GB.dark,
            letterSpacing: "1px",
            animation: inCall ? "blink 1.2s step-end infinite" : "none",
          }}>
            {inCall ? "● LIVE" : "○ IDLE"}
          </div>
          <div style={{ fontFamily: FONT, fontSize: "4px", color: GB.dark, letterSpacing: "0.5px" }}>
            {inCall ? "1/4 PLAYERS" : "STANDBY"}
          </div>
        </div>
      </div>

      <div style={{
        background: "#555",
        padding: "6px",
        boxShadow: "inset 2px 2px 0 #777, inset -2px -2px 0 #333",
        height: screenHeight,
        transition: screenTransition,
        overflow: "hidden",
        position: "relative",
      }}>
        <div style={{
          width: "100%", height: "100%",
          background: "#080808",
          boxShadow: "inset 3px 3px 12px rgba(0,0,0,1)",
          overflow: "hidden",
          position: "relative",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(15,56,15,0.09) 3px, rgba(15,56,15,0.09) 4px)",
            pointerEvents: "none", zIndex: 10,
          }} />
          {screenSlot}
        </div>
      </div>

      <div style={{
        background: GB.plasticDark,
        borderTop: `3px solid ${GB.plasticShadow}`,
        position: "relative",
        overflow: "hidden",
      }}>
        <InCallControlsRow />

        <div style={{
          position: "absolute",
          top: 0,
          left: doorOpen ? "100%" : "0",
          width: "100%",
          height: "100%",
          background: GB.plastic,
          transition: "left 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
          backgroundImage: "repeating-linear-gradient(45deg, rgba(0,0,0,0.04) 0px, rgba(0,0,0,0.04) 1px, transparent 1px, transparent 6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <div style={{ fontFamily: FONT, fontSize: "5px", color: GB.plasticShadow, letterSpacing: "0.5px" }}>▮▮▮ READY</div>
        </div>
      </div>

      <div style={{
        background: GB.plasticDark,
        padding: "5px 10px 6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        borderTop: `2px solid ${GB.plasticShadow}`,
      }}>
        <div style={{
          width: "7px", height: "7px", borderRadius: "50%",
          background: inCall ? "#00cc44" : "#444",
          boxShadow: inCall ? "0 0 6px #00cc44" : "none",
          transition: "background 0.4s, box-shadow 0.4s",
        }} />
        <div style={{ fontFamily: FONT, fontSize: "5px", color: GB.plasticShadow, letterSpacing: "0.5px" }}>
          {inCall ? "IN CALL" : "STANDBY"}
        </div>
        <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: GB.dark, opacity: 0.5 }} />
      </div>
    </div>
  );
}
