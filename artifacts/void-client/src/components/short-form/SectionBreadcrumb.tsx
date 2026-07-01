// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties } from "react";

interface SectionBreadcrumbProps {
  sections: ReadonlyArray<string>;
}

const breadcrumbStyle: CSSProperties = {
  marginTop: "16px",
  color: "#5C5040",
  fontSize: "12px",
  letterSpacing: "1px",
  fontFamily: "var(--font-mono)",
};

export default function SectionBreadcrumb({ sections }: SectionBreadcrumbProps) {
  return (
    <p style={breadcrumbStyle} data-testid="section-breadcrumb">
      {sections.join(" · ")}
    </p>
  );
}
