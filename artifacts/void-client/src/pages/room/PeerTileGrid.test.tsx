// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #702 defense-in-depth: the receiver must also silence the incoming
// audio element for any remote peer whose advertised peer-media-state
// reports the mic muted — so a buggy or malicious sender that keeps
// transmitting audio still cannot be heard locally. This harness drives
// PeerTileGrid directly and asserts the remote tile's <video> `.muted`
// property tracks `peerMediaState[peerId].micMuted`, and reconciles back
// to audible when the peer un-mutes.

import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { createRef } from "react";
import PeerTileGrid from "./PeerTileGrid";
import { VuMeter } from "./videoTiles";
import type { WebRTCManager } from "@/lib/webrtc";

// jsdom does not implement HTMLMediaElement.play() nor the WebAudio
// AnalyserNode constructor, both of which VideoSlot/VuMeter touch on mount.
// Stub them so this isolated harness can mount a remote tile with a stream.
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn(() => Promise.resolve()),
  });
  if (typeof (globalThis as { AnalyserNode?: unknown }).AnalyserNode ===
      "undefined") {
    vi.stubGlobal("AnalyserNode", class AnalyserNode {});
  }
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver ===
      "undefined") {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  }
  // jsdom does not implement the MediaStream constructor, which the task #718
  // receiver-side video blanking uses to derive an audio-only view of the
  // incoming stream. Provide a minimal stub that filters tracks by kind.
  vi.stubGlobal(
    "MediaStream",
    class MediaStream {
      private _tracks: Array<{ kind: string }>;
      constructor(tracks: Array<{ kind: string }> = []) {
        this._tracks = tracks;
      }
      getAudioTracks() {
        return this._tracks.filter((t) => t.kind === "audio");
      }
      getVideoTracks() {
        return this._tracks.filter((t) => t.kind === "video");
      }
      getTracks() {
        return this._tracks;
      }
      addEventListener() {}
      removeEventListener() {}
    },
  );
});

afterEach(cleanup);

// The mock incoming stream carries a video track (so we can assert it is NOT
// rendered when the peer reports camOff) but no audio tracks — keeping
// getAudioTracks() empty avoids VuMeter spinning up a real AudioContext,
// which jsdom does not implement.
function makeStream(): MediaStream {
  const videoTrack = { kind: "video" };
  return {
    getAudioTracks: () => [],
    getVideoTracks: () => [videoTrack],
    getTracks: () => [videoTrack],
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaStream;
}

function renderGrid(
  overrides: Partial<Parameters<typeof PeerTileGrid>[0]> = {},
) {
  const peerTag = createRef<string>() as { current: string };
  peerTag.current = "PEER-AAA";
  const webrtcRef = createRef<WebRTCManager>() as {
    current: WebRTCManager | null;
  };
  webrtcRef.current = null;

  const props: Parameters<typeof PeerTileGrid>[0] = {
    slots: [{ participant: { id: "peer-bob", isMe: false }, index: 0 }],
    displayCount: 1,
    hostPresent: false,
    hostPeerId: null,
    isScreenSharing: false,
    localPreviewStream: null,
    localStream: null,
    remoteStreams: { "peer-bob": makeStream() },
    peerTag,
    screenSharePeerId: null,
    relayOnly: false,
    peerRelayPinned: {},
    peerMediaState: {},
    secureChannelFailures: {},
    cryptoMismatch: {},
    phraseChangedNotice: {},
    silentRekeyNotice: {},
    peerSAS: {},
    camOff: false,
    micMuted: false,
    localAnalyser: null,
    webrtcRef,
    verificationOpenFor: null,
    setVerificationOpenFor: () => {},
    setVerificationAnchor: () => {},
    verifyStateFor: () => "pending",
    setVerifyStatus: () => {},
    uiClick: () => {},
    ...overrides,
  };
  return render(<PeerTileGrid {...props} />);
}

describe("PeerTileGrid receiver-side mute (task #702)", () => {
  it("leaves a remote peer's audio audible when they report the mic open", () => {
    const { container } = renderGrid({ peerMediaState: {} });
    const video = container.querySelector(
      ".void-video-slot--remote video",
    ) as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.muted).toBe(false);
  });

  it("mutes the incoming audio element when the peer reports micMuted", () => {
    const { container } = renderGrid({
      peerMediaState: { "peer-bob": { micMuted: true } },
    });
    const video = container.querySelector(
      ".void-video-slot--remote video",
    ) as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.muted).toBe(true);
  });

  it("reconciles back to audible when the peer un-mutes", () => {
    const peerTag = createRef<string>() as { current: string };
    peerTag.current = "PEER-AAA";
    const webrtcRef = createRef<WebRTCManager>() as {
      current: WebRTCManager | null;
    };
    webrtcRef.current = null;
    const stream = makeStream();

    const baseProps: Parameters<typeof PeerTileGrid>[0] = {
      slots: [{ participant: { id: "peer-bob", isMe: false }, index: 0 }],
      displayCount: 1,
      hostPresent: false,
      hostPeerId: null,
      isScreenSharing: false,
      localPreviewStream: null,
      localStream: null,
      remoteStreams: { "peer-bob": stream },
      peerTag,
      screenSharePeerId: null,
      relayOnly: false,
      peerRelayPinned: {},
      peerMediaState: { "peer-bob": { micMuted: true } },
      secureChannelFailures: {},
      cryptoMismatch: {},
      phraseChangedNotice: {},
      silentRekeyNotice: {},
      peerSAS: {},
      camOff: false,
      micMuted: false,
      localAnalyser: null,
      webrtcRef,
      verificationOpenFor: null,
      setVerificationOpenFor: () => {},
      setVerificationAnchor: () => {},
      verifyStateFor: () => "pending",
      setVerifyStatus: () => {},
      uiClick: () => {},
    };

    const { container, rerender } = render(<PeerTileGrid {...baseProps} />);
    const video = container.querySelector(
      ".void-video-slot--remote video",
    ) as HTMLVideoElement;
    expect(video.muted).toBe(true);

    rerender(
      <PeerTileGrid
        {...baseProps}
        peerMediaState={{ "peer-bob": { micMuted: false } }}
      />,
    );
    expect(video.muted).toBe(false);
  });
});

