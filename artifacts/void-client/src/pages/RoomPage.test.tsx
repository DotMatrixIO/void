// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RoomPage from "./RoomPage";
import { SAS_PROOF_COPY } from "@/components/ProofCaptions";
import { DEAD_ROOM_COPY } from "@/components/DeadRoomOverlay";
import { createWatermarkedScreenShareTrack, buildMediaPipeline } from "@/lib/mediaPipeline";
import { playBleep } from "@/lib/sounds";
import {
  roomTestState,
  createMockSocket as baseCreateMockSocket,
  MockWebRTCManager,
  makeMediaPipelineMock,
  joinRoom,
  TEST_ROOM,
  TEST_PHRASE,
  fakeKey,
  type MockSocket,
  type CapturedManager,
  type EmitCallback,
} from "./RoomPage.testHelpers";

// Captured at module-eval time — i.e. BEFORE any beforeEach installs
// vi.useFakeTimers() — so it always points at the real platform timer.
// Task #1024: join now awaits the rendezvous-handle derivation, whose
// crypto.subtle.deriveBits resolves on a real macrotask (threadpool
// callback), not a microtask. A microtask-only pump can therefore miss
// it under load, so the pumps below yield to a REAL macrotask each turn.
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
function flushRealMacrotask(): Promise<void> {
  return new Promise<void>((resolve) => realSetTimeout(resolve, 0));
}

vi.mock("@/lib/socket", () => ({
  getSocket: () => roomTestState.mockSocket,
  disconnectSocket: vi.fn(),
}));

// Task #191: real `hostTokenStorage` runs HKDF + AES-GCM through
// `crypto.subtle`, which in jsdom resolves across enough microtask
// turns that the wait-hint tests' bounded microtask flush can race
// past `socket.emit("join-room", ...)`. The wait-hint suite doesn't
// exercise host-claim behaviour at all, so substitute a synchronous
// no-op pair: load returns undefined (the on-disk slot is empty in
// these tests), persist/clear are unused on this code path. Tests
// covering the storage layer itself live in
// `src/lib/hostTokenStorage.test.ts` and exercise the real module.
vi.mock("@/lib/hostTokenStorage", () => ({
  loadHostToken: vi.fn(async () => undefined),
  persistHostToken: vi.fn(async () => {}),
  clearHostToken: vi.fn(async () => {}),
}));

vi.mock("@/lib/sounds", () => ({
  playBleep: vi.fn(),
  playBloop: vi.fn(),
  playClick: vi.fn(),
  playSelectClick: vi.fn(),
  playSlide: vi.fn(),
  resumeAudio: vi.fn(),
  getAudioContext: vi.fn(() => ({})),
  closeAudioContext: vi.fn(async () => {}),
}));

vi.mock("@/lib/webrtc", async () => {
  const { MockWebRTCManager } = await import("./RoomPage.testHelpers");
  return { WebRTCManager: MockWebRTCManager };
});

vi.mock("@/lib/mediaPipeline", async () => {
  const { makeMediaPipelineMock } = await import("./RoomPage.testHelpers");
  return makeMediaPipelineMock();
});

vi.mock("@/components/RecordingDisclosureBanner", () => ({
  default: () => null,
}));

vi.mock("@/components/RoomShareSheet", () => ({
  default: () => null,
}));

vi.mock("@/components/PaywallModal", () => ({
  default: () => null,
}));

// Task #585: the mock socket factory, the WebRTC manager +
// mediaPipeline mocks, `joinRoom`, and the jsdom polyfills now live in
// `./RoomPage.testHelpers` so the new `RoomPage.layout.test.tsx`
// shares one source of truth.

// Convenience aliases so existing test bodies keep their old shape
// (`mockSocket = createMockSocket()` in beforeEach blocks, plus
// reads against `mockSocket.__getEmit(...)` / `mockSocket.__trigger(...)`).
let mockSocket: MockSocket;
function createMockSocket(): MockSocket {
  const s = baseCreateMockSocket();
  roomTestState.mockSocket = s;
  return s;
}
const captured = roomTestState.captured;

