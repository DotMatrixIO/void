// SPDX-License-Identifier: AGPL-3.0-or-later
export function BrutalistaForm() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#EDE0CD",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      color: "#1A1A1A",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Crimson header bar */}
      <div style={{
        borderBottom: "3px solid #1A1A1A",
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#CC1F1F",
      }}>
        <span style={{ fontFamily: "system-ui, sans-serif", fontWeight: 900, fontSize: "20px", letterSpacing: "-1px", color: "#EDE0CD" }}>SIFE</span>
        <span style={{ fontSize: "10px", letterSpacing: "3px", color: "#EDE0CD", opacity: 0.8 }}>P2P VIDEO</span>
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
            color: "#CC1F1F",
            lineHeight: 1,
            marginBottom: "6px",
          }}>SIFE</div>
          <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#6B4F3A", textTransform: "uppercase" }}>
            ENCRYPTED · PEER-TO-PEER · VIDEO
          </div>
        </div>

        {/* Feature box — teal border */}
        <div style={{
          border: "3px solid #0D9D8B",
          padding: "14px 24px",
          textAlign: "center",
          background: "#E4D4BC",
          width: "100%",
          maxWidth: "300px",
        }}>
          <div style={{ fontSize: "11px", color: "#3A2A1A", letterSpacing: "2px", lineHeight: 2 }}>
            NO ACCOUNTS · NO LOGS<br />NO DOWNLOADS · JUST TALK
          </div>
        </div>

        {/* ENTER button — solid red */}
        <button style={{
          background: "#CC1F1F",
          color: "#EDE0CD",
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

        {/* Install hint — teal */}
        <div style={{
          border: "3px solid #0D9D8B",
          padding: "12px 20px",
          textAlign: "center",
          width: "100%",
          maxWidth: "300px",
          background: "#D4E8E4",
        }}>
          <div style={{ fontSize: "10px", color: "#0D9D8B", letterSpacing: "3px", fontWeight: 700, marginBottom: "4px" }}>INSTALL AS APP</div>
          <div style={{ fontSize: "10px", color: "#5A5050", letterSpacing: "1px" }}>USE YOUR BROWSER MENU TO<br />"ADD TO HOME SCREEN"</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "12px", borderTop: "3px solid #CC1F1F", textAlign: "center", background: "#E4D0BA" }}>
        <div style={{ fontSize: "10px", color: "#9B6A44", letterSpacing: "2px" }}>© 2026 SIFE</div>
      </div>

      {/* Style label */}
      <div style={{
        position: "absolute",
        bottom: "8px",
        right: "12px",
        fontSize: "9px",
        color: "#CC1F1F",
        letterSpacing: "2px",
        fontWeight: 700,
      }}>BRUTALISTA FORM</div>
    </div>
  );
}