describe("PeerTileGrid neutral 'unknown' media-state (task #868)", () => {
  it("renders neutral MIC ?/CAM ? badges for a remote peer with no media-state yet (pre-open / fail-closed)", () => {
    // The `void.media-state` channel hasn't delivered anything (or failed
    // closed). We must NOT fabricate an "unmuted / camera-on" claim about
    // another person's device — the indicator stays neutral.
    const { queryByTestId } = renderGrid({ peerMediaState: {} });
    expect(queryByTestId("peer-mic-unknown-peer-bob")).toBeTruthy();
    expect(queryByTestId("peer-cam-unknown-peer-bob")).toBeTruthy();
  });

  it("drops both unknown badges once an actual boolean state has arrived for the peer", () => {
    const { queryByTestId } = renderGrid({
      peerMediaState: { "peer-bob": { camOff: false, micMuted: false } },
    });
    expect(queryByTestId("peer-mic-unknown-peer-bob")).toBeNull();
    expect(queryByTestId("peer-cam-unknown-peer-bob")).toBeNull();
  });

  it("treats a partial update as known-mic / unknown-cam (no false camera-on claim)", () => {
    // A payload that carries micMuted but omits camOff leaves the camera
    // field genuinely unknown — it must still show CAM ?, never imply on.
    const { queryByTestId } = renderGrid({
      peerMediaState: { "peer-bob": { micMuted: true } },
    });
    expect(queryByTestId("peer-mic-unknown-peer-bob")).toBeNull();
    expect(queryByTestId("peer-cam-unknown-peer-bob")).toBeTruthy();
  });

  it("never renders an unknown badge for the local (self) tile", () => {
    const { queryByTestId } = renderGrid({
      slots: [{ participant: { id: "peer-bob", isMe: true }, index: 0 }],
      peerMediaState: {},
    });
    expect(queryByTestId("peer-mic-unknown-peer-bob")).toBeNull();
    expect(queryByTestId("peer-cam-unknown-peer-bob")).toBeNull();
  });
});