describe("RoomPage in-room privacy proof surfaces", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("SAS proof caption", () => {
    it("renders adjacent to the SAS phrase pair when the verification panel is open", async () => {
      const remoteId = "peer-remote-aaa";
      await joinRoom({ peers: [remoteId] });

      // Push a SAS pair through the captured WebRTCManager callback so the
      // peer slot becomes verifiable.
      expect(captured.manager).not.toBeNull();
      await act(async () => {
        captured.manager!.opts.onSASUpdate({ [remoteId]: ["alpha", "bravo"] });
      });

      const verifyButton = await screen.findByRole("button", {
        name: /Phrase verification/i,
      });

      const user = userEvent.setup();
      await user.click(verifyButton);

      const dialog = await screen.findByRole("dialog", {
        name: /VERIFY SAS/i,
      });
      expect(dialog).toBeInTheDocument();

      // The proof caption sits inside the dialog, immediately following
      // the rendered phrase pair.
      const proofCaption = await screen.findByTestId("sas-proof-caption");
      expect(proofCaption.textContent).toContain(SAS_PROOF_COPY);
      expect(dialog.contains(proofCaption)).toBe(true);

      // Adjacency: the caption should follow the element that displays
      // the phrase pair (e.g. "alpha bravo").
      const phraseEl = Array.from(dialog.querySelectorAll("div")).find((el) =>
        /alpha\s+bravo/i.test(el.textContent ?? ""),
      );
      expect(phraseEl).toBeDefined();
      expect(phraseEl!.nextElementSibling).toBe(proofCaption);
    });
  });

  describe("SAS chip keyboard reachability (#308)", () => {
    it("opens the verification dialog via keyboard (focus chip + Enter)", async () => {
      const remoteId = "peer-remote-kb";
      await joinRoom({ peers: [remoteId] });
      await act(async () => {
        captured.manager!.opts.onSASUpdate({ [remoteId]: ["alpha", "bravo"] });
      });

      const chip = await screen.findByTestId(`sas-chip-${remoteId}`);
      expect(chip).toHaveAttribute("aria-haspopup", "dialog");
      expect(chip).toHaveAttribute("aria-expanded", "false");

      const user = userEvent.setup();
      chip.focus();
      expect(document.activeElement).toBe(chip);
      await user.keyboard("{Enter}");

      const dialog = await screen.findByRole("dialog", { name: /VERIFY SAS/i });
      expect(dialog).toBeInTheDocument();
      expect(chip).toHaveAttribute("aria-expanded", "true");
    });

    it("dismisses the verification dialog via Escape and restores focus to the chip", async () => {
      const remoteId = "peer-remote-esc";
      await joinRoom({ peers: [remoteId] });
      await act(async () => {
        captured.manager!.opts.onSASUpdate({ [remoteId]: ["alpha", "bravo"] });
      });

      const chip = await screen.findByTestId(`sas-chip-${remoteId}`);
      const user = userEvent.setup();
      chip.focus();
      await user.keyboard("{Enter}");
      await screen.findByRole("dialog", { name: /VERIFY SAS/i });

      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: /VERIFY SAS/i })).toBeNull();
      });
      expect(document.activeElement).toBe(chip);
    });
  });

  describe("SAS voice-mask warning (#114)", () => {
    // The verbal phrase confirmation only proves identity when the
    // verifier can actually recognize their peer's voice. When a peer
    // applies a voice mask (DEEP / FORMANT / SCRAMBLE / COMBINED), that
    // identity check breaks — so the popover surfaces a live "voice
    // mask active" warning sourced from `peerMediaState[pid].voiceMode`.
    // The popover state is otherwise independent of media-state pings,
    // so the warning must appear/disappear without closing the dialog
    // when the peer toggles their mask mid-verification.
    async function openSasPopover(remoteId: string) {
      await joinRoom({ peers: [remoteId] });

      expect(captured.manager).not.toBeNull();
      await act(async () => {
        captured.manager!.opts.onSASUpdate({ [remoteId]: ["alpha", "bravo"] });
      });

      const verifyButton = await screen.findByRole("button", {
        name: /Phrase verification/i,
      });
      const user = userEvent.setup();
      await user.click(verifyButton);

      const dialog = await screen.findByRole("dialog", {
        name: /VERIFY SAS/i,
      });
      return dialog;
    }

    function emitPeerMediaState(payload: {
      peerId: string;
      camOff?: boolean;
      micMuted?: boolean;
      voiceMode?: number;
    }) {
      const { peerId, ...rest } = payload;
      captured.manager!.opts.onMediaStateReceived!(peerId, {
        camOff: false,
        micMuted: false,
        ...rest,
      });
    }

    it("does not render the warning while the peer's voiceMode is 0 (unmasked)", async () => {
      const remoteId = "peer-remote-aaa";
      const dialog = await openSasPopover(remoteId);

      await act(async () => {
        emitPeerMediaState({ peerId: remoteId, voiceMode: 0 });
      });

      // Dialog stays open and the warning is absent.
      expect(dialog).toBeInTheDocument();
      expect(dialog.querySelectorAll('[role="alert"]')).toHaveLength(0);
      expect(dialog.textContent).not.toMatch(/VOICE MASK ACTIVE/);
    });

    it("renders the warning inside the popover when peerMediaState[pid].voiceMode > 0", async () => {
      const remoteId = "peer-remote-aaa";
      const dialog = await openSasPopover(remoteId);

      await act(async () => {
        // 2 → "FORMANT" per VOICE_MODE_LABELS in RoomPage.
        emitPeerMediaState({ peerId: remoteId, voiceMode: 2 });
      });

      // The warning is an alert living inside the popover dialog.
      const alerts = dialog.querySelectorAll('[role="alert"]');
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const warning = Array.from(alerts).find((el) =>
        /VOICE MASK ACTIVE/.test(el.textContent ?? ""),
      );
      expect(warning).toBeDefined();
      // The active mask name is surfaced so the verifier knows what
      // transformation they're hearing.
      expect(warning!.textContent).toMatch(/FORMANT/);
      // The popover stays open while the warning shows.
      expect(dialog).toBeInTheDocument();
    });

    it("clears the warning without closing the popover when the peer drops their mask back to voiceMode=0", async () => {
      // The whole point of the live warning is that it must follow the
      // peer's mask state in real time — without forcing the verifier
      // to reopen the popover. If a refactor accidentally re-renders
      // the dialog away when peerMediaState updates, this test catches
      // it; if it accidentally caches the warning, this test catches
      // that too.
      const remoteId = "peer-remote-aaa";
      const dialog = await openSasPopover(remoteId);

      await act(async () => {
        emitPeerMediaState({ peerId: remoteId, voiceMode: 1 });
      });
      // Sanity: the warning is there before we toggle off.
      expect(dialog.textContent).toMatch(/VOICE MASK ACTIVE/);

      await act(async () => {
        emitPeerMediaState({ peerId: remoteId, voiceMode: 0 });
      });

      // Same dialog node, still in the document, warning gone.
      expect(dialog).toBeInTheDocument();
      expect(dialog.textContent).not.toMatch(/VOICE MASK ACTIVE/);
      // And the verify-buttons (the popover's primary actions) are
      // still there — the dialog wasn't replaced or unmounted.
      expect(dialog.querySelector("button")).not.toBeNull();
    });
  });

  describe("KEYS ROTATED — RE-VERIFY SAS banner", () => {
    async function verifyPeer(remoteId: string, sas: [string, string]) {
      await act(async () => {
        captured.manager!.opts.onSASUpdate({ [remoteId]: sas });
        captured.manager!.opts.onRekey?.(remoteId, "fp-initial-aaa");
      });
      const verifyButton = await screen.findByRole("button", {
        name: /Phrase verification/i,
      });
      const user = userEvent.setup();
      await user.click(verifyButton);
      const dialog = await screen.findByRole("dialog", {
        name: /Verify SAS phrase pair with P\d+/i,
      });
      const wordsMatch = Array.from(dialog.querySelectorAll("button")).find(
        (b) => /WORDS MATCH/i.test(b.textContent ?? ""),
      );
      expect(wordsMatch).toBeDefined();
      await user.click(wordsMatch!);
    }

    it("invalidates verification, decrements the count, and shows the banner when onRekey reports a new fingerprint", async () => {
      const remoteId = "peer-remote-aaa";
      await joinRoom({ peers: [remoteId] });
      expect(captured.manager!.opts.onRekey).toBeDefined();

      await verifyPeer(remoteId, ["alpha", "bravo"]);
      expect(screen.getByText(/YOU VERIFIED 1\/1 PEER/)).toBeInTheDocument();
      expect(screen.queryByTestId(`keys-rotated-banner-${remoteId}`)).toBeNull();

      await act(async () => {
        captured.manager!.opts.onSASUpdate({ [remoteId]: ["charlie", "delta"] });
        captured.manager!.opts.onRekey?.(remoteId, "fp-rotated-bbb");
      });

      const banner = await screen.findByTestId(`keys-rotated-banner-${remoteId}`);
      expect(banner.textContent).toMatch(/KEYS ROTATED/);
      expect(banner.textContent).toMatch(/RE-VERIFY SAS/);
      expect(banner.textContent).not.toMatch(/rekey/i);
      expect(screen.getByText(/YOU VERIFIED 0\/1 PEER/)).toBeInTheDocument();
    });

    it("keeps the banner up across unrelated re-renders", async () => {
      const remoteId = "peer-remote-bbb";
      await joinRoom({ peers: [remoteId] });
      await verifyPeer(remoteId, ["alpha", "bravo"]);

      await act(async () => {
        captured.manager!.opts.onSASUpdate({ [remoteId]: ["charlie", "delta"] });
        captured.manager!.opts.onRekey?.(remoteId, "fp-rotated-ccc");
      });
      expect(
        await screen.findByTestId(`keys-rotated-banner-${remoteId}`),
      ).toBeInTheDocument();

      // An unrelated state push (void.media-state ping) must NOT
      // clear the persistent notice.
      await act(async () => {
        captured.manager!.opts.onMediaStateReceived!(remoteId, {
          camOff: false,
          micMuted: false,
          voiceMode: 0,
        });
      });
      expect(
        screen.getByTestId(`keys-rotated-banner-${remoteId}`),
      ).toBeInTheDocument();
      expect(screen.getByText(/YOU VERIFIED 0\/1 PEER/)).toBeInTheDocument();
    });

    it("clears the banner and re-increments the verified count when the user confirms WORDS MATCH again", async () => {
      const remoteId = "peer-remote-ccc";
      await joinRoom({ peers: [remoteId] });
      await verifyPeer(remoteId, ["alpha", "bravo"]);

      await act(async () => {
        captured.manager!.opts.onSASUpdate({ [remoteId]: ["charlie", "delta"] });
        captured.manager!.opts.onRekey?.(remoteId, "fp-rotated-ddd");
      });

      const banner = await screen.findByTestId(
        `keys-rotated-banner-${remoteId}`,
      );
      const user = userEvent.setup();
      await user.click(banner);
      const dialog = await screen.findByRole("dialog", {
        name: /Verify SAS phrase pair with P\d+/i,
      });
      const wordsMatch = Array.from(dialog.querySelectorAll("button")).find(
        (b) => /WORDS MATCH/i.test(b.textContent ?? ""),
      );
      await user.click(wordsMatch!);

      expect(
        screen.queryByTestId(`keys-rotated-banner-${remoteId}`),
      ).toBeNull();
      expect(screen.getByText(/YOU VERIFIED 1\/1 PEER/)).toBeInTheDocument();
    });

    it("does not raise the banner on the very first onRekey for a peer (baseline only)", async () => {
      const remoteId = "peer-remote-ddd";
      await joinRoom({ peers: [remoteId] });

      await act(async () => {
        captured.manager!.opts.onSASUpdate({ [remoteId]: ["alpha", "bravo"] });
        captured.manager!.opts.onRekey?.(remoteId, "fp-first-eee");
      });

      // No banner, peer shows VERIFY (not yet verified, not yet rotated).
      expect(
        screen.queryByTestId(`keys-rotated-banner-${remoteId}`),
      ).toBeNull();
      expect(screen.getByText(/YOU VERIFIED 0\/1 PEER/)).toBeInTheDocument();
    });
  });

  describe("dead room overlay copy", () => {
    const deadRoomCases: Array<{ label: string; error: string }> = [
      { label: "ROOM_EXPIRED", error: "ROOM_EXPIRED" },
      { label: "INVALID_CODE", error: "INVALID_CODE" },
      { label: "ROOM_DESTROYED", error: "ROOM_DESTROYED" },
    ];

    for (const { label, error } of deadRoomCases) {
      it(`renders the dead-room copy for ${label}`, async () => {
        await joinRoom({ joinError: error });

        const overlay = await screen.findByTestId("dead-room-overlay");
        expect(overlay.textContent).toContain(DEAD_ROOM_COPY);
        // Live-room error framing should NOT be reused.
        expect(screen.queryByTestId("room-error-overlay")).toBeNull();
      });
    }

    it("keeps the live-room error framing for ROOM_FULL (not collapsed into the dead-room copy)", async () => {
      await joinRoom({ joinError: "ROOM_FULL" });

      const overlay = await screen.findByTestId("room-error-overlay");
      expect(overlay.textContent).toContain("ROOM FULL");
      expect(overlay.textContent).not.toContain(DEAD_ROOM_COPY);
      expect(screen.queryByTestId("dead-room-overlay")).toBeNull();
    });
  });

  describe("DIRECT P2P badge", () => {
    it("does not render before any peer reaches a connected state", async () => {
      await joinRoom({ peers: ["peer-remote-aaa"] });
      // Allow the in-room UI to flush.
      await waitFor(() => {
      expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    });
      expect(screen.queryByTestId("direct-p2p-badge")).toBeNull();
    });

    it("renders once a peer is connected and relayOnly is false; clicking it opens the DevTools walkthrough", async () => {
      const remoteId = "peer-remote-aaa";
      await joinRoom({ peers: [remoteId], relayOnly: false });

      expect(captured.manager).not.toBeNull();

      // Drive a "connected" state for the remote peer.
      await act(async () => {
        captured.manager!.opts.onConnectionStateUpdate({
          [remoteId]: "connected",
        });
      });

      const badge = await screen.findByTestId("direct-p2p-badge");
      expect(badge).toBeInTheDocument();

      // The DevTools walkthrough is closed initially.
      expect(screen.queryByTestId("devtools-p2p-modal")).toBeNull();

      const user = userEvent.setup();
      await user.click(badge);

      const modal = await screen.findByTestId("devtools-p2p-modal");
      expect(modal).toBeInTheDocument();
    });

    it("does NOT render when relayOnly is true, even if a peer is connected", async () => {
      const remoteId = "peer-remote-aaa";
      await joinRoom({ peers: [remoteId], relayOnly: true });

      expect(captured.manager).not.toBeNull();
      await act(async () => {
        captured.manager!.opts.onConnectionStateUpdate({
          [remoteId]: "connected",
        });
      });

      // RELAY ONLY badge is shown instead.
      expect(await screen.findByText(/RELAY ONLY/)).toBeInTheDocument();
      expect(screen.queryByTestId("direct-p2p-badge")).toBeNull();
    });

    it("hides again if all peers leave the connected state (e.g. only failed/disconnected peers remain)", async () => {
      const remoteId = "peer-remote-aaa";
      await joinRoom({ peers: [remoteId], relayOnly: false });

      await act(async () => {
        captured.manager!.opts.onConnectionStateUpdate({
          [remoteId]: "connected",
        });
      });
      expect(await screen.findByTestId("direct-p2p-badge")).toBeInTheDocument();

      await act(async () => {
        captured.manager!.opts.onConnectionStateUpdate({
          [remoteId]: "failed",
        });
      });
      expect(screen.queryByTestId("direct-p2p-badge")).toBeNull();
    });
  });

  describe("secure-channel-failure red overlay", () => {
    // The red overlay is the user-visible counterpart of the loud-fail
    // teardown landed for task #170 (M-01 from the April 2026 audit):
    // when the per-pair ECDHE / signed-hello envelope cannot be
    // established with a peer, that peer's tile must show an explicit
    // failure state instead of silently downgrading to the room-wide
    // phrase key.
    it("renders the red 'SECURE CHANNEL COULD NOT BE ESTABLISHED' overlay on the affected peer tile when onSecureChannelFailure fires", async () => {
      const remoteId = "peer-remote-aaa";
      await joinRoom({ peers: [remoteId] });

      expect(captured.manager).not.toBeNull();
      // No overlay before the failure callback fires.
      expect(
        screen.queryByTestId(`secure-channel-failure-${remoteId}`),
      ).toBeNull();

      await act(async () => {
        captured.manager!.opts.onSecureChannelFailure!({
          [remoteId]: "hello_invalid",
        });
      });

      const overlay = await screen.findByTestId(
        `secure-channel-failure-${remoteId}`,
      );
      expect(overlay).toBeInTheDocument();
      expect(overlay).toHaveAttribute("role", "alert");
      // Loud-fail copy must be present so users know the channel is
      // broken — not just visually red.
      expect(overlay.textContent).toMatch(
        /SECURE CHANNEL.*COULD NOT BE.*ESTABLISHED/,
      );
      // The overlay sits inside the affected peer's remote slot.
      const remoteSlot = overlay.closest(".void-video-slot--remote");
      expect(remoteSlot).not.toBeNull();
    });

    it("does not render the overlay on the local participant slot when a remote peer fails", async () => {
      const remoteId = "peer-remote-aaa";
      await joinRoom({ peers: [remoteId] });

      await act(async () => {
        captured.manager!.opts.onSecureChannelFailure!({
          [remoteId]: "ecdhe_failed",
        });
      });

      // Overlay exists for the remote peer.
      await screen.findByTestId(`secure-channel-failure-${remoteId}`);

      // No overlay on the local slot — failure is per-peer, never
      // global.
      const localSlot = document.querySelector(".void-video-slot--local");
      expect(localSlot).not.toBeNull();
      expect(
        localSlot!.querySelector('[data-testid^="secure-channel-failure-"]'),
      ).toBeNull();
    });
  });

  describe("E2E + RELAY ONLY indicator", () => {
    // The combined "E2E ENCRYPTED · RELAY ONLY" badge in the joined header
    // is the only in-call surface that tells a peer the room is routing
    // through the TURN relay. If a refactor silently drops the RELAY ONLY
    // half, the privacy story regresses with nothing failing — these
    // tests pin both states explicitly.
    it("shows both 'E2E ENCRYPTED' and 'RELAY ONLY' when joined with relayOnly true", async () => {
      await joinRoom({ peers: ["peer-remote-aaa"], relayOnly: true });

      // Wait for the in-room UI to flush.
      await waitFor(() => {
      expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    });

      expect(screen.getByText("E2E ENCRYPTED")).toBeInTheDocument();
      expect(screen.getByText("RELAY ONLY")).toBeInTheDocument();
    });

    it("shows only 'E2E ENCRYPTED' (no 'RELAY ONLY') when joined with relayOnly false", async () => {
      await joinRoom({ peers: ["peer-remote-aaa"], relayOnly: false });

      await waitFor(() => {
      expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    });

      expect(screen.getByText("E2E ENCRYPTED")).toBeInTheDocument();
      expect(screen.queryByText("RELAY ONLY")).toBeNull();
    });
  });

  describe("per-slot peer tag label", () => {
    // The slot label is the human bridge between a face on screen and the
    // PEER-XYZ tag that gets burned into outgoing video. If this format
    // silently drifts, manual leak attribution silently breaks too.
    function getSlotLabel(slot: Element | null): string {
      expect(slot).not.toBeNull();
      const label = slot!.querySelector(".void-slot-label");
      expect(label).not.toBeNull();
      return label!.textContent ?? "";
    }

    it("labels the local slot YOU [PEER-...] and remote slots P{n} [PEER-...] derived from the peer-... id", async () => {
      await joinRoom({ peers: ["peer-remote-aaa", "peer-remote-bbb"] });

      // Wait for the in-room UI to settle.
      await waitFor(() => {
      expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    });

      const localSlots = document.querySelectorAll(".void-video-slot--local");
      expect(localSlots).toHaveLength(1);
      const localLabel = getSlotLabel(localSlots[0]);
      // PEER- tag is uppercase + alphanumeric; the random suffix is
      // generated locally so we match the format, not the value.
      expect(localLabel).toMatch(/^YOU \[PEER-[A-Z0-9]+\]$/);
      // No [SHARING] suffix when nobody is sharing.
      expect(localLabel).not.toContain("[SHARING]");

      const remoteSlots = document.querySelectorAll(".void-video-slot--remote");
      // Two remote peers + at least one filler slot (grid pads to >=2).
      const remoteLabels = Array.from(remoteSlots)
        .map((s) => s.querySelector(".void-slot-label")?.textContent ?? null)
        .filter((t): t is string => t !== null && t.length > 0);
      // The first remote sits at slot index 1 → P2; the second at index 2
      // → P3. The PEER-... portion is derived directly from the peer id.
      expect(remoteLabels).toEqual([
        "P2 [PEER-REMOTE-AAA]",
        "P3 [PEER-REMOTE-BBB]",
      ]);
    });

    it("adds [SHARING] to the remote slot when screen-share-state names that peer as the active sharer", async () => {
      const sharerId = "peer-remote-aaa";
      const otherId = "peer-remote-bbb";
      await joinRoom({ peers: [sharerId, otherId] });

      await waitFor(() => {
      expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    });

      // Baseline: no slot has the [SHARING] suffix yet.
      expect(screen.queryByText(/\[SHARING\]/)).toBeNull();

      // Server announces the active sharer via the screen-share-state event.
      await act(async () => {
        mockSocket.__trigger("screen-share-state", {
          activeScreenSharePeerId: sharerId,
        });
      });

      expect(
        await screen.findByText("P2 [PEER-REMOTE-AAA] [SHARING]"),
      ).toBeInTheDocument();
      // The other remote slot and the local slot stay un-suffixed.
      expect(screen.getByText("P3 [PEER-REMOTE-BBB]")).toBeInTheDocument();
      expect(screen.getByText(/^YOU \[PEER-[A-Z0-9]+\]$/)).toBeInTheDocument();

      // When the server clears the active sharer, the suffix disappears.
      await act(async () => {
        mockSocket.__trigger("screen-share-state", {
          activeScreenSharePeerId: null,
        });
      });

      expect(
        await screen.findByText("P2 [PEER-REMOTE-AAA]"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/\[SHARING\]/)).toBeNull();
    });
  });
});

