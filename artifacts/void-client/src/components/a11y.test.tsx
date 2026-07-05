// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "@/test/axe";

// Quiet the audio side-channels these components touch on interaction so the
// a11y renders stay deterministic in jsdom.
vi.mock("@/lib/uiSounds", () => ({
  uiClick: vi.fn(),
  uiSelectClick: vi.fn(),
  getUiSoundsEnabled: vi.fn(() => false),
  setUiSoundsEnabled: vi.fn(),
}));
vi.mock("@/lib/sounds", () => ({
  playClick: vi.fn(),
  getAudioContext: vi.fn(() => null),
}));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: Record<string, unknown>) => (
    <svg data-testid="qr-stub" data-value={String(props.value ?? "")} />
  ),
}));

import SasVerificationDialog from "./SasVerificationDialog";
import BurnedOverlay from "./BurnedOverlay";
import InCallOverflowMenu from "./InCallOverflowMenu";
import PaywallModal from "./PaywallModal";
import RoomShareSheet from "./RoomShareSheet";
import PhraseShareModal from "./PhraseShareModal";
import ConfirmDialog from "./ConfirmDialog";

afterEach(() => {
  cleanup();
});

const PHRASE = "abandon ability able about above absent";
const JOIN_URL = "https://void.example/r/test-room";

function renderOverflowMenu() {
  return render(
    <InCallOverflowMenu
      isHost
      hostPresent
      knockMode={false}
      roomLocked={false}
      handleToggleKnock={() => {}}
      handleToggleLock={() => {}}
      shareAffordance={
        // Mirror RoomHeaderBar's real shape: nested wrapper divs holding the
        // SHARE / SHOW QR menuitem buttons plus a non-interactive caption, so
        // the axe audit sees the production menu nesting, not a lone button.
        <div>
          <div>
            <button type="button" role="menuitem" aria-describedby="share-cap">
              SHARE
            </button>
            <button type="button" role="menuitem" aria-describedby="share-cap">
              SHOW QR
            </button>
          </div>
          <div id="share-cap">Phrase travels in the URL.</div>
        </div>
      }
      btnStyle={{}}
      pausedStyle={undefined}
    />,
  );
}

describe("accessibility audit (axe) — key-flow surfaces", () => {
  it("SAS verification dialog has no axe violations", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <SasVerificationDialog
        sas={["abandon", "foam"]}
        vState="unverified"
        peerLabel="PEER 2"
        peerVoiceModeLabel={null}
        isNarrowViewport={false}
        anchor={anchor}
        onClose={() => {}}
        onVerified={() => {}}
        onMismatch={() => {}}
      />,
    );
    await expectNoAxeViolations(screen.getByRole("dialog"));
    anchor.remove();
  });

  it("burned overlay has no axe violations", async () => {
    render(<BurnedOverlay onDismiss={() => {}} />);
    await expectNoAxeViolations(screen.getByRole("alertdialog"));
  });

  it("in-call overflow menu (open) has no axe violations", async () => {
    const user = userEvent.setup();
    renderOverflowMenu();
    await user.click(screen.getByTestId("incall-overflow-button"));
    await expectNoAxeViolations(screen.getByTestId("incall-overflow-menu"));
  });

  it("paywall modal has no axe violations", async () => {
    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });

  it("room share sheet has no axe violations", async () => {
    render(<RoomShareSheet url={JOIN_URL} phrase={PHRASE} onClose={() => {}} />);
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });

  it("phrase share modal has no axe violations", async () => {
    render(
      <PhraseShareModal phrase={PHRASE} joinUrl={JOIN_URL} onClose={() => {}} />,
    );
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });

  it("confirm dialog has no axe violations", async () => {
    render(
      <ConfirmDialog
        open
        title="ALLOW UNMASKED VIDEO?"
        body="Peers will see your real face."
        confirmLabel="ALLOW"
        cancelLabel="CANCEL"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });
});

describe("SAS dialog screen-reader announcement", () => {
  it("exposes the two words as the dialog's accessible description", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <SasVerificationDialog
        sas={["abandon", "foam"]}
        vState="unverified"
        peerLabel="PEER 2"
        peerVoiceModeLabel={null}
        isNarrowViewport={false}
        anchor={anchor}
        onClose={() => {}}
        onVerified={() => {}}
        onMismatch={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const describedBy = dialog.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
    expect(describedBy).toContain("sas-dialog-words");
    const wordsEl = document.getElementById("sas-dialog-words");
    // The accessible description must include both natural words so a blind
    // user hears them read aloud on open (natural words only — no spelling).
    expect(wordsEl?.textContent).toContain("abandon");
    expect(wordsEl?.textContent).toContain("foam");
    expect(wordsEl?.textContent?.toLowerCase()).toContain("verification words");
    anchor.remove();
  });
});

describe("focus management — in-call overflow menu", () => {
  it("moves focus into the menu on open and back to the trigger on Escape", async () => {
    const user = userEvent.setup();
    renderOverflowMenu();
    const trigger = screen.getByTestId("incall-overflow-button");

    await user.click(trigger);
    const menu = screen.getByTestId("incall-overflow-menu");
    // Focus should have moved into the menu, not stayed on the trigger.
    expect(menu.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(trigger);

    await user.keyboard("{Escape}");
    // Escape closes the menu and returns focus to the trigger.
    expect(screen.queryByTestId("incall-overflow-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("focus management — burned overlay", () => {
  it("moves focus onto the alertdialog on mount", () => {
    render(<BurnedOverlay onDismiss={() => {}} />);
    const overlay = screen.getByRole("alertdialog");
    expect(document.activeElement).toBe(overlay);
  });
});