describe("PeerTileGrid VU meter mute (task #737)", () => {
  it("renders the peer's VU meter live when they report the mic open", () => {
    const { container } = renderGrid({ peerMediaState: {} });
    const meter = container.querySelector(
      ".void-video-slot--remote [data-testid='vu-meter']",
    ) as HTMLElement | null;
    expect(meter).toBeTruthy();
    expect(meter!.getAttribute("data-vu-muted")).toBe("false");
  });

  it("flattens the peer's VU meter when they report micMuted", () => {
    const { container } = renderGrid({
      peerMediaState: { "peer-bob": { micMuted: true } },
    });
    const meter = container.querySelector(
      ".void-video-slot--remote [data-testid='vu-meter']",
    ) as HTMLElement | null;
    expect(meter).toBeTruthy();
    // The meter is forced flat (zero active blocks) regardless of any
    // still-arriving audio while the peer is reported muted.
    expect(meter!.getAttribute("data-vu-muted")).toBe("true");
    expect(meter!.getAttribute("data-vu-active")).toBe("0");
  });

  it("reconciles the VU meter back to live when the peer un-mutes", () => {
    const peerTag = createRef<string>() as { current: string };
    peerTag.current = "PEER-AAA";
    const webrtcRef = createRef<WebRTCManager>() as {
      current: WebRTCManager | null;
    };
    webrtcRef.current = null;
    const stream = makeStream();

    const baseProps: Parameters<typeof PeerTileGrid>[0] = {
      slots: [{ participant: { id: "peer-bob", isMe: false }, index: 0 }],
      displayCount: 1,
      hostPresent: false,
      hostPeerId: null,
      isScreenSharing: false,
      localPreviewStream: null,
      localStream: null,
      remoteStreams: { "peer-bob": stream },
      peerTag,
      screenSharePeerId: null,
      relayOnly: false,
      peerRelayPinned: {},
      peerMediaState: { "peer-bob": { micMuted: true } },
      secureChannelFailures: {},
      cryptoMismatch: {},
      phraseChangedNotice: {},
      silentRekeyNotice: {},
      peerSAS: {},
      camOff: false,
      micMuted: false,
      localAnalyser: null,
      webrtcRef,
      verificationOpenFor: null,
      setVerificationOpenFor: () => {},
      setVerificationAnchor: () => {},
      verifyStateFor: () => "pending",
      setVerifyStatus: () => {},
      uiClick: () => {},
    };

    const { container, rerender } = render(<PeerTileGrid {...baseProps} />);
    const meter = container.querySelector(
      ".void-video-slot--remote [data-testid='vu-meter']",
    ) as HTMLElement;
    expect(meter.getAttribute("data-vu-muted")).toBe("true");

    rerender(
      <PeerTileGrid
        {...baseProps}
        peerMediaState={{ "peer-bob": { micMuted: false } }}
      />,
    );
    expect(meter.getAttribute("data-vu-muted")).toBe("false");
  });
});

// Drives the VuMeter directly through its `AnalyserNode` input (the same path
// the local self-tile uses) so we can feed it deterministic audio samples
// without standing up a real AudioContext. This proves the *level* — not just
// the data attribute — actually reads flat while muted and resumes animating
// after un-mute, including the case where the tile mounts muted first.
describe("VuMeter level behavior under mute (task #737)", () => {
  let realRaf: typeof globalThis.requestAnimationFrame;
  let realCancel: typeof globalThis.cancelAnimationFrame;
  let rafCbs: FrameRequestCallback[];

  beforeAll(() => {
    realRaf = globalThis.requestAnimationFrame;
    realCancel = globalThis.cancelAnimationFrame;
  });

  function installRafCapture() {
    rafCbs = [];
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCbs.push(cb);
      return rafCbs.length;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
  }

  function flushRaf(now: number) {
    const pending = rafCbs;
    rafCbs = [];
    act(() => {
      pending.forEach((cb) => cb(now));
    });
  }

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
  });

  // A stand-in AnalyserNode (instanceof the stubbed class) that fills the
  // time-domain buffer with a constant amplitude, yielding a non-zero RMS and
  // therefore a non-zero meter level once the rAF tick runs.
  function makeLoudAnalyser(amplitude: number): AnalyserNode {
    const AnalyserCtor = (globalThis as unknown as { AnalyserNode: new () => object }).AnalyserNode;
    const a = new AnalyserCtor() as unknown as {
      fftSize: number;
      getFloatTimeDomainData: (buf: Float32Array) => void;
    };
    a.fftSize = 4;
    a.getFloatTimeDomainData = (buf: Float32Array) => {
      for (let i = 0; i < buf.length; i++) buf[i] = amplitude;
    };
    return a as unknown as AnalyserNode;
  }

  it("animates a non-zero level when not muted", () => {
    installRafCapture();
    const analyser = makeLoudAnalyser(0.5);
    const { container } = render(
      <VuMeter analyserOrStream={analyser} muted={false} />,
    );
    flushRaf(1000);
    const meter = container.querySelector(
      "[data-testid='vu-meter']",
    ) as HTMLElement;
    expect(Number(meter.getAttribute("data-vu-active"))).toBeGreaterThan(0);
  });

  it("reads flat (zero level) while muted even when audio keeps arriving", () => {
    installRafCapture();
    const analyser = makeLoudAnalyser(0.5);
    const { container } = render(
      <VuMeter analyserOrStream={analyser} muted={true} />,
    );
    flushRaf(1000);
    const meter = container.querySelector(
      "[data-testid='vu-meter']",
    ) as HTMLElement;
    expect(meter.getAttribute("data-vu-active")).toBe("0");
  });

  it("resumes animating after un-mute even when mounted muted first", () => {
    installRafCapture();
    const analyser = makeLoudAnalyser(0.5);
    const { container, rerender } = render(
      <VuMeter analyserOrStream={analyser} muted={true} />,
    );
    flushRaf(1000);
    const meter = container.querySelector(
      "[data-testid='vu-meter']",
    ) as HTMLElement;
    expect(meter.getAttribute("data-vu-active")).toBe("0");

    // Un-mute: the analyser effect must re-run (muted is in its deps) and the
    // meter must start reading a real level again.
    rerender(<VuMeter analyserOrStream={analyser} muted={false} />);
    flushRaf(2000);
    expect(Number(meter.getAttribute("data-vu-active"))).toBeGreaterThan(0);
  });
});