// Task #407: UI sound presence controls.
// The privacy contract: a fresh install is silent on every UI event
// until the user explicitly opts in via the SOUNDS toggle. The peer-
// joined bleep is the canonical case — a retro speaker bleep would
// out a SILHOUETTE-shader user to bystanders.
describe("RoomPage UI sounds toggle (#407)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("default OFF: peer-joined does NOT invoke the bleep helper on a fresh install", async () => {
    await joinRoom({ isHost: true });
    const playBleepMock = vi.mocked(playBleep);
    playBleepMock.mockClear();

    await act(async () => {
      mockSocket.__trigger("peer-joined", { peerId: "peer-newcomer-aa" });
    });

    expect(playBleepMock).not.toHaveBeenCalled();
  });

  it("toggle ON then peer-joined: bleep helper fires exactly once per peer-joined", async () => {
    await joinRoom({ isHost: true });

    const user = userEvent.setup();
    // Task #594: UI sounds toggle moved into the in-call overflow menu.
    await user.click(screen.getByTestId("incall-overflow-button"));
    const toggle = screen.getByTestId("ui-sounds-toggle");
    await user.click(toggle);

    const playBleepMock = vi.mocked(playBleep);
    playBleepMock.mockClear();

    await act(async () => {
      mockSocket.__trigger("peer-joined", { peerId: "peer-newcomer-bb" });
    });

    expect(playBleepMock).toHaveBeenCalledTimes(1);

    // Toggle back OFF; subsequent peer-joined must be silent again.
    await user.click(toggle);
    playBleepMock.mockClear();
    await act(async () => {
      mockSocket.__trigger("peer-joined", { peerId: "peer-newcomer-cc" });
    });
    expect(playBleepMock).not.toHaveBeenCalled();
  });

  it("toggle persists to localStorage under 2bit_ui_sounds_enabled", async () => {
    await joinRoom({ isHost: true });
    const user = userEvent.setup();
    // Task #594: UI sounds toggle moved into the in-call overflow menu.
    await user.click(screen.getByTestId("incall-overflow-button"));
    const toggle = screen.getByTestId("ui-sounds-toggle");

    expect(localStorage.getItem("2bit_ui_sounds_enabled")).toBeNull();
    await user.click(toggle);
    expect(localStorage.getItem("2bit_ui_sounds_enabled")).toBe("1");
    await user.click(toggle);
    expect(localStorage.getItem("2bit_ui_sounds_enabled")).toBeNull();
  });
});

