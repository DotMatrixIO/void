// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties } from "react";

type Props = {
  "data-testid"?: string;
  style?: CSSProperties;
};

export default function OpenBetaCaption({
  "data-testid": dataTestId,
  style,
}: Props) {
  return (
    <div
      data-testid={dataTestId}
      style={{
        width: "100%",
        maxWidth: "680px",
        marginTop: "-12px",
        marginBottom: "20px",
        paddingRight: "52px",
        textAlign: "right",
        fontSize: "11px",
        lineHeight: 1.45,
        letterSpacing: "1px",
        color: "var(--fg-dim)",
        textTransform: "uppercase",
        ...style,
      }}
    >
      This is OPEN BETA · v0.5
      <br />
      We expect to find bugs for a while.
    </div>
  );
}
