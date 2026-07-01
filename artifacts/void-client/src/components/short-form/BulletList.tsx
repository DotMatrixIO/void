// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties, ReactNode } from "react";

export type ShortFormBullet = {
  marker: string;
  claim: string;
  body: ReactNode;
};

interface BulletListProps {
  bullets: ReadonlyArray<ShortFormBullet>;
  "data-testid"?: string;
}

const listStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "0 0 28px",
  display: "flex",
  flexDirection: "column",
  gap: "22px",
};

const itemStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "14px",
  alignItems: "start",
};

const markerStyle: CSSProperties = {
  color: "var(--gold)",
  fontFamily: "var(--font-mono)",
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "1px",
  lineHeight: 1.8,
  whiteSpace: "nowrap",
};

const bodyStyle: CSSProperties = { color: "var(--fg-on-dark)", lineHeight: 1.7 };

const claimStyle: CSSProperties = {
  display: "block",
  color: "var(--gold)",
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  fontSize: "13px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  marginBottom: "4px",
};

export default function BulletList({
  bullets,
  "data-testid": testid,
}: BulletListProps) {
  return (
    <ul style={listStyle} data-testid={testid}>
      {bullets.map((b) => (
        <li key={b.marker} style={itemStyle} data-testid="short-form-bullet">
          <span style={markerStyle}>{b.marker}</span>
          <div style={bodyStyle}>
            <span style={claimStyle}>{b.claim}</span>
            {b.body}
          </div>
        </li>
      ))}
    </ul>
  );
}