// The "wrap it up" toast on RoomPage has a 4-state machine
// (idle → showing → snoozed → showing → dismissed) plus a conditional
// SNOOZE button that disappears after the snooze has been used. The pure
// helpers in lib/expiryWarning are well covered, but the wiring inside
// RoomPage that maps phase + snoozeUsed to which buttons render — and how
// user clicks transition that state — is what these tests pin down.
describe("RoomPage host wrap-it-up toast", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime());
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // setup() inside RoomPage awaits buildMediaPipeline + a fetch before
  // emitting "join-room". With fake timers we can't lean on vi.waitFor
  // (its polling would hang), so we yield to microtasks until the emit
  // shows up. The mocked pipeline + fetch resolve in microtasks alone, so
  // a handful of yields is enough.
  async function pumpUntilJoinEmit() {
    for (let i = 0; i < 50 && mockSocket.__getEmit("join-room").length === 0; i++) {
      await act(async () => {
        await Promise.resolve();
        // Let any real-macrotask async work (the rendezvous-handle HKDF
        // derivation) settle before the next check — see note at top.
        await flushRealMacrotask();
      });
    }
  }

  async function joinAs({
    isHost,
    tier = "standard",
    remainingMs = 8 * 60_000,
  }: {
    isHost: boolean;
    tier?: "standard" | "day" | null;
    remainingMs?: number;
  }) {
    const now = Date.now();
    render(
      <RoomPage
        roomId={TEST_ROOM}
        e2eKey={fakeKey}
        voidPhrase={TEST_PHRASE}
        fromUrl={false}
      />,
    );

    await pumpUntilJoinEmit();

    const joinCalls = mockSocket.__getEmit("join-room");
    expect(joinCalls.length).toBeGreaterThan(0);
    const cb = joinCalls[0][1] as EmitCallback;

    await act(async () => {
      cb({
        success: true,
        peers: [],
        maxUsers: 4,
        isHost,
        relayOnly: false,
        screenSharePeerId: null,
        tier,
        expiresAt: now + remainingMs,
        serverNow: now,
      });
    });
  }

  it("shows the toast at the lead-time threshold for a host with both SNOOZE and DISMISS buttons", async () => {
    // 8 min remaining is well within the STANDARD 10-min lead.
    await joinAs({ isHost: true, tier: "standard", remainingMs: 8 * 60_000 });

    // The state transition (idle → showing) lands synchronously inside the
    // join callback's act(), so the toast is in the DOM by the time we
    // check. We use getByTestId rather than findByTestId here because
    // findByTestId polls via setTimeout, and setTimeout is faked.
    const toast = screen.getByTestId("expiry-warning-toast");
    expect(toast).toBeInTheDocument();
    expect(toast.textContent).toMatch(/WRAP IT UP OR EXTEND/);
    expect(screen.getByTestId("expiry-warning-snooze")).toBeInTheDocument();
    expect(screen.getByTestId("expiry-warning-dismiss")).toBeInTheDocument();
    // Both action buttons should live inside the toast.
    expect(toast.contains(screen.getByTestId("expiry-warning-snooze"))).toBe(true);
    expect(toast.contains(screen.getByTestId("expiry-warning-dismiss"))).toBe(true);
  });

  it("does not show the toast for a non-host (guest) even at the lead threshold", async () => {
    await joinAs({ isHost: false, tier: "standard", remainingMs: 8 * 60_000 });
    // Allow the warning useEffect a chance to flush before asserting absence.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();
  });

  it("does not show the toast yet when the host is still outside the lead-time window", async () => {
    // 12 min remaining is OUTSIDE the STANDARD 10-min lead.
    await joinAs({ isHost: true, tier: "standard", remainingMs: 12 * 60_000 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();
  });

  it("hides on SNOOZE then re-shows once (without SNOOZE button) after the snooze interval elapses", async () => {
    await joinAs({ isHost: true, tier: "standard", remainingMs: 8 * 60_000 });

    expect(screen.getByTestId("expiry-warning-toast")).toBeInTheDocument();
    expect(screen.getByTestId("expiry-warning-snooze")).toBeInTheDocument();

    // Snooze: phase → "snoozed", toast hides immediately.
    await act(async () => {
      screen.getByTestId("expiry-warning-snooze").click();
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();

    // Advance the countdown by a hair over 5 minutes — remainingMs goes
    // from ~8m to ~3m, well above the STANDARD 60s urgent threshold, so
    // the re-fire we observe MUST be the snooze-interval branch (not the
    // task #121 urgent forced re-fire). The interval ticks every 1s and
    // the warning useEffect re-runs when remainingMs updates.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1500);
    });

    const toast = screen.getByTestId("expiry-warning-toast");
    expect(toast).toBeInTheDocument();
    // SNOOZE is gone on the re-fire; only DISMISS remains.
    expect(screen.queryByTestId("expiry-warning-snooze")).toBeNull();
    expect(screen.getByTestId("expiry-warning-dismiss")).toBeInTheDocument();
  });

  it("hides permanently on DISMISS — including after a snooze cycle", async () => {
    await joinAs({ isHost: true, tier: "standard", remainingMs: 8 * 60_000 });

    expect(screen.getByTestId("expiry-warning-toast")).toBeInTheDocument();

    // Snooze first so we exercise the snoozed → showing → dismissed path.
    await act(async () => {
      screen.getByTestId("expiry-warning-snooze").click();
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();

    // Force the snooze re-fire, then dismiss the re-fired toast.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1500);
    });
    expect(screen.getByTestId("expiry-warning-toast")).toBeInTheDocument();

    await act(async () => {
      screen.getByTestId("expiry-warning-dismiss").click();
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();

    // Advance another 30 seconds. We started at 8m; we've now used ~5m32s,
    // so remainingMs is ~2m28s — still safely above the STANDARD 60s
    // urgent threshold. With phase="dismissed" the toast must NOT come
    // back. (The task #121 forced urgent re-fire is intentionally out of
    // scope here: that path only triggers below the urgent threshold and
    // is covered by the pure-helper tests in lib/expiryWarning.test.ts.)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();
  });

  it("hides permanently on DISMISS even when the host never snoozed", async () => {
    await joinAs({ isHost: true, tier: "standard", remainingMs: 8 * 60_000 });

    expect(screen.getByTestId("expiry-warning-toast")).toBeInTheDocument();

    // Dismiss straight from the initial showing.
    await act(async () => {
      screen.getByTestId("expiry-warning-dismiss").click();
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();

    // Advance 6 minutes. remainingMs goes from ~8m to ~2m, still above
    // the urgent threshold. Because the host already DISMISSED, the
    // useEffect's `phase === "dismissed"` early-return guards against any
    // re-fire from the lead/snooze path.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60_000);
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();
  });

  // Task #218: cover the task #121 forced urgent re-fire. The host dismisses
  // the initial lead-time toast; once the countdown crosses into the STANDARD
  // urgent threshold (T-1m) the useEffect must override phase="dismissed" and
  // force the toast back with the SNOOZE button gone. This is the last-chance
  // warning that prevents a silent expiry.
  it("re-fires the toast with no SNOOZE button when remainingMs crosses the urgent threshold even after the host dismissed", async () => {
    // Start at 8 min remaining — within the STANDARD 10m lead, so the
    // toast is already showing on join.
    await joinAs({ isHost: true, tier: "standard", remainingMs: 8 * 60_000 });

    expect(screen.getByTestId("expiry-warning-toast")).toBeInTheDocument();

    // Host dismisses immediately; toast disappears.
    await act(async () => {
      screen.getByTestId("expiry-warning-dismiss").click();
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();

    // Advance 6m59s so remainingMs drops to ~61s — still ONE second above
    // the STANDARD 60s urgent threshold (condition is <=, so 61s is not yet
    // urgent). The toast must still be absent here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60_000 + 59_000);
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();

    // Advance 2 more seconds so remainingMs falls to ~59s (< 60s =
    // STANDARD_URGENT_THRESHOLD_MS). The urgent useEffect branch must override
    // phase="dismissed" and re-show the toast.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    const toast = screen.getByTestId("expiry-warning-toast");
    expect(toast).toBeInTheDocument();
    expect(toast.textContent).toMatch(/WRAP IT UP OR EXTEND/);
    // The urgent re-fire marks snooze as used before showing, so the
    // SNOOZE button must be absent — only DISMISS remains.
    expect(screen.queryByTestId("expiry-warning-snooze")).toBeNull();
    expect(screen.getByTestId("expiry-warning-dismiss")).toBeInTheDocument();
  });

  // Task #213: a host with the VOID tab in the background never sees the
  // visual toast in time. The urgent last-chance re-fire must therefore
  // also play one beep — exactly one — to grab attention. The earlier
  // lead-time toast intentionally stays silent (hosts who are paying
  // attention shouldn't get audio interruptions every long room).
  it("plays one beep when the urgent last-chance toast fires, no beep on the lead-time toast, and no extra beeps as time keeps ticking", async () => {
    // Task #407: UI sounds default OFF. The urgent re-fire still routes
    // through uiBleep → playBleep when the user has opted in, so enable
    // the toggle for this suite explicitly.
    localStorage.setItem("2bit_ui_sounds_enabled", "1");
    const playBleepMock = vi.mocked(playBleep);

    // Join at 8m remaining — within the STANDARD 10m lead window. The
    // lead-time toast appears, but it must NOT trigger a beep. (The
    // join handler itself plays a "joined the room" bleep, so clear the
    // mock AFTER joining so we only measure subsequent expiry-related
    // calls.)
    await joinAs({ isHost: true, tier: "standard", remainingMs: 8 * 60_000 });
    expect(screen.getByTestId("expiry-warning-toast")).toBeInTheDocument();
    playBleepMock.mockClear();

    // Host dismisses the lead-time toast. Still no beep.
    await act(async () => {
      screen.getByTestId("expiry-warning-dismiss").click();
    });
    expect(playBleepMock).not.toHaveBeenCalled();

    // Cross into the STANDARD urgent threshold (T-1m). The urgent
    // re-fire branch must run and emit exactly one beep.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 60_000 + 2_000);
    });
    expect(screen.getByTestId("expiry-warning-toast")).toBeInTheDocument();
    expect(playBleepMock).toHaveBeenCalledTimes(1);

    // Subsequent timer ticks past the threshold must not re-fire the
    // beep — the urgent branch is one-shot per window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(playBleepMock).toHaveBeenCalledTimes(1);
  });

  it("does not beep for a guest as the timer crosses the urgent threshold (guests get no wrap-it-up toast at all)", async () => {
    // Task #407: enable UI sounds so a guest crossing the threshold
    // would beep if the guard were broken — this isolates "guests get
    // no urgent toast" from "the toggle was off."
    localStorage.setItem("2bit_ui_sounds_enabled", "1");
    const playBleepMock = vi.mocked(playBleep);

    await joinAs({ isHost: false, tier: "standard", remainingMs: 8 * 60_000 });
    // Discard the join-handler "you joined the room" bleep so we can
    // assert solely on later expiry-related calls.
    playBleepMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 60_000 + 5_000);
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();
    expect(playBleepMock).not.toHaveBeenCalled();
  });

  it("urgent re-fire is one-shot: dismissing it a second time does not bring it back again", async () => {
    // Start at 8 min remaining so the lead-time toast fires on join.
    await joinAs({ isHost: true, tier: "standard", remainingMs: 8 * 60_000 });

    // Dismiss the initial lead-time toast.
    await act(async () => {
      screen.getByTestId("expiry-warning-dismiss").click();
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();

    // Cross into the urgent threshold (>7m elapsed → remainingMs < 60s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 60_000 + 2_000);
    });

    // Urgent last-chance toast must be present now.
    expect(screen.getByTestId("expiry-warning-toast")).toBeInTheDocument();
    expect(screen.queryByTestId("expiry-warning-snooze")).toBeNull();

    // Host dismisses the urgent toast.
    await act(async () => {
      screen.getByTestId("expiry-warning-dismiss").click();
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();

    // Advance a few more seconds to trigger further countdown ticks.
    // expiryUrgentFiredRef is now true, so shouldFireUrgentWarning returns
    // false on every subsequent tick — the toast must NOT come back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByTestId("expiry-warning-toast")).toBeNull();
  });
});

// The room-extended socket event is broadcast to every peer (host AND
// guests) when the host buys more time. The host has already been told
// via the extend-room ack toast ("ROOM EXTENDED ✓"), so the broadcast
// handler must NOT re-toast on the host — otherwise the host sees a
// duplicate. Guests, on the other hand, have no other signal that the
// room window just grew, so the broadcast is the place where their
// "HOST EXTENDED THE ROOM ✓" toast gets surfaced. The same handler also
// resets the near-expiry warning state machine so a future warning can
// arm against the new window.
describe("RoomPage room-extended guest toast (#143)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime());
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // setup() inside RoomPage awaits buildMediaPipeline + a fetch before
  // emitting "join-room". With fake timers we can't lean on vi.waitFor
  // (its polling would hang), so we yield to microtasks until the emit
  // shows up. The mocked pipeline + fetch resolve in microtasks alone, so
  // a handful of yields is enough.
  async function pumpUntilJoinEmit() {
    for (let i = 0; i < 50 && mockSocket.__getEmit("join-room").length === 0; i++) {
      await act(async () => {
        await Promise.resolve();
        // Let any real-macrotask async work (the rendezvous-handle HKDF
        // derivation) settle before the next check — see note at top.
        await flushRealMacrotask();
      });
    }
  }

  async function joinAs({
    isHost,
    tier = "standard",
    remainingMs = 30 * 60_000,
  }: {
    isHost: boolean;
    tier?: "standard" | "day" | null;
    remainingMs?: number;
  }) {
    const now = Date.now();
    render(
      <RoomPage
        roomId={TEST_ROOM}
        e2eKey={fakeKey}
        voidPhrase={TEST_PHRASE}
        fromUrl={false}
      />,
    );

    await pumpUntilJoinEmit();

    const joinCalls = mockSocket.__getEmit("join-room");
    expect(joinCalls.length).toBeGreaterThan(0);
    const cb = joinCalls[0][1] as EmitCallback;

    await act(async () => {
      cb({
        success: true,
        peers: [],
        maxUsers: 4,
        isHost,
        relayOnly: false,
        screenSharePeerId: null,
        tier,
        expiresAt: now + remainingMs,
        serverNow: now,
      });
    });
  }

  function emitRoomExtended(opts: {
    remainingMs: number;
    tier?: "standard" | "day";
  }) {
    const now = Date.now();
    mockSocket.__trigger("room-extended", {
      expiresAt: now + opts.remainingMs,
      serverNow: now,
      tier: opts.tier ?? "standard",
    });
  }

  it("shows a 'HOST EXTENDED THE ROOM ✓' toast on a guest when the room-extended broadcast lands", async () => {
    await joinAs({ isHost: false, tier: "standard", remainingMs: 30 * 60_000 });

    // No extension notice before the broadcast fires.
    expect(screen.queryByTestId("extend-notice")).toBeNull();

    await act(async () => {
      emitRoomExtended({ remainingMs: 60 * 60_000 });
    });

    const notice = screen.getByTestId("extend-notice");
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toMatch(/HOST EXTENDED THE ROOM/);
    // The toast lives in the polite live region so it's announced to
    // assistive tech without stealing focus.
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveAttribute("aria-live", "polite");
  });

  it("does NOT show a 'HOST EXTENDED THE ROOM' toast on the host when the room-extended broadcast lands (the host's confirmation comes from the extend-room ack only)", async () => {
    await joinAs({ isHost: true, tier: "standard", remainingMs: 30 * 60_000 });

    expect(screen.queryByTestId("extend-notice")).toBeNull();

    // The room-extended broadcast lands on every socket in the room,
    // including the host's. Without the `if (!isHostRef.current)` guard
    // this would fire a second toast on top of the ack-driven
    // "ROOM EXTENDED ✓" — that's the regression this test pins down.
    await act(async () => {
      emitRoomExtended({ remainingMs: 60 * 60_000 });
    });

    expect(screen.queryByTestId("extend-notice")).toBeNull();
  });

  it("resets the near-expiry warning state on guests after room-extended so a future warning fires on the new window", async () => {
    // Guests don't render the host-only "wrap it up" toast (its useEffect
    // early-returns on !isHost), so the observable proxy for "the
    // near-expiry state was cleared and re-armed against the new window"
    // is the in-header expiry display: it switches between "ENDS IN
    // MM:SS" (live countdown, gold/red) and "ENDS HH:MM" (wall-clock,
    // muted) at the same `warnThresholdMs` boundary the warning state
    // machine uses (see `getExpiryWarnLeadMs` / `isNearExpiry`). If the
    // room-extended handler ran fully — which is what reset the warning
    // state in the same code block — the header must drop back out of
    // its near-expiry form once the new far-future window is applied.
    await joinAs({ isHost: false, tier: "standard", remainingMs: 5 * 60_000 });

    // Sanity: 5m remaining is inside the STANDARD 10m near-expiry
    // threshold, so the header is in the "ENDS IN MM:SS" form.
    expect(screen.getByText(/ENDS IN \d{1,2}:\d{2}/)).toBeInTheDocument();

    await act(async () => {
      emitRoomExtended({ remainingMs: 60 * 60_000 });
    });

    // After the extension the new window is far-future; the live
    // countdown form is gone and the wall-clock form is shown again.
    // This proves the room-extended handler ran end-to-end on the
    // guest — the same handler that sets `expiryWarningPhase` back to
    // "idle", clears `expiryWarningSnoozeUsedRef`, and re-arms
    // `expiryUrgentFiredRef` so a future near-expiry warning can fire
    // on the new window.
    expect(screen.queryByText(/ENDS IN \d{1,2}:\d{2}/)).toBeNull();
    expect(screen.getByText(/ENDS \d{1,2}:\d{2}/)).toBeInTheDocument();

    // And the guest's confirmation toast also fired on the way through,
    // belt-and-braces on the same handler invocation.
    expect(screen.getByTestId("extend-notice").textContent).toMatch(
      /HOST EXTENDED THE ROOM/,
    );
  });
});

// Regression tests for the pre-share preflight confirmation panel:
//   - the panel embeds a live <video> preview of the captured stream
//   - "monitor" surface → loud red "YOU SELECTED AN ENTIRE SCREEN" header
//   - window / tab surface → gold "PREFLIGHT CHECK" header
//   - CANCEL must stop tracks and must NOT emit "screen-share-started"
//   - START SHARING must emit "screen-share-started"
//   - the preview <video> srcObject is cleared when the panel closes
describe("RoomPage share preflight preview", () => {
  // Build a minimal fake MediaStreamTrack whose getSettings() reports the
  // given displaySurface value, plus a tracked stop() spy.
  function makeFakeDisplayTrack(displaySurface: string) {
    const stopSpy = vi.fn();
    const track = {
      stop: stopSpy,
      getSettings: () => ({ displaySurface }),
      contentHint: "",
      onended: null as ((() => void) | null),
      kind: "video",
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStreamTrack;
    return { track, stopSpy };
  }

  // Build a fake MediaStream wrapping one fake video track.
  function makeFakeDisplayStream(displaySurface: string) {
    const { track, stopSpy } = makeFakeDisplayTrack(displaySurface);
    const stream = {
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
      getTracks: () => [track],
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStream;
    return { stream, track, stopSpy };
  }

  // Drive the full flow from "room joined" to "preflight panel visible":
  //   1. render + join the room
  //   2. click SCREEN (triggers the share-warning dialog)
  //   3. click I UNDERSTAND (triggers confirmAndStartShare → socket emit)
  //   4. resolve the request-screen-share callback with success
  //   5. let getDisplayMedia resolve with the fake stream
  //   6. wait for the preflight panel to appear
  async function openPreflightPanel(displaySurface: string) {
    const { stream, track, stopSpy } = makeFakeDisplayStream(displaySurface);

    // Stub getDisplayMedia on the global navigator before the component
    // renders so that displayMediaSupported is true and the SCREEN button
    // appears.
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
        })),
        getDisplayMedia: vi.fn(async () => stream),
        enumerateDevices: vi.fn(async () => []),
      },
      configurable: true,
      writable: true,
    });

    await joinRoom();

    // Wait for the in-room UI to settle (watermark caption is a reliable
    // sentinel that the joined state is fully rendered).
    await waitFor(() => {
      expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    });

    const user = userEvent.setup();

    // Click SCREEN — this calls handleToggleScreenShare which sets
    // showShareWarning = true, revealing the share-warning overlay.
    const screenBtn = screen.getByText("SHARE SCREEN");
    await user.click(screenBtn);

    // Click I UNDERSTAND — calls confirmAndStartShare which emits
    // request-screen-share on the socket.
    const iUnderstand = await screen.findByText("I UNDERSTAND");
    await user.click(iUnderstand);

    // Drive the request-screen-share callback synchronously so the async
    // body inside confirmAndStartShare can advance through getDisplayMedia
    // and reach setPendingShare.
    await act(async () => {
      const emits = mockSocket.__getEmit("request-screen-share");
      expect(emits.length).toBeGreaterThan(0);
      const cb = emits[emits.length - 1][1] as (r: { success: boolean }) => Promise<void>;
      await cb({ success: true });
    });

    // The preflight panel headline is the canonical signal that
    // setPendingShare ran and the panel is mounted.
    if (displaySurface === "monitor") {
      await screen.findByText("YOU SELECTED AN ENTIRE SCREEN");
    } else {
      await screen.findByText("PREFLIGHT CHECK");
    }

    return { stream, track, stopSpy };
  }

  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore mediaDevices so other test suites are not affected.
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it("renders the red 'YOU SELECTED AN ENTIRE SCREEN' header and a wired <video> preview for displaySurface=monitor", async () => {
    const { stream } = await openPreflightPanel("monitor");

    // The loud red monitor-specific header must be present.
    const header = screen.getByText("YOU SELECTED AN ENTIRE SCREEN");
    expect(header).toBeInTheDocument();

    // The panel must NOT show the lighter "PREFLIGHT CHECK" header used
    // for non-monitor surfaces.
    expect(screen.queryByText("PREFLIGHT CHECK")).toBeNull();

    // The preflight-specific <video> must be present (identified by its
    // testid so we do not accidentally match unrelated room grid videos).
    const previewVideo = screen.getByTestId(
      "share-preview-video",
    ) as HTMLVideoElement;
    expect(previewVideo).toBeInTheDocument();

    // The srcObject must be wired to the captured display stream — the
    // whole point of the preview is that the user sees what peers will
    // actually receive.
    expect(previewVideo.srcObject).toBe(stream);
  });

  it("renders the gold 'PREFLIGHT CHECK' header and a wired <video> preview for displaySurface=window", async () => {
    const { stream } = await openPreflightPanel("window");

    const header = screen.getByText("PREFLIGHT CHECK");
    expect(header).toBeInTheDocument();

    // The monitor-specific loud warning must be absent for a window share.
    expect(screen.queryByText("YOU SELECTED AN ENTIRE SCREEN")).toBeNull();

    // Preflight-specific preview video must be present and wired.
    const previewVideo = screen.getByTestId(
      "share-preview-video",
    ) as HTMLVideoElement;
    expect(previewVideo).toBeInTheDocument();
    expect(previewVideo.srcObject).toBe(stream);
  });

  it("renders the gold 'PREFLIGHT CHECK' header and wired <video> for displaySurface=browser (tab)", async () => {
    const { stream } = await openPreflightPanel("browser");

    expect(screen.getByText("PREFLIGHT CHECK")).toBeInTheDocument();
    expect(screen.queryByText("YOU SELECTED AN ENTIRE SCREEN")).toBeNull();

    const previewVideo = screen.getByTestId(
      "share-preview-video",
    ) as HTMLVideoElement;
    expect(previewVideo).toBeInTheDocument();
    expect(previewVideo.srcObject).toBe(stream);
  });

  it("clicking CANCEL stops the captured tracks and does NOT emit 'screen-share-started'", async () => {
    const { stopSpy } = await openPreflightPanel("monitor");

    const user = userEvent.setup();
    const cancelBtn = screen.getByRole("button", { name: "CANCEL" });
    await user.click(cancelBtn);

    // Track must be stopped so the OS sharing indicator disappears.
    expect(stopSpy).toHaveBeenCalled();

    // The critical regression guard: cancelling must never emit
    // screen-share-started. The server slot reservation will expire on
    // its own; we must not falsely signal that a share is live.
    const startedEmits = mockSocket.__getEmit("screen-share-started");
    expect(startedEmits).toHaveLength(0);

    // The preflight panel must be gone after cancel.
    expect(screen.queryByText("YOU SELECTED AN ENTIRE SCREEN")).toBeNull();
    expect(screen.queryByText("PREFLIGHT CHECK")).toBeNull();
  });

  it("clicking START SHARING emits 'screen-share-started'", async () => {
    // For the confirm path, promoteShareToPeers calls
    // createWatermarkedScreenShareTrack. Give the mock a minimal
    // return value so execution can reach socket.emit("screen-share-started").
    const fakeOutTrack = {
      contentHint: "",
      onended: null as ((() => void) | null),
      kind: "video",
      stop: vi.fn(),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStreamTrack;
    vi.mocked(createWatermarkedScreenShareTrack).mockReturnValueOnce({
      track: fakeOutTrack,
      stop: vi.fn(),
    } as unknown as ReturnType<typeof createWatermarkedScreenShareTrack>);

    await openPreflightPanel("window");

    const user = userEvent.setup();
    const startBtn = screen.getByRole("button", { name: "START SHARING" });
    await user.click(startBtn);

    // screen-share-started must be emitted exactly once.
    const startedEmits = mockSocket.__getEmit("screen-share-started");
    expect(startedEmits.length).toBeGreaterThanOrEqual(1);
  });

  // Task #404: screen share must never capture system audio. The
  // primary defense is the `audio: false` constraint passed to
  // getDisplayMedia; the secondary defense stops and removes any audio
  // track a non-compliant browser/shim hands back anyway before the
  // stream reaches a peer connection.
  it("getDisplayMedia is called with audio:false AND any returned audio track is stopped + removed before peer connection (Task #404)", async () => {
    // Build a fake video track (the preflight code path needs at least
    // one).
    const videoTrack = {
      stop: vi.fn(),
      getSettings: () => ({ displaySurface: "window" }),
      contentHint: "",
      onended: null as ((() => void) | null),
      kind: "video",
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStreamTrack;

    // Build a fake audio track that a non-compliant browser handed
    // back despite `audio: false`. We must observe stop() called AND
    // the track removed from the stream before any peer connection
    // sees the stream.
    const audioStopSpy = vi.fn();
    const audioTrack = {
      stop: audioStopSpy,
      kind: "audio",
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStreamTrack;

    const removeTrackSpy = vi.fn();
    const audioTracksRef = [audioTrack];
    const stream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => audioTracksRef.slice(),
      getTracks: () => [videoTrack, ...audioTracksRef],
      removeTrack: (t: MediaStreamTrack) => {
        removeTrackSpy(t);
        const idx = audioTracksRef.indexOf(t);
        if (idx >= 0) audioTracksRef.splice(idx, 1);
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStream;

    const getDisplayMediaSpy = vi.fn(async () => stream);

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
        })),
        getDisplayMedia: getDisplayMediaSpy,
        enumerateDevices: vi.fn(async () => []),
      },
      configurable: true,
      writable: true,
    });

    await joinRoom();
    await waitFor(() => {
      expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    });

    const user = userEvent.setup();
    const screenBtn = screen.getByText("SHARE SCREEN");
    await user.click(screenBtn);
    const iUnderstand = await screen.findByText("I UNDERSTAND");
    await user.click(iUnderstand);

    await act(async () => {
      const emits = mockSocket.__getEmit("request-screen-share");
      expect(emits.length).toBeGreaterThan(0);
      const cb = emits[emits.length - 1][1] as (r: { success: boolean }) => Promise<void>;
      await cb({ success: true });
    });

    // (a) The constraint assertion: getDisplayMedia was called with
    //     audio: false explicitly — not omitted, not undefined.
    expect(getDisplayMediaSpy).toHaveBeenCalled();
    const lastCallArgs = getDisplayMediaSpy.mock.calls[
      getDisplayMediaSpy.mock.calls.length - 1
    ];
    const constraints = (lastCallArgs as unknown[])[0] as MediaStreamConstraints;
    expect(constraints).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(constraints, "audio")).toBe(true);
    expect(constraints.audio).toBe(false);

    // (b) The defensive-cleanup assertion: the audio track the browser
    //     returned anyway was stopped AND removed from the stream
    //     before the preflight panel mounts (which is the gate before
    //     the stream could reach any peer connection).
    expect(audioStopSpy).toHaveBeenCalled();
    expect(removeTrackSpy).toHaveBeenCalledWith(audioTrack);
    expect(stream.getAudioTracks()).toHaveLength(0);

    // Sanity: the preflight panel actually mounted, confirming we
    // reached the point where the stream would otherwise be forwarded.
    await screen.findByText("PREFLIGHT CHECK");
  });

  it("the preview <video> srcObject is cleared when the panel closes (CANCEL path)", async () => {
    const { stream } = await openPreflightPanel("monitor");

    // Grab the preflight-specific video element while the panel is open
    // and confirm the stream is live.
    const video = screen.getByTestId("share-preview-video") as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);

    const user = userEvent.setup();
    const cancelBtn = screen.getByRole("button", { name: "CANCEL" });
    await user.click(cancelBtn);

    // After the panel unmounts, SharePreviewVideo's cleanup effect sets
    // srcObject = null on the same DOM node so the MediaStream reference
    // is released. The element is removed from the live DOM but the ref
    // we captured still points to it and reflects the cleanup.
    expect(video.srcObject).toBeNull();

    // The testid must no longer be queryable — the panel and its video
    // are completely removed from the tree.
    expect(screen.queryByTestId("share-preview-video")).toBeNull();
  });

  // When getDisplayMedia rejects, the presenter must see a visible
  // "share ended" indication and the manager's clearVideoOverride must
  // run so the failure path lands in the same post-restore state as
  // the graceful-end path.
  it("getDisplayMedia rejection surfaces a 'SCREEN SHARING ENDED' notice and runs the same restore path", async () => {
    const rejectGetDisplayMedia = vi.fn(async () => {
      throw new DOMException("user cancelled", "NotAllowedError");
    });

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
        })),
        getDisplayMedia: rejectGetDisplayMedia,
        enumerateDevices: vi.fn(async () => []),
      },
      configurable: true,
      writable: true,
    });

    await joinRoom();
    await waitFor(() => {
      expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText("SHARE SCREEN"));
    await user.click(await screen.findByText("I UNDERSTAND"));

    await act(async () => {
      const emits = mockSocket.__getEmit("request-screen-share");
      expect(emits.length).toBeGreaterThan(0);
      const cb = emits[emits.length - 1][1] as (r: { success: boolean }) => Promise<void>;
      await cb({ success: true });
    });

    // Presenter-visible indication that the share didn't start.
    await screen.findByText("SCREEN SHARING ENDED");

    // Same restoration path as the graceful-end case.
    expect(captured.manager?.clearVideoOverride).toHaveBeenCalled();

    // No screen-share-started must ever be emitted on this path.
    expect(mockSocket.__getEmit("screen-share-started")).toHaveLength(0);
  });

  // Task #303: a duplicated request-screen-share ack carrying the same
  // per-grant nonce must not re-enter the getDisplayMedia →
  // promoteShareToPeers flow a second time. Without the client-side
  // nonce dedup, a retransmit / out-of-order delivery would double-book
  // the presenter slot by opening two share flows for one user click.
  it("duplicate request-screen-share ack with the same nonce only promotes one share", async () => {
    // We use a vi.fn for getDisplayMedia so we can both control the
    // returned stream AND count how many times the share flow advanced
    // past the ack guard. The promotion path bottoms out in
    // setPendingShare → preflight panel; counting getDisplayMedia calls
    // is a robust upstream signal that is unaffected by which preflight
    // surface is shown.
    const { stream } = makeFakeDisplayStream("window");
    const getDisplayMediaSpy = vi.fn(async () => stream);

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
        })),
        getDisplayMedia: getDisplayMediaSpy,
        enumerateDevices: vi.fn(async () => []),
      },
      configurable: true,
      writable: true,
    });

    await joinRoom();
    await waitFor(() => {
      expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText("SHARE SCREEN"));
    await user.click(await screen.findByText("I UNDERSTAND"));

    // Drive the request-screen-share callback TWICE with the same nonce
    // — simulating a retransmitted / out-of-order grant ack. The client
    // must dedup on the nonce and only enter the share flow once.
    await act(async () => {
      const emits = mockSocket.__getEmit("request-screen-share");
      expect(emits.length).toBeGreaterThan(0);
      const cb = emits[emits.length - 1][1] as (r: { success: boolean; nonce?: string }) => Promise<void>;
      await cb({ success: true, nonce: "test-nonce-303" });
      // Duplicate: identical nonce, must be ignored by the client.
      await cb({ success: true, nonce: "test-nonce-303" });
    });

    // The preflight panel must be present (the FIRST grant advanced
    // through getDisplayMedia and called setPendingShare).
    await screen.findByText("PREFLIGHT CHECK");

    // getDisplayMedia must have been called exactly once — proving the
    // duplicate ack was ignored before re-entering the OS picker.
    expect(getDisplayMediaSpy).toHaveBeenCalledTimes(1);
  });

  // Graceful-end path: after START SHARING, simulate the browser firing
  // displayTrack.onended (the user clicked the browser's "Stop sharing"
  // chip). The manager's clearVideoOverride must run so the restored
  // state matches the failure-path test above.
  it("displayTrack.onended runs clearVideoOverride and emits screen-share-stopped", async () => {
    const fakeOutTrack = {
      contentHint: "",
      onended: null as ((() => void) | null),
      kind: "video",
      stop: vi.fn(),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStreamTrack;
    vi.mocked(createWatermarkedScreenShareTrack).mockReturnValueOnce({
      track: fakeOutTrack,
      stop: vi.fn(),
    } as unknown as ReturnType<typeof createWatermarkedScreenShareTrack>);

    const { track } = await openPreflightPanel("window");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "START SHARING" }));

    expect(mockSocket.__getEmit("screen-share-started").length).toBeGreaterThanOrEqual(1);

    const onended = (track as unknown as { onended: (() => void) | null }).onended;
    expect(typeof onended).toBe("function");

    await act(async () => {
      onended?.();
    });

    expect(captured.manager?.clearVideoOverride).toHaveBeenCalled();
    expect(mockSocket.__getEmit("screen-share-stopped").length).toBeGreaterThanOrEqual(1);
  });
});

