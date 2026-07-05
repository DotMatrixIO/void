// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DocsThreatModelPage from "@/pages/docs/DocsThreatModelPage";

// This test pins the "A SHORTLIST OF WALLETS THAT ROUTE OVER TOR"
// sub-section on DocsThreatModelPage (anchor #tor-wallet-shortlist,
// data-testid="tor-wallet-shortlist", added in Task #271). It is the
// analogue of threatModelTorComposition.test.tsx and
// threatModelWontFix.test.tsx.
//
// Why pin it specifically: this shortlist is explicitly a SNAPSHOT,
// NOT an endorsement. It is marked WATCH in
// docs/marketing-claims-audit.md because third-party wallet behaviour
// drifts — a wallet can drop Tor support, drop a platform, or pivot
// its custody model between releases. VOID is deliberately not the
// source of truth for whether a third-party wallet routes over Tor;
// each entry carries its own project's Tor documentation as the cited
// primary source.
//
// What this test forces: a contributor who edits the shortlist cannot
// silently soften a description or swap a wallet without tripping this
// test, which (a) confirms the anchor and data-testid still exist,
// (b) confirms each named wallet is still present, and (c) confirms
// each wallet's cited primary-source URL is still present and still
// points at that wallet's own project doc. The loud failure message
// reminds the contributor to RE-VERIFY each entry against its linked
// doc and to update the marketing-claims-audit row in the same commit.

// Each entry: the wallet name as published, and the primary-source URL
// cited inline next to it. If a wallet drops Tor support, the audit row
// says to STRIKE it from the list rather than soften the description —
// which means deleting the corresponding entry here too, in the same
// commit, after re-verifying against the linked doc.
const WALLETS: ReadonlyArray<{ name: string; source: string }> = [
  { name: "Zeus", source: "https://docs.zeusln.com/category/tor" },
  { name: "Phoenix", source: "https://phoenix.acinq.co/faq" },
  {
    name: "BitBanana",
    source: "https://github.com/michaelWuensch/BitBanana/wiki/Tor",
  },
];

const FAILURE_MESSAGE =
  "\n\n" +
  "================================================================\n" +
  "DocsThreatModelPage Tor-wallet shortlist assertion failed.\n" +
  "================================================================\n" +
  "\n" +
  "This pins the \"A SHORTLIST OF WALLETS THAT ROUTE OVER TOR\"\n" +
  "sub-section (anchor #tor-wallet-shortlist). The list is a\n" +
  "SNAPSHOT, NOT an endorsement, and is marked WATCH in\n" +
  "docs/marketing-claims-audit.md because wallet behaviour drifts.\n" +
  "\n" +
  "Before you change this list, RE-VERIFY each entry against its\n" +
  "cited primary source:\n" +
  "  - Zeus      -> https://docs.zeusln.com/category/tor\n" +
  "  - Phoenix   -> https://phoenix.acinq.co/faq\n" +
  "  - BitBanana -> https://github.com/michaelWuensch/BitBanana/wiki/Tor\n" +
  "\n" +
  "If a wallet has dropped Tor support, dropped a platform, or\n" +
  "pivoted its custody model: STRIKE it from the list rather than\n" +
  "soften the description, and delete its entry from WALLETS in\n" +
  "this test file in the same commit.\n" +
  "\n" +
  "Whatever you change, update the\n" +
  "\"Tor-routed wallet shortlist\" row in\n" +
  "docs/marketing-claims-audit.md in the SAME commit so the audit\n" +
  "ledger and this pin stay in lockstep. Do not just delete this\n" +
  "assertion to make the build green.\n" +
  "================================================================\n";

describe("DocsThreatModelPage \u2014 Tor-wallet shortlist", () => {
  it("keeps the #tor-wallet-shortlist anchor and data-testid present", () => {
    const { container } = render(<DocsThreatModelPage />);

    const anchor = container.querySelector("#tor-wallet-shortlist");
    if (anchor === null) {
      throw new Error(
        "Expected an element with id=\"tor-wallet-shortlist\" on " +
          "DocsThreatModelPage." +
          FAILURE_MESSAGE,
      );
    }

    const list = screen.queryByTestId("tor-wallet-shortlist");
    if (list === null) {
      throw new Error(
        "Expected an element with data-testid=\"tor-wallet-shortlist\" on " +
          "DocsThreatModelPage." +
          FAILURE_MESSAGE,
      );
    }
  });

  it("names each vetted wallet alongside its cited primary-source link", () => {
    const { container } = render(<DocsThreatModelPage />);
    const list = screen.queryByTestId("tor-wallet-shortlist");
    if (list === null) {
      throw new Error(
        "Expected an element with data-testid=\"tor-wallet-shortlist\" on " +
          "DocsThreatModelPage." +
          FAILURE_MESSAGE,
      );
    }

    const listText = list.textContent ?? "";

    for (const { name, source } of WALLETS) {
      if (!listText.includes(name)) {
        throw new Error(
          `Expected the Tor-wallet shortlist to still name "${name}".` +
            FAILURE_MESSAGE,
        );
      }

      const link = container.querySelector(`a[href="${source}"]`);
      if (link === null) {
        throw new Error(
          `Expected the Tor-wallet shortlist to cite "${name}" with its ` +
            `primary-source link ${source}.` +
            FAILURE_MESSAGE,
        );
      }
    }
  });
});
