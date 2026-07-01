// SPDX-License-Identifier: AGPL-3.0-or-later
// In-room proof captions. Verbatim strings exported for tests.

export const SAS_PROOF_COPY =
  "THIS PROVES YOU’RE TALKING TO WHO YOU THINK YOU ARE.";

export function SasProofCaption() {
  return (
    <div
      data-testid="sas-proof-caption"
      style={{
        fontSize: "12px",
        letterSpacing: "1.5px",
        textTransform: "uppercase",
        color: "var(--teal)",
        fontWeight: 700,
      }}
    >
      {SAS_PROOF_COPY}
    </div>
  );
}