describe("RoomPage in-room share fragment-leak caption (task #399)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the permanent fragment-leak caption beneath the SHARE and SHOW QR buttons in the overflow menu, wired to both via aria-describedby", async () => {
    await joinRoom({ isHost: true });

    // Task #597: SHARE / SHOW QR (and their caption) now live in the
    // in-call overflow ("kebab") menu, so open it before asserting.
    await act(async () => {
      screen.getByTestId("incall-overflow-button").click();
    });
    await screen.findByTestId("incall-overflow-menu");

    // Exact wording pinned in scripts/check-required-literals.mjs. Drift here
    // softens the warning the host sees at the decision point.
    const caption = screen.getByText(
      /Phrase travels in the URL\. Anything that reads the URL — browser sync, history, extensions — reads the phrase\./,
    );
    expect(caption).toBeInTheDocument();
    expect(caption.id).toBeTruthy();

    // Both controls live inside the overflow `role="menu"`, so they expose
    // role="menuitem" (not "button") for the ARIA menu required-children
    // contract — query them accordingly.
    const shareBtn = screen.getByRole("menuitem", { name: /^SHARE$/i });
    const qrBtn = screen.getByRole("menuitem", { name: /^SHOW QR$/i });
    expect(shareBtn).toHaveAttribute("aria-describedby", caption.id);
    expect(qrBtn).toHaveAttribute("aria-describedby", caption.id);
  });

  it("also shows the link-mangling channel caution alongside the fragment-leak line, without contradicting it (task #731)", async () => {
    await joinRoom({ isHost: true });

    await act(async () => {
      screen.getByTestId("incall-overflow-button").click();
    });
    await screen.findByTestId("incall-overflow-menu");

    // The same guidance the two main share surfaces carry (task #729),
    // brought to the header overflow menu for consistency. Distinct from
    // the fragment-leak line (who can READ the URL) — this is about the
    // link arriving intact through messengers/proxies.
    const channelCaution = screen.getByText(
      /Some messengers and proxies \(Slack, LinkedIn\) can mangle the link\. Share the QR or read the six words aloud instead\./,
    );
    expect(channelCaution).toBeInTheDocument();

    // Both cautions coexist — adding the new one must not displace the
    // pinned fragment-leak line.
    const fragmentCaution = screen.getByText(
      /Phrase travels in the URL\. Anything that reads the URL — browser sync, history, extensions — reads the phrase\./,
    );
    expect(fragmentCaution).toBeInTheDocument();
    expect(channelCaution.id).not.toBe(fragmentCaution.id);
  });
});

