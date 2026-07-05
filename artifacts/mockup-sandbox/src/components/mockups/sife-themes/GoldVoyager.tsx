// SPDX-License-Identifier: AGPL-3.0-or-later
export function GoldVoyager() {
  return (
    <div style={{
      minHeight: "100vh",
      height: "100vh",
      background: "#BEB3A2",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      color: "#1E1A14",
      position: "relative",
      overflow: "hidden",
    }}>

      {/* ── DECORATIVE GEOMETRY ────────────────────────────────────────── */}

      {/* Large amber slab — top-left anchor */}
      <div style={{
        position: "absolute",
        top: 0, left: 0,
        width: "260px", height: "230px",
        background: "#E8A200",
        opacity: 0.82,
        zIndex: 1,
      }} />

      {/* Brown box — repositioned mostly off-screen upper-right;
          lower-left corner sits behind P2P VIDEO in the header */}
      <div style={{
        position: "absolute",
        top: "-125px", left: "230px",
        width: "200px", height: "160px",
        background: "#C85A00",
        opacity: 0.485,
        zIndex: 2,
      }} />

      {/* Outer concrete slab — extends past footer border line, stops before edge */}
      <div style={{
        position: "absolute",
        top: "220px", right: 0,
        width: "33px", height: "460px",
        background: "#5A5248",
        opacity: 0.35,
        zIndex: 1,
      }} />


      {/* Small amber corner triangle — lower-left only (rotated, reduced) */}
      <div style={{
        position: "absolute",
        bottom: 0, left: 0,
        width: "110px", height: "100px",
        background: "#E8A200",
        clipPath: "polygon(0 0, 0 100%, 100% 100%)",
        opacity: 0.5,
        zIndex: 2,
      }} />

      {/* Amber column stripe — left mid */}
      <div style={{
        position: "absolute",
        top: "230px", left: 0,
        width: "14px", height: "220px",
        background: "#F0B800",
        opacity: 0.65,
        zIndex: 4,
      }} />

      {/* Teal accent square — moved 50% toward bottom edge and 50% toward right edge */}
      <div style={{
        position: "absolute",
        top: "620px", left: "257px",
        width: "16px", height: "16px",
        background: "#0D9D8B",
        opacity: 0.9,
        zIndex: 30,
      }} />

      {/* Horizontal red slash — from off left edge, right end at ~30% of frame */}
      <div style={{
        position: "absolute",
        top: "390px", left: "-10px",
        width: "122px", height: "3px",
        background: "#CC2200",
        opacity: 0.88,
        zIndex: 5,
      }} />

      {/* Vertical red line — full height, intersects horizontal at its right-most point */}
      <div style={{
        position: "absolute",
        top: 0, bottom: 0,
        left: "112px",
        width: "3px",
        background: "#CC2200",
        opacity: 0.45,
        zIndex: 5,
      }} />

      {/* Ghost rect — pale gold, upper right */}
      <div style={{
        position: "absolute",
        top: "60px", right: "18px",
        width: "90px", height: "140px",
        background: "#D4A040",
        opacity: 0.22,
        zIndex: 1,
      }} />

      {/* Amber rule — thin horizontal divider, lower third */}
      <div style={{
        position: "absolute",
        bottom: "180px", left: 0, right: 0,
        height: "2px",
        background: "#E8A200",
        opacity: 0.35,
        zIndex: 1,
      }} />

      {/* ── UI CONTENT ─────────────────────────────────────────────────── */}

      {/* Header */}
      <div style={{
        borderBottom: "3px solid #1E1A14",
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "relative",
        zIndex: 20,
      }}>
        <span style={{
          fontFamily: "system-ui, sans-serif",
          fontWeight: 900,
          fontSize: "20px",
          letterSpacing: "-1px",
          color: "#1E1A14",
        }}>SIFE</span>
        <span style={{ fontSize: "10px", letterSpacing: "3px", color: "#1E1A14" }}>P2P VIDEO</span>
      </div>

      {/* Main */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        gap: "26px",
        position: "relative",
        zIndex: 20,
      }}>

        {/* Wordmark */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 900,
            fontSize: "88px",
            letterSpacing: "-4px",
            color: "#1E1A14",
            lineHeight: 1,
            marginBottom: "8px",
          }}>SIFE</div>
          <div style={{
            fontSize: "10px",
            letterSpacing: "4px",
            color: "#5C5040",
            textTransform: "uppercase",
          }}>
            ENCRYPTED · PEER-TO-PEER · VIDEO
          </div>
        </div>

        {/* Feature callout */}
        <div style={{
          border: "3px solid #5C5040",
          padding: "14px 24px",
          textAlign: "center",
          background: "#A89E90",
          width: "100%",
          maxWidth: "290px",
        }}>
          <div style={{ fontSize: "11px", color: "#1E1A14", letterSpacing: "2px", lineHeight: 2 }}>
            NO ACCOUNTS · NO LOGS<br />NO DOWNLOADS · JUST TALK
          </div>
        </div>

        {/* ENTER */}
        <button style={{
          appearance: "none",
          WebkitAppearance: "none",
          background: "#E8A200",
          color: "#1E1A14",
          border: "3px solid #1E1A14",
          borderRadius: 0,
          boxShadow: "none",
          outline: "none",
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700,
          fontSize: "15px",
          letterSpacing: "3px",
          padding: "18px 0",
          width: "100%",
          maxWidth: "290px",
          cursor: "pointer",
          textTransform: "uppercase",
          display: "block",
        }}>
          ENTER
        </button>

        {/* Install hint */}
        <div style={{
          border: "3px solid #C85A00",
          padding: "12px 20px",
          textAlign: "center",
          width: "100%",
          maxWidth: "290px",
          background: "#B8965A",
        }}>
          <div style={{ fontSize: "10px", color: "#3A1800", letterSpacing: "3px", fontWeight: 700, marginBottom: "4px" }}>
            INSTALL AS APP
          </div>
          <div style={{ fontSize: "10px", color: "#2C2018", letterSpacing: "1px" }}>
            USE YOUR BROWSER MENU TO<br />"ADD TO HOME SCREEN"
          </div>
        </div>

      </div>

      {/* Footer */}
      <div style={{
        padding: "12px",
        borderTop: "3px solid #5C5040",
        textAlign: "center",
        position: "relative",
        zIndex: 20,
      }}>
        <div style={{ fontSize: "10px", color: "#7A6850", letterSpacing: "2px" }}>© 2026 SIFE</div>
      </div>

    </div>
  );
}
