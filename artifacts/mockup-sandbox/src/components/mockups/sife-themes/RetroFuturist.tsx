// SPDX-License-Identifier: AGPL-3.0-or-later
export function RetroFuturist() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#EEEAE2",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      color: "#1A1A1A",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "3px solid #1A1A1A",
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#EEEAE2",
      }}>
        <span style={{ fontFamily: "system-ui, sans-serif", fontWeight: 900, fontSize: "20px", letterSpacing: "-1px", color: "#1A1A1A" }}>SIFE</span>
        <span style={{ fontSize: "10px", letterSpacing: "3px", color: "#8A8070" }}>P2P VIDEO</span>
      </div>

      {/* Red horizontal stripe — the retro-futurist signature element */}
      <div style={{ height: "5px", background: "#E02020" }} />

      {/* Main */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        gap: "28px",
      }}>
        {/* Wordmark — bold duotone treatment */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 900,
            fontSize: "88px",
            letterSpacing: "-4px",
            color: "#1A1A1A",
            lineHeight: 1,
            marginBottom: "6px",
            position: "relative",
          }}>
            {/* Pink shadow offset */}
            <span style={{
              position: "absolute",
              left: "4px",
              top: "4px",
              color: "#E91E8C",
              zIndex: 0,
              userSelect: "none",
            }}>SIFE</span>
            <span style={{ position: "relative", zIndex: 1 }}>SIFE</span>
          </div>
          <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#8A8070", textTransform: "uppercase", marginTop: "8px" }}>
            ENCRYPTED · PEER-TO-PEER · VIDEO
          </div>
        </div>

        {/* Feature box — cyan accent */}
        <div style={{
          border: "3px solid #00CEC9",
          padding: "14px 24px",
          textAlign: "center",
          background: "#E4F6F5",
          width: "100%",
          maxWidth: "300px",
        }}>
          <div style={{ fontSize: "11px", color: "#1A1A1A", letterSpacing: "2px", lineHeight: 2 }}>
            NO ACCOUNTS · NO LOGS<br />NO DOWNLOADS · JUST TALK
          </div>
        </div>

        {/* ENTER button — pink fill */}
        <button style={{
          background: "#E91E8C",
          color: "#EEEAE2",
          border: "3px solid #1A1A1A",
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700,
          fontSize: "15px",
          letterSpacing: "3px",
          padding: "18px 0",
          width: "100%",
          maxWidth: "300px",
          cursor: "pointer",
          textTransform: "uppercase",
        }}>
          ENTER
        </button>

        {/* Install hint */}
        <div style={{
          border: "3px solid #F0A500",
          padding: "12px 20px",
          textAlign: "center",
          width: "100%",
          maxWidth: "300px",
          background: "#F7EDD6",
        }}>
          <div style={{ fontSize: "10px", color: "#C87800", letterSpacing: "3px", fontWeight: 700, marginBottom: "4px" }}>INSTALL AS APP</div>
          <div style={{ fontSize: "10px", color: "#7A7060", letterSpacing: "1px" }}>USE YOUR BROWSER MENU TO<br />"ADD TO HOME SCREEN"</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "12px", borderTop: "3px solid #1A1A1A", textAlign: "center" }}>
        <div style={{ fontSize: "10px", color: "#9A9080", letterSpacing: "2px" }}>© 2026 SIFE</div>
      </div>

      {/* Red stripe at very bottom */}
      <div style={{ height: "5px", background: "#E02020" }} />

      {/* Style label */}
      <div style={{
        position: "absolute",
        bottom: "14px",
        right: "12px",
        fontSize: "9px",
        color: "#E91E8C",
        letterSpacing: "2px",
        fontWeight: 700,
      }}>RETRO FUTURIST</div>
    </div>
  );
}