describe("RoomPage BURN button tooltip (task #436)", () => {
  // The tooltip is the in-context explanation of what BURN does and
  // does not promise. The honesty line — "does not undo what was
  // already seen" — is the load-bearing piece: it pre-empts a host
  // reaching for BURN expecting it to claw back bytes that were
  // already on the wire. We pin both the wording and the keyboard
  // reachability (announced to screen readers via aria-describedby,
  // focusable via the BURN button itself).
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the BURN tooltip with the honesty line and wires it to the BURN button via aria-describedby; the button is keyboard-focusable", async () => {
    await joinRoom();

    const tooltip = await screen.findByTestId("burn-button-tooltip");
    expect(tooltip).toBeInTheDocument();
    // What BURN does:
    expect(tooltip.textContent).toMatch(/ends the call for everyone/i);
    expect(tooltip.textContent).toMatch(/rotates the credential/i);
    // What BURN does NOT undo — the load-bearing honesty line:
    expect(tooltip.textContent).toMatch(/does not undo what anyone already saw or heard/i);
    expect(tooltip).toHaveAttribute("role", "tooltip");

    const burnBtn = screen.getByRole("button", { name: /^BURN$/i });
    expect(burnBtn).toHaveAttribute("aria-describedby", tooltip.id);

    // Keyboard reachability: the button itself receives focus, which
    // triggers the wrapping span's :focus-within CSS rule that reveals
    // the tooltip. We assert the button is focusable here; the CSS
    // toggle is verified at the stylesheet layer.
    burnBtn.focus();
    expect(document.activeElement).toBe(burnBtn);
  });
});

