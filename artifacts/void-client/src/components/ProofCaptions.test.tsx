// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SasProofCaption, SAS_PROOF_COPY } from "./ProofCaptions";

describe("SasProofCaption", () => {
  it("renders the verbatim SAS proof copy", () => {
    render(<SasProofCaption />);
    expect(screen.getByTestId("sas-proof-caption")).toHaveTextContent(
      "THIS PROVES YOU’RE TALKING TO WHO YOU THINK YOU ARE.",
    );
    expect(SAS_PROOF_COPY).toBe(
      "THIS PROVES YOU’RE TALKING TO WHO YOU THINK YOU ARE.",
    );
  });
});
