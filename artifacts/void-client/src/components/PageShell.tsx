// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ReactNode } from "react";
import { Link } from "wouter";
import HamburgerMenu from "@/components/HamburgerMenu";
import PageFooter from "@/components/PageFooter";

// Single source of truth for the long-form page/docs chrome: the global
// HamburgerMenu, the pixelated home icon + "← BACK" header row, the centered
// column layout, and the shared PageFooter. Every docs and marketing page
// renders its sections as children of this shell instead of re-pasting the
// header markup, which is the root-cause fix for the type/chrome drift called
// out in aesthetic-audit finding C8.

interface PageShellProps {
  children: ReactNode;
  /** Target of the "← BACK" link. The home icon always returns to "/". */
  backHref?: string;
  /** Label of the BACK link (some pages return to a long-form parent). */
  backLabel?: string;
  /** Optional override for the footer's top padding. */
  footerPaddingTop?: string;
}

const containerStyle: React.CSSProperties = {
  minHeight: "100svh",
  background: "transparent",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "0 16px 60px",
  fontFamily: "var(--font-mono)",
  color: "var(--fg)",
  gap: "0",
};

const headerRowStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "680px",
  padding: "20px 0",
  paddingRight: "52px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const backLinkStyle: React.CSSProperties = {
  fontSize: "12px",
  letterSpacing: "2px",
  color: "var(--fg-dim)",
  textDecoration: "none",
  textTransform: "uppercase",
};

export default function PageShell({
  children,
  backHref = "/",
  backLabel = "← BACK",
  footerPaddingTop,
}: PageShellProps) {
  return (
    <div style={containerStyle}>
      <HamburgerMenu />

      <div style={headerRowStyle}>
        <Link href="/" style={{ textDecoration: "none", lineHeight: 0 }}>
          <img
            src="/void-icon.png"
            alt="VOID"
            style={{ width: "36px", height: "36px", imageRendering: "pixelated" }}
          />
        </Link>
        <Link href={backHref} style={backLinkStyle}>
          {backLabel}
        </Link>
      </div>

      {children}

      <PageFooter {...(footerPaddingTop ? { paddingTop: footerPaddingTop } : {})} />
    </div>
  );
}