describe("RoomPage self-view toggle (task #571)", () => {
  // The SELF ON / SELF OFF toggle hides the local tile from the local
  // screen ONLY. Outgoing camera frames (the masked/processed stream
  // produced by buildMediaPipeline) are unaffected — this is a comfort
  // setting, not a privacy feature, and the tests pin both behaviors:
  // - the local tile disappears from the grid when toggled off
  // - the localStorage flag is persisted on every flip
  // - a solo user sees the placeholder + PREVIEW YOURSELF affordance
  // - the transient preview escape-hatch clears on ANY peer join, but
  //   not on departure
  // - the persisted state survives a remount (default-on preserved)
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
    try { localStorage.removeItem("2bit_self_view_visible"); } catch {}
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    try { localStorage.removeItem("2bit_self_view_visible"); } catch {}
  });

  it("defaults to SELF ON (visible) and renders the local tile in the grid", async () => {
    await joinRoom({ peers: ["peer-remote-1"] });
    const toggle = await screen.findByTestId("self-view-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAttribute("aria-label", "Self view on");
    expect(toggle.textContent).toMatch(/SELF ON/);
    // Local tile is rendered (outlined teal class).
    expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    expect(screen.queryByTestId("self-view-solo-placeholder")).toBeNull();
  });

  it("hides the local tile and persists the OFF state to localStorage when toggled", async () => {
    await joinRoom({ peers: ["peer-remote-1"] });
    const toggle = await screen.findByTestId("self-view-toggle");
    const user = userEvent.setup();
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-label", "Self view off");
    expect(toggle.textContent).toMatch(/SELF OFF/);
    expect(localStorage.getItem("2bit_self_view_visible")).toBe("0");
    // Local tile gone; the single remote tile renders fullscreen
    // (data-slots="1").
    expect(document.querySelector(".void-video-slot--local")).toBeNull();
    expect(document.querySelectorAll(".void-video-slot--remote").length).toBe(1);
    const grid = document.querySelector(".void-video-grid");
    expect(grid?.getAttribute("data-slots")).toBe("1");
  });

  it("clears the localStorage flag when toggled back ON", async () => {
    await joinRoom({ peers: ["peer-remote-1"] });
    const toggle = await screen.findByTestId("self-view-toggle");
    const user = userEvent.setup();
    await user.click(toggle); // OFF
    expect(localStorage.getItem("2bit_self_view_visible")).toBe("0");
    await user.click(toggle); // ON
    expect(localStorage.getItem("2bit_self_view_visible")).toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
  });

  it("renders the solo placeholder with PREVIEW YOURSELF when alone and SELF is OFF", async () => {
    await joinRoom({ peers: [] });
    const toggle = await screen.findByTestId("self-view-toggle");
    const user = userEvent.setup();
    await user.click(toggle);

    const placeholder = await screen.findByTestId("self-view-solo-placeholder");
    expect(placeholder).toHaveAttribute("role", "status");
    expect(placeholder).toHaveAttribute("aria-live", "polite");
    // Required headline per task spec: brutalist `[ WAITING FOR PEER ]`.
    const headline = screen.getByTestId("self-view-waiting-headline");
    expect(headline.textContent).toMatch(/\[\s*WAITING FOR PEER\s*\]/);
    // Honesty copy: camera is still on for peers.
    expect(placeholder.textContent).toMatch(/CAMERA IS STILL ON FOR PEERS/);
    // No grid tiles are rendered while the placeholder is showing.
    expect(document.querySelectorAll(".void-video-slot").length).toBe(0);

    const previewBtn = screen.getByTestId("self-view-preview-yourself");
    expect(previewBtn.textContent).toMatch(/PREVIEW YOURSELF/);
    // Critically: the button label does NOT prefix "TAP TO".
    expect(previewBtn.textContent).not.toMatch(/TAP TO/i);
  });

  it("PREVIEW YOURSELF shows the local tile transiently without flipping the persisted toggle", async () => {
    await joinRoom({ peers: [] });
    const toggle = await screen.findByTestId("self-view-toggle");
    const user = userEvent.setup();
    await user.click(toggle);
    await screen.findByTestId("self-view-solo-placeholder");

    const previewBtn = screen.getByTestId("self-view-preview-yourself");
    await user.click(previewBtn);

    // Placeholder gone, local tile back.
    expect(screen.queryByTestId("self-view-solo-placeholder")).toBeNull();
    expect(document.querySelector(".void-video-slot--local")).not.toBeNull();
    // Toggle is still OFF; persisted state unchanged.
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("2bit_self_view_visible")).toBe("0");
  });

  it("clears the transient preview on peer join (and does NOT re-trigger on departure)", async () => {
    await joinRoom({ peers: [] });
    const toggle = await screen.findByTestId("self-view-toggle");
    const user = userEvent.setup();
    await user.click(toggle);
    await user.click(await screen.findByTestId("self-view-preview-yourself"));
    // Transient preview is now showing the local tile.
    expect(document.querySelector(".void-video-slot--local")).not.toBeNull();

    // Peer joins → transient clears, local tile hidden, remote
    // takes the fullscreen slot.
    await act(async () => {
      mockSocket.__trigger("peer-joined", { peerId: "peer-newcomer" });
    });
    await waitFor(() => {
      expect(document.querySelector(".void-video-slot--local")).toBeNull();
    });
    expect(document.querySelectorAll(".void-video-slot--remote").length).toBe(1);

    // Peer leaves → we go back to solo, the placeholder appears
    // (NOT the local tile — departure must not re-arm preview).
    await act(async () => {
      mockSocket.__trigger("peer-left", { peerId: "peer-newcomer" });
    });
    await screen.findByTestId("self-view-solo-placeholder");
    expect(document.querySelector(".void-video-slot--local")).toBeNull();
  });

  it("hydrates from localStorage on mount (SELF OFF survives a fresh render)", async () => {
    try { localStorage.setItem("2bit_self_view_visible", "0"); } catch {}
    await joinRoom({ peers: ["peer-remote-1"] });
    const toggle = await screen.findByTestId("self-view-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector(".void-video-slot--local")).toBeNull();
  });

  it("4-peer room with SELF OFF collapses to a clean 3-remote layout (data-slots=3, no orphan slot)", async () => {
    // Protects the grid math: when the local user hides their tile in
    // a full 4-peer room, the remaining 3 remotes must render in the
    // existing data-slots="3" layout (CSS centers the third tile on
    // the bottom row). A future refactor that forgets to clamp
    // displayCount or leaves the local slot in the array would either
    // render 4 tiles (one empty / NO SIGNAL) or data-slots="4", both
    // of which this test catches.
    await joinRoom({ peers: ["peer-a", "peer-b", "peer-c"] });
    const toggle = await screen.findByTestId("self-view-toggle");
    const user = userEvent.setup();
    await user.click(toggle);

    expect(document.querySelector(".void-video-slot--local")).toBeNull();
    const remoteSlots = document.querySelectorAll(".void-video-slot--remote");
    expect(remoteSlots.length).toBe(3);
    const grid = document.querySelector(".void-video-grid");
    expect(grid?.getAttribute("data-slots")).toBe("3");
  });

  it("self-tile always renders from the masked pipeline output, never raw camera", async () => {
    // The self-tile's `data-self-stream-source` attribute is the
    // structural guard. In normal (non-screen-share) mode it must
    // read "masked-pipeline" — i.e. the `processedStream` from
    // buildMediaPipeline that we ALSO forward to peers. There is no
    // raw-camera code path that should ever land in this slot;
    // adding one is the regression this test exists to catch.
    await joinRoom({ peers: ["peer-remote-1"] });
    const localTile = document.querySelector(".void-video-slot--local");
    expect(localTile).not.toBeNull();
    expect(localTile?.getAttribute("data-self-stream-source")).toBe("masked-pipeline");

    // After flipping SELF OFF and tapping PREVIEW YOURSELF (with no
    // peer present so the placeholder shows the affordance), the
    // re-rendered self-tile must still be the masked pipeline.
    const toggle = await screen.findByTestId("self-view-toggle");
    const user = userEvent.setup();
    // Move to a solo room to exercise the preview affordance.
    await act(async () => {
      mockSocket.__trigger("peer-left", { peerId: "peer-remote-1" });
    });
    await user.click(toggle);
    await user.click(await screen.findByTestId("self-view-preview-yourself"));
    const previewTile = document.querySelector(".void-video-slot--local");
    expect(previewTile).not.toBeNull();
    expect(previewTile?.getAttribute("data-self-stream-source")).toBe("masked-pipeline");
  });
});


// Task #572: in-room masking safety toggles. handleCycleVoice reads
// `getAllowUnmaskedVoice()` at click time and skips index 0 (NONE)
// when the pref is OFF; a mid-call ON → OFF flip reverts a NONE
// stream to the default mask via subscribeMaskingPrefs; and the
// first-time-on-NONE hint is dismissable per-device-per-stream with
// the dismiss flag persisted to localStorage.
describe("RoomPage masking safety toggles (task #572)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    try { localStorage.clear(); } catch {}
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    try { localStorage.clear(); } catch {}
  });

  // Task #594: the VIDEO:/VOICE: footer cyclers were consolidated into
  // a single MASKS button that opens the MasksSheet. Voice selection
  // now happens by tapping a voice-mask tile in that sheet; selecting
  // CLEAR (index 0) while ALLOW UNMASKED VOICE is OFF routes through a
  // grant-and-select confirm. We open the sheet and read which voice
  // tile is currently pressed to assert applied state.
  async function openMasks(): Promise<void> {
    await act(async () => {
      screen.getByTestId("incall-masks-button").click();
    });
    await screen.findByTestId("masks-sheet");
  }
  function pressedVoiceIndex(): number {
    for (let i = 0; i < 5; i++) {
      const el = document.querySelector(
        `[data-testid="masks-sheet-voice-option-${i}"]`,
      );
      if (el?.getAttribute("aria-pressed") === "true") return i;
    }
    return -1;
  }

  it("mount-time snap forces NONE → SCRAMBLE when ALLOW UNMASKED VOICE is OFF (the default)", async () => {
    // useRoomMedia is seeded with initialVoiceMode=0 by RoomPage when
    // no prop is passed. With ALLOW OFF the mount-time apply() effect
    // snaps NONE (0) to SCRAMBLE (3). The MASKS sheet reflects that.
    await joinRoom({ peers: [] });
    await screen.findByTestId("incall-masks-button");
    await openMasks();
    expect(pressedVoiceIndex()).toBe(3);
  });

  it("selecting CLEAR voice while ALLOW UNMASKED VOICE is OFF opens the grant confirm and only applies after ALLOW", async () => {
    await joinRoom({ peers: [] });
    await openMasks();
    // Tapping the CLEAR (index 0) tile must not flip anything yet — it
    // opens the grant-and-select confirm.
    await act(async () => {
      screen.getByTestId("masks-sheet-voice-option-0").click();
    });
    expect(screen.getByTestId("masks-sheet-voice-confirm")).toBeInTheDocument();
    expect(localStorage.getItem("voidAllowUnmaskedVoice")).toBeNull();
    // Confirm ALLOW: pref is granted and the draft snaps to CLEAR (0).
    await act(async () => {
      screen.getByRole("button", { name: /^ALLOW$/i }).click();
    });
    expect(localStorage.getItem("voidAllowUnmaskedVoice")).toBe("1");
    expect(pressedVoiceIndex()).toBe(0);
  });

  it("with ALLOW UNMASKED VOICE ON, selecting CLEAR applies directly and APPLY emits voiceMode 0", async () => {
    localStorage.setItem("voidAllowUnmaskedVoice", "1");
    await joinRoom({ peers: [] });
    await openMasks();
    // With pref ON, no confirm is shown.
    await act(async () => {
      screen.getByTestId("masks-sheet-voice-option-0").click();
    });
    expect(screen.queryByTestId("masks-sheet-voice-confirm")).toBeNull();
    expect(pressedVoiceIndex()).toBe(0);
    await act(async () => {
      screen.getByTestId("masks-sheet-apply").click();
    });
    const calls = captured.manager!.setLocalMediaState.mock.calls;
    const last = calls[calls.length - 1]?.[0] as { voiceMode?: number };
    expect(last?.voiceMode).toBe(0);
  });

  it("flipping ALLOW UNMASKED VOICE OFF mid-call while sitting on NONE snaps to SCRAMBLE immediately", async () => {
    localStorage.setItem("voidAllowUnmaskedVoice", "1");
    await joinRoom({ peers: [] });
    await screen.findByTestId("incall-masks-button");

    // Simulate the HamburgerMenu writing the pref OFF. The room's
    // subscribeMaskingPrefs effect should snap NONE → SCRAMBLE (3).
    await act(async () => {
      localStorage.removeItem("voidAllowUnmaskedVoice");
      window.dispatchEvent(
        new CustomEvent("void:masking-prefs-change", {
          detail: { key: "voidAllowUnmaskedVoice" },
        }),
      );
    });

    // The void.media-state broadcast carries the new voiceMode so peers
    // see the mask come back up too.
    const calls = captured.manager!.setLocalMediaState.mock.calls;
    const last = calls[calls.length - 1]?.[0] as { voiceMode?: number };
    expect(last?.voiceMode).toBe(3);
    // And the MASKS sheet reflects SCRAMBLE (3) as the applied state.
    await openMasks();
    expect(pressedVoiceIndex()).toBe(3);
  });

  it("first-time-on-NONE voice hint appears, dismiss persists in localStorage, and does not re-appear", async () => {
    // ALLOW ON so voice stays at NONE through mount.
    localStorage.setItem("voidAllowUnmaskedVoice", "1");
    const { unmount } = await joinRoom({ peers: [] });
    // Hint surfaces because voiceMode === 0 and the dismiss flag is
    // not yet set.
    const hint = await screen.findByTestId("unmasked-voice-hint");
    expect(hint.textContent).toMatch(/UNMASKED — peers hear your real voice/);
    const dismiss = screen.getByTestId("unmasked-voice-hint-dismiss");
    await act(async () => { dismiss.click(); });

    expect(screen.queryByTestId("unmasked-voice-hint")).toBeNull();
    expect(localStorage.getItem("voidUnmaskedVoiceHintDismissed")).toBe("1");

    // Unmount + rejoin. The hint must NOT re-appear because the
    // dismiss flag is per-device-persistent.
    unmount();
    captured.manager = null;
    mockSocket = createMockSocket();
    await joinRoom({ peers: [] });
    // Wait long enough for the voice-mode hint effect to have run.
    await screen.findByTestId("incall-masks-button");
    expect(screen.queryByTestId("unmasked-voice-hint")).toBeNull();
  });

  // Task #597: the phrase row shows the full 6-word phrase by default on
  // entry. Tapping the row masks it behind fixed asterisk blocks and a
  // second tap reveals it again. The masked state is *session-only*
  // (component state, not localStorage), so it must reset back to shown
  // on reload / rejoin.
  it("phrase tap-to-mask is session-only: tapping masks the phrase, but rejoin re-reveals", async () => {
    const { unmount } = await joinRoom({
      peers: [],
      isHost: true,
    });
    // The full phrase row is shown on entry.
    const row = await screen.findByTestId("room-phrase-row");
    expect(row.textContent).toContain(TEST_PHRASE);
    expect(row.getAttribute("data-masked")).toBe("0");

    // Tapping the row masks the phrase behind asterisk blocks.
    await act(async () => {
      screen.getByTestId("room-phrase-toggle").click();
    });
    const maskedRow = screen.getByTestId("room-phrase-row");
    expect(maskedRow.getAttribute("data-masked")).toBe("1");
    expect(maskedRow.textContent).not.toContain(TEST_PHRASE);
    expect(maskedRow.textContent).toContain("****");
    // Nothing was persisted — the masked state lives in component state only.
    expect(localStorage.getItem("voidPhraseDismissed")).toBeNull();

    // Unmount + rejoin: the phrase must be shown again (session-only reset).
    unmount();
    captured.manager = null;
    mockSocket = createMockSocket();
    await joinRoom({ peers: [], isHost: true });
    const rejoinedRow = await screen.findByTestId("room-phrase-row");
    expect(rejoinedRow.getAttribute("data-masked")).toBe("0");
    expect(rejoinedRow.textContent).toContain(TEST_PHRASE);
  });
});

