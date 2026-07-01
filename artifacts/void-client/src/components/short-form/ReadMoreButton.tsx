// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties } from "react";
import { Link } from "wouter";

interface ReadMoreButtonProps {
  href: string;
  label?: string;
}

const buttonStyle: CSSProperties = {
  display: "inline-block",
  fontFamily: "var(--font-mono)",
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "3px",
  textTransform: "uppercase",
  color: "var(--gold)",
  textDecoration: "none",
  border: "2px solid var(--gold)",
  padding: "12px 18px",
  backgroundColor: "rgba(232,162,0,0.04)",
  marginTop: "8px",
};

export default function ReadMoreButton({
  href,
  label = "READ THE LONG VERSION →",
}: ReadMoreButtonProps) {
  return (
    <Link href={href} style={buttonStyle} data-testid="read-more-button">
      {label}
    </Link>
  );
}
