// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect } from "react";

// Dev-only tuner for the Landing background haze (--haze-alpha / --haze-blur).
// Renders nothing in production (gated by import.meta.env.DEV at the call
// site). Drag the sliders to preview live, then bake the chosen values into
// `--haze-alpha` / `--haze-blur` in index.css. The haze is a background-only
// layer (.landing-haze) drawn behind all text, so tuning it can never
// reintroduce the landing vanish bug (see .landing-haze in index.css).

const ALPHA_KEY = "void:haze-alpha-tuner";
const BLUR_KEY = "void:haze-blur-tuner";
const ALPHA_DEFAULT = 0;
const BLUR_DEFAULT = 3;
const BLUR_MAX = 16;

function readNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      const n = Number(saved);
      if (Number.isFinite(n) && n >= min && n <= max) return n;
    }
  } catch {
    // localStorage unavailable — fall through to default
  }
  return fallback;
}

export default function PanelOpacityTuner() {
  const [alpha, setAlpha] = useState<number>(() => readNumber(ALPHA_KEY, ALPHA_DEFAULT, 0, 1));
  const [blur, setBlur] = useState<number>(() => readNumber(BLUR_KEY, BLUR_DEFAULT, 0, BLUR_MAX));
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    document.documentElement.style.setProperty("--haze-alpha", String(alpha));
    try {
      localStorage.setItem(ALPHA_KEY, String(alpha));
    } catch {
      // ignore persistence failures
    }
  }, [alpha]);

  useEffect(() => {
    document.documentElement.style.setProperty("--haze-blur", `${blur}px`);
    try {
      localStorage.setItem(BLUR_KEY, String(blur));
    } catch {
      // ignore persistence failures
    }
  }, [blur]);

  const pct = Math.round(alpha * 100);

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 99999,
        background: "#14110D",
        color: "#BEB3A2",
        border: "1px solid #BEB3A2",
        borderRadius: 2,
        padding: collapsed ? "6px 10px" : "10px 12px",
        fontFamily: "monospace",
        fontSize: 12,
        width: collapsed ? "auto" : 240,
        boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ letterSpacing: "0.04em" }}>background haze</span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: "transparent",
            color: "#BEB3A2",
            border: "1px solid #BEB3A2",
            borderRadius: 2,
            cursor: "pointer",
            padding: "0 6px",
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: "18px",
          }}
          aria-label={collapsed ? "Expand background haze tuner" : "Collapse background haze tuner"}
        >
          {collapsed ? "+" : "–"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              margin: "8px 0 4px",
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 700 }}>veil {pct}%</span>
            <span style={{ opacity: 0.8 }}>α {alpha.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={alpha}
            onChange={(e) => setAlpha(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#BEB3A2", cursor: "pointer" }}
            aria-label="Landing background haze veil strength"
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {[0, 0.35, 0.55, 0.7, 0.85].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAlpha(v)}
                style={{
                  flex: 1,
                  background: alpha === v ? "#BEB3A2" : "transparent",
                  color: alpha === v ? "#14110D" : "#BEB3A2",
                  border: "1px solid #BEB3A2",
                  borderRadius: 2,
                  cursor: "pointer",
                  padding: "3px 0",
                  fontFamily: "monospace",
                  fontSize: 11,
                }}
              >
                {Math.round(v * 100)}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              margin: "14px 0 4px",
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 700 }}>blur {blur}px</span>
          </div>
          <input
            type="range"
            min={0}
            max={BLUR_MAX}
            step={1}
            value={blur}
            onChange={(e) => setBlur(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#BEB3A2", cursor: "pointer" }}
            aria-label="Landing background haze blur radius"
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {[0, 3, 5, 8, 12].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setBlur(v)}
                style={{
                  flex: 1,
                  background: blur === v ? "#BEB3A2" : "transparent",
                  color: blur === v ? "#14110D" : "#BEB3A2",
                  border: "1px solid #BEB3A2",
                  borderRadius: 2,
                  cursor: "pointer",
                  padding: "3px 0",
                  fontFamily: "monospace",
                  fontSize: 11,
                }}
              >
                {v}
              </button>
            ))}
          </div>
          <p style={{ margin: "10px 0 0", opacity: 0.75, lineHeight: 1.4 }}>
            Dev only. Tell me the veil % + blur you like and I’ll bake them into{" "}
            <code>--haze-alpha</code> / <code>--haze-blur</code>.
          </p>
        </>
      )}
    </div>
  );
}