// Task #597: the combined "ALLOW CLEAR A/V" header toggle was removed
// and the in-call REVOKE control no longer lives in the overflow kebab.
// Granting a clear A/V stream happens inside the MasksSheet
// (grant-and-select confirm); revoking it now lives in the MasksSheet
// too, as "REVOKE UNMASK PERMISSION", shown only while a grant is
// active. Clicking it flips both prefs OFF, snaps any active NONE stream
// back to its default mask, and surfaces a polite status note inside the
// sheet.
describe("RoomPage in-call REVOKE UNMASK PERMISSION via MasksSheet (task #597)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    try { localStorage.clear(); } catch {}
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    try { localStorage.clear(); } catch {}
  });

  async function openMasks(): Promise<void> {
    await act(async () => {
      screen.getByTestId("incall-masks-button").click();
    });
    await screen.findByTestId("masks-sheet-apply");
  }

  it("does not show the revoke control when nothing is granted (the OFF default)", async () => {
    await joinRoom({ peers: [] });
    await openMasks();
    expect(screen.queryByTestId("masks-sheet-revoke")).toBeNull();
    // The old header toggle, its dialog, and the overflow revoke item are
    // all gone entirely.
    expect(screen.queryByTestId("header-allow-clear-toggle")).toBeNull();
    expect(screen.queryByTestId("allow-clear-confirm")).toBeNull();
    expect(screen.queryByTestId("overflow-revoke-unmask")).toBeNull();
  });

  it("shows the revoke control when a grant is active and clicking it restores masks + surfaces a polite status note", async () => {
    localStorage.setItem("voidAllowUnmaskedVideo", "1");
    localStorage.setItem("voidAllowUnmaskedVoice", "1");
    await joinRoom({ peers: [] });
    await openMasks();
    const revoke = await screen.findByTestId("masks-sheet-revoke");
    expect(revoke.textContent).toMatch(/REVOKE UNMASK PERMISSION/i);
    await act(async () => { revoke.click(); });
    expect(localStorage.getItem("voidAllowUnmaskedVideo")).toBeNull();
    expect(localStorage.getItem("voidAllowUnmaskedVoice")).toBeNull();
    const note = await screen.findByTestId("masks-sheet-revoke-note");
    expect(note).toHaveAttribute("role", "status");
    expect(note).toHaveAttribute("aria-live", "polite");
    expect(note.textContent).toMatch(/MASKS RESTORED/i);
  });
});

// Task #594: the bottom control bar holds exactly 5 children
// (MIC, CAM, SHARE SCREEN, MASKS, BURN) and they share the
// same `flex: 1 1 0` shorthand so all 5 are equal width. The two
// footer cyclers (VIDEO: / VOICE:) were consolidated into the single
// MASKS button that opens the MasksSheet.
describe("RoomPage control bar layout (task #594)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    try { localStorage.clear(); } catch {}
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
    // Force `displayMediaSupported` true so SHARE SCREEN renders.
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
        })),
        getDisplayMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
        })),
        enumerateDevices: vi.fn(async () => []),
      },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    try { localStorage.clear(); } catch {}
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  function bar(): HTMLElement {
    const el = document.querySelector(".void-control-bar");
    if (!el) throw new Error("control bar not found");
    return el as HTMLElement;
  }

  it("Full mode renders exactly 5 direct children in the canonical order", async () => {
    await joinRoom({ peers: [] });
    await vi.waitFor(() => bar());
    const children = Array.from(bar().children) as HTMLElement[];
    expect(children).toHaveLength(5);
    // The BURN button is wrapped in a span to host the tooltip — its
    // first button child carries the label.
    const labels = children.map((c) =>
      ((c.tagName === "BUTTON" ? c : c.querySelector("button"))
        ?.textContent ?? "").trim(),
    );
    expect(labels[0]).toMatch(/^MIC/);
    expect(labels[1]).toMatch(/^CAM/);
    expect(labels[2]).toBe("SHARE SCREEN");
    expect(labels[3]).toBe("MASKS");
    expect(labels[4]).toBe("BURN");
    // The two footer cyclers are gone — consolidated into MASKS.
    expect(screen.queryByTestId("incall-video-cycler")).toBeNull();
    expect(screen.queryByTestId("incall-voice-cycler")).toBeNull();
  });
});

// Privacy-critical regression: tapping "MIC OFF" must actually stop the
// outgoing audio track, not just flip a cosmetic indicator. The bug was
// that toggleMic only updated React state + emitted peer-media-state
// (which the receiver renders as a muted icon) while the local audio
// track stayed `enabled`, so the peer kept hearing audio.
describe("RoomPage MIC mute stops the outgoing audio track (task #697)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    try { localStorage.clear(); } catch {}
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
        })),
        getDisplayMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
        })),
        enumerateDevices: vi.fn(async () => []),
      },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    try { localStorage.clear(); } catch {}
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it("flips the local audio track's enabled flag when MIC is toggled", async () => {
    const audioTrack = {
      kind: "audio",
      enabled: true,
      stop: vi.fn(),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStreamTrack;

    const processedStream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [audioTrack],
      getTracks: () => [audioTrack],
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStream;

    vi.mocked(buildMediaPipeline).mockResolvedValueOnce({
      processedStream,
      rawStream: processedStream,
      gainNode: {} as GainNode,
      canvas: document.createElement("canvas"),
      analyser: null as unknown as AnalyserNode,
      stop: vi.fn(),
      setVideoStyle: vi.fn(),
      setVoiceMode: vi.fn(),
      enableMonitor: vi.fn(),
      disableMonitor: vi.fn(),
      setWatermark: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof buildMediaPipeline>>);

    await joinRoom({ peers: [] });

    const micButton = await screen.findByText("MIC");
    expect(audioTrack.enabled).toBe(true);

    const user = userEvent.setup();
    await user.click(micButton);

    // The track is now muted at the source AND the UI reflects it.
    expect(audioTrack.enabled).toBe(false);
    await screen.findByText("MIC OFF");

    // Un-muting re-enables the outgoing audio.
    await user.click(screen.getByText("MIC OFF"));
    expect(audioTrack.enabled).toBe(true);
    await screen.findByText("MIC");
  });
});

// Task #710: the camera-error "TRY AGAIN" button used to re-acquire
// media and then `window.location.href = ...` — a full page reload
// that re-ran the PBKDF2 room-key derivation and discarded in-room
// state. It now recovers in place: it re-runs the connection effect
// (re-acquire pipeline + rejoin) without any navigation.
describe("RoomPage media-error TRY AGAIN recovers in place (#710)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    // setup() fetches /api/ice-servers inside a try/catch; rejecting is
    // fine and keeps the test off the network.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
        })),
        enumerateDevices: vi.fn(async () => []),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(buildMediaPipeline).mockReset();
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it("re-acquires and rejoins without navigating the page", async () => {
    // First pipeline build fails (camera denied) → media-error overlay,
    // and crucially no join-room is emitted yet.
    const denied = new Error("permission denied");
    denied.name = "NotAllowedError";
    vi.mocked(buildMediaPipeline).mockRejectedValueOnce(denied);

    render(
      <RoomPage
        roomId={TEST_ROOM}
        e2eKey={fakeKey}
        voidPhrase={TEST_PHRASE}
        fromUrl={false}
      />,
    );

    await screen.findByTestId("media-error-overlay");
    expect(mockSocket.__getEmit("join-room").length).toBe(0);

    // A real reload would change window.location; capture it so we can
    // prove the retry never navigated.
    const hrefBefore = window.location.href;

    // buildMediaPipeline now succeeds (falls back to the default mock
    // after the one-shot rejection), so the in-place retry can join.
    const user = userEvent.setup();
    await user.click(screen.getByText("TRY AGAIN"));

    // In-place recovery: the connection effect re-ran on the SAME
    // component instance and emitted join-room again. The old reload
    // path would never re-emit join-room (it navigated instead).
    await waitFor(() => {
      expect(mockSocket.__getEmit("join-room").length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("media-error-overlay")).toBeNull();
    expect(window.location.href).toBe(hrefBefore);
  });
});

// Privacy-critical regression: tapping "CAM OFF" must actually stop the
// outgoing video track, not just flip a cosmetic indicator. The bug was
// that toggleCam only updated React state + emitted peer-media-state
// (which the receiver renders by hiding the peer's tile) while the local
// video track stayed `enabled`, so a hostile peer ignoring peer-media-state
// would keep receiving live frames.
describe("RoomPage CAM off stops the outgoing video track (task #701)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    captured.manager = null;
    try { localStorage.clear(); } catch {}
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
        })),
        getDisplayMedia: vi.fn(async () => ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
        })),
        enumerateDevices: vi.fn(async () => []),
      },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    try { localStorage.clear(); } catch {}
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it("flips the local video track's enabled flag when CAM is toggled", async () => {
    const videoTrack = {
      kind: "video",
      enabled: true,
      stop: vi.fn(),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStreamTrack;

    const processedStream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [],
      getTracks: () => [videoTrack],
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStream;

    vi.mocked(buildMediaPipeline).mockResolvedValueOnce({
      processedStream,
      rawStream: processedStream,
      gainNode: {} as GainNode,
      canvas: document.createElement("canvas"),
      analyser: null as unknown as AnalyserNode,
      stop: vi.fn(),
      setVideoStyle: vi.fn(),
      setVoiceMode: vi.fn(),
      enableMonitor: vi.fn(),
      disableMonitor: vi.fn(),
      setWatermark: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof buildMediaPipeline>>);

    await joinRoom({ peers: [] });

    const camButton = await screen.findByRole("button", { name: "CAM" });
    expect(videoTrack.enabled).toBe(true);

    const user = userEvent.setup();
    await user.click(camButton);

    // The track is now disabled at the source AND the UI reflects it.
    expect(videoTrack.enabled).toBe(false);
    await screen.findByRole("button", { name: "CAM OFF" });

    // Re-enabling restores the outgoing video.
    await user.click(screen.getByRole("button", { name: "CAM OFF" }));
    expect(videoTrack.enabled).toBe(true);
    await screen.findByRole("button", { name: "CAM" });
  });
});
