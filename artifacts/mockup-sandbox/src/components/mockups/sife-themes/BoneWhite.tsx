// SPDX-License-Identifier: AGPL-3.0-or-later
export function BoneWhite() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#F2EDE4",
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
        background: "#F2EDE4",
      }}>
        <span style={{ fontFamily: "system-ui, sans-serif", fontWeight: 900, fontSize: "20px", letterSpacing: "-1px", color: "#1A1A1A" }}>SIFE</span>
        <span style={{ fontSize: "10px", letterSpacing: "3px", color: "#666" }}>P2P VIDEO</span>
      </div>

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
        {/* Wordmark */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 900,
            fontSize: "88px",
            letterSpacing: "-4px",
            color: "#1A1A1A",
            lineHeight: 1,
            marginBottom: "6px",
          }}>SIFE</div>
          <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#888", textTransform: "uppercase" }}>
            ENCRYPTED · PEER-TO-PEER · VIDEO
          </div>
        </div>

        {/* Feature box */}
        <div style={{
          border: "3px solid #B0A898",
          padding: "14px 24px",
          textAlign: "center",
          background: "#EDE8DF",
          width: "100%",
          maxWidth: "300px",
        }}>
          <div style={{ fontSize: "11px", color: "#555", letterSpacing: "2px", lineHeight: 2 }}>
            NO ACCOUNTS · NO LOGS<br />NO DOWNLOADS · JUST TALK
          </div>
        </div>

        {/* ENTER button */}
        <button style={{
          background: "#C8211A",
          color: "#F2EDE4",
          border: "3px solid #C8211A",
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
          border: "3px solid #5BA4C9",
          padding: "12px 20px",
          textAlign: "center",
          width: "100%",
          maxWidth: "300px",
          background: "#ECF4FA",
        }}>
          <div style={{ fontSize: "10px", color: "#5BA4C9", letterSpacing: "3px", fontWeight: 700, marginBottom: "4px" }}>INSTALL AS APP</div>
          <div style={{ fontSize: "10px", color: "#888", letterSpacing: "1px" }}>USE YOUR BROWSER MENU TO<br />"ADD TO HOME SCREEN"</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "12px", borderTop: "3px solid #D8D0C4", textAlign: "center" }}>
        <div style={{ fontSize: "10px", color: "#AAA", letterSpacing: "2px" }}>© 2026 SIFE</div>
      </div>

      {/* Style label */}
      <div style={{
        position: "absolute",
        bottom: "8px",
        right: "12px",
        fontSize: "9px",
        color: "#5BA4C9",
        letterSpacing: "2px",
        fontWeight: 700,
      }}>BONE WHITE</div>
    </div>
  );
}