describe("PeerTileGrid receiver-side video blanking (task #718)", () => {
  it("renders the live incoming video track when the peer reports the camera on", () => {
    const { container } = renderGrid({ peerMediaState: {} });
    const video = container.querySelector(
      ".void-video-slot--remote video",
    ) as HTMLVideoElement | null;
    expect(video).toBeTruthy();
    // The full incoming stream (with its video track) is bound to the element.
    const bound = video!.srcObject as MediaStream | null;
    expect(bound).toBeTruthy();
    expect(bound!.getVideoTracks().length).toBe(1);
  });

  it("stops rendering incoming video frames when the peer reports camOff", () => {
    const { container } = renderGrid({
      peerMediaState: { "peer-bob": { camOff: true } },
    });
    const video = container.querySelector(
      ".void-video-slot--remote video",
    ) as HTMLVideoElement | null;
    // The media element stays mounted (so remote audio keeps playing) but the
    // bound stream has no video track — no live frames are rendered even if
    // the cosmetic overlay were bypassed/removed.
    expect(video).toBeTruthy();
    const bound = video!.srcObject as MediaStream | null;
    expect(bound).toBeTruthy();
    expect(bound!.getVideoTracks().length).toBe(0);
    // The cosmetic overlay is still present on top of the blanked tile.
    expect(
      container.querySelector(".void-video-slot--remote .void-cam-off-overlay"),
    ).toBeTruthy();
  });

  it("keeps remote audio audible when a cam-off peer still has their mic open", () => {
    const { container } = renderGrid({
      peerMediaState: { "peer-bob": { camOff: true, micMuted: false } },
    });
    const video = container.querySelector(
      ".void-video-slot--remote video",
    ) as HTMLVideoElement | null;
    // The audio sink (the media element) must survive video blanking, and it
    // must not be muted while the peer's mic is reported open.
    expect(video).toBeTruthy();
    expect(video!.muted).toBe(false);
  });

  it("reconciles back to the live video track when the peer re-enables the camera", () => {
    const peerTag = createRef<string>() as { current: string };
    peerTag.current = "PEER-AAA";
    const webrtcRef = createRef<WebRTCManager>() as {
      current: WebRTCManager | null;
    };
    webrtcRef.current = null;
    const stream = makeStream();

    const baseProps: Parameters<typeof PeerTileGrid>[0] = {
      slots: [{ participant: { id: "peer-bob", isMe: false }, index: 0 }],
      displayCount: 1,
      hostPresent: false,
      hostPeerId: null,
      isScreenSharing: false,
      localPreviewStream: null,
      localStream: null,
      remoteStreams: { "peer-bob": stream },
      peerTag,
      screenSharePeerId: null,
      relayOnly: false,
      peerRelayPinned: {},
      peerMediaState: { "peer-bob": { camOff: true } },
      secureChannelFailures: {},
      cryptoMismatch: {},
      phraseChangedNotice: {},
      silentRekeyNotice: {},
      peerSAS: {},
      camOff: false,
      micMuted: false,
      localAnalyser: null,
      webrtcRef,
      verificationOpenFor: null,
      setVerificationOpenFor: () => {},
      setVerificationAnchor: () => {},
      verifyStateFor: () => "pending",
      setVerifyStatus: () => {},
      uiClick: () => {},
    };

    const { container, rerender } = render(<PeerTileGrid {...baseProps} />);
    const video = container.querySelector(
      ".void-video-slot--remote video",
    ) as HTMLVideoElement;
    expect((video.srcObject as MediaStream).getVideoTracks().length).toBe(0);

    rerender(
      <PeerTileGrid
        {...baseProps}
        peerMediaState={{ "peer-bob": { camOff: false } }}
      />,
    );
    expect((video.srcObject as MediaStream).getVideoTracks().length).toBe(1);
  });
});
