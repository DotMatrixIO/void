// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import MasksSheet from "@/components/MasksSheet";
import { expectNoAxeViolations } from "@/test/axe";

// Task #594: the MASKS sheet wires a sheet-scoped capture graph of the
// *masked* mic when it opens, but records nothing until "TAP TO HEAR" is
// pressed; a tap records RECORD_SECONDS and then plays the masked
// recording back. The capture MUST be flushed (drop samples + stop
// playback) on close / BURN / leave so no captured audio outlives the
// sheet. These tests pin that lifecycle with a fake Web Audio graph and
// fake timers for the record window.

vi.mock("@/lib/uiSounds", () => ({
  uiClick: vi.fn(),
  uiSelectClick: vi.fn(),
}));

vi.mock("@/lib/sounds", () => ({
  getAudioContext: vi.fn(() => null),
}));

// A mediaPipeline stub whose processedStream exposes a single audio
// track (so the ring buffer is actually allocated, unlike the RoomPage
// suite where the fake stream has no audio tracks).
const setVoiceMode = vi.fn();
const setVideoStyle = vi.fn();
const pipelineStop = vi.fn();
vi.mock("@/lib/mediaPipeline", async () => {
  const actual = await vi.importActual<object>("@/lib/mediaPipeline");
  return {
    ...actual,
    buildMediaPipeline: vi.fn(async () => ({
      processedStream: {
        getAudioTracks: () => [{ kind: "audio" } as MediaStreamTrack],
        getVideoTracks: () => [],
        getTracks: () => [],
      },
      canvas: document.createElement("canvas"),
      setVideoStyle,
      setVoiceMode,
      stop: pipelineStop,
    })),
  };
});

// ---- Fake Web Audio graph -------------------------------------------------
interface FakeNode {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}
interface FakeProcessor extends FakeNode {
  onaudioprocess: ((e: unknown) => void) | null;
}
interface FakeSource extends FakeNode {
  buffer: unknown;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}

let lastProcessor: FakeProcessor | null = null;
let lastBufferSource: FakeSource | null = null;
let streamSourceCount = 0;

class FakeAudioContext {
  sampleRate = 48000;
  destination = {} as AudioDestinationNode;
  createMediaStreamSource = vi.fn((): FakeNode => {
    streamSourceCount++;
    return { connect: vi.fn(), disconnect: vi.fn() };
  });
  createScriptProcessor = vi.fn((): FakeProcessor => {
    lastProcessor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
    return lastProcessor;
  });
  createGain = vi.fn(() => ({
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  createBuffer = vi.fn((_ch: number, len: number) => ({
    getChannelData: () => new Float32Array(len),
  }));
  createBufferSource = vi.fn((): FakeSource => {
    lastBufferSource = {
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
    return lastBufferSource;
  });
  close = vi.fn();
}

function baseProps() {
  return {
    open: true,
    onClose: vi.fn(),
    videoStyle: 5 as const,
    voiceMode: 3,
    onApply: vi.fn(),
    allowUnmaskedVideo: false,
    allowUnmaskedVoice: false,
    onGrantUnmaskedVideo: vi.fn(),
    onGrantUnmaskedVoice: vi.fn(),
  };
}

// Drive the ScriptProcessor so the ring fills with non-zero samples,
// mimicking the browser firing onaudioprocess for the masked mic.
function pumpAudio(frames = 4096) {
  const samples = new Float32Array(frames).fill(0.5);
  act(() => {
    lastProcessor?.onaudioprocess?.({
      inputBuffer: { getChannelData: () => samples },
    });
  });
}

describe("MasksSheet voice tap-to-hear capture (Task #594)", () => {
  beforeEach(() => {
    lastProcessor = null;
    lastBufferSource = null;
    streamSourceCount = 0;
    setVoiceMode.mockClear();
    (globalThis as unknown as { AudioContext: unknown }).AudioContext =
      FakeAudioContext as unknown;
    (window as unknown as { AudioContext: unknown }).AudioContext =
      FakeAudioContext as unknown;
    (globalThis as unknown as { MediaStream: unknown }).MediaStream =
      class {
        constructor(_tracks?: unknown) {}
      } as unknown;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("allocates the capture graph when the sheet opens", async () => {
    await act(async () => {
      render(<MasksSheet {...baseProps()} />);
    });
    // source → processor → muted sink were wired up exactly once.
    expect(streamSourceCount).toBe(1);
    expect(lastProcessor).not.toBeNull();
    expect(lastProcessor?.onaudioprocess).toBeTypeOf("function");
  });

  it("shows the tap-to-hear hint next to the button", async () => {
    await act(async () => {
      render(<MasksSheet {...baseProps()} />);
    });
    expect(
      screen.getByTestId("masks-sheet-hear-hint").textContent,
    ).toContain("say anything to hear your selected voice mask");
  });

  it("captures nothing before the tap and plays nothing on an empty window", async () => {
    vi.useFakeTimers();
    await act(async () => {
      render(<MasksSheet {...baseProps()} />);
    });
    // Frames arriving while idle are ignored (capturing is false).
    pumpAudio();
    fireEvent.click(screen.getByTestId("masks-sheet-hear"));
    // No frames fed during the window → nothing to play back.
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(lastBufferSource).toBeNull();
    // An empty window is no longer a silent no-op: the button surfaces a
    // transient NO MIC SIGNAL state, then returns to idle.
    expect(screen.getByTestId("masks-sheet-hear").textContent).toContain(
      "NO MIC SIGNAL",
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId("masks-sheet-hear").textContent).toContain(
      "TAP TO HEAR",
    );
  });

  it("records on tap, then plays the masked recording back", async () => {
    vi.useFakeTimers();
    await act(async () => {
      render(<MasksSheet {...baseProps()} />);
    });
    // Tap → enters the recording window; no playback yet.
    fireEvent.click(screen.getByTestId("masks-sheet-hear"));
    expect(screen.getByTestId("masks-sheet-hear").textContent).toContain(
      "RECORDING",
    );
    expect(lastBufferSource).toBeNull();

    // Masked mic frames arrive during the window.
    pumpAudio();

    // Window closes → the captured frames play back.
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(lastBufferSource).not.toBeNull();
    expect(lastBufferSource?.start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("masks-sheet-hear").textContent).toContain(
      "PLAYING",
    );
  });

  it("flushSignal stops in-flight playback (BURN / leave)", async () => {
    vi.useFakeTimers();
    const props = baseProps();
    let rerender: ReturnType<typeof render>["rerender"] | undefined;
    await act(async () => {
      ({ rerender } = render(<MasksSheet {...props} flushSignal={0} />));
    });
    fireEvent.click(screen.getByTestId("masks-sheet-hear"));
    pumpAudio();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    const node = lastBufferSource;
    expect(node?.start).toHaveBeenCalledTimes(1);

    // Bump flushSignal → flush stops playback + resets the label.
    await act(async () => {
      rerender!(<MasksSheet {...props} flushSignal={1} />);
    });
    expect(node?.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("masks-sheet-hear").textContent).toContain(
      "TAP TO HEAR",
    );
  });

  it("flushSignal during the record window cancels the capture", async () => {
    vi.useFakeTimers();
    const props = baseProps();
    let rerender: ReturnType<typeof render>["rerender"] | undefined;
    await act(async () => {
      ({ rerender } = render(<MasksSheet {...props} flushSignal={0} />));
    });
    fireEvent.click(screen.getByTestId("masks-sheet-hear"));
    pumpAudio();
    // Flush mid-recording: clears the record timer + drops captured frames.
    await act(async () => {
      rerender!(<MasksSheet {...props} flushSignal={1} />);
    });
    lastBufferSource = null;
    // The timer was cleared, so advancing past the window starts no playback.
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(lastBufferSource).toBeNull();
    expect(screen.getByTestId("masks-sheet-hear").textContent).toContain(
      "TAP TO HEAR",
    );
  });

  it("tears down the capture graph on close (unmount path)", async () => {
    const props = baseProps();
    let rerender: ReturnType<typeof render>["rerender"] | undefined;
    await act(async () => {
      ({ rerender } = render(<MasksSheet {...props} />));
    });
    const processor = lastProcessor;
    expect(processor).not.toBeNull();
    await act(async () => {
      rerender!(<MasksSheet {...props} open={false} />);
    });
    // Closing nulls the handler and disconnects the processor node.
    expect(processor?.onaudioprocess).toBeNull();
    expect(processor?.disconnect).toHaveBeenCalled();
  });

  it("cancels the record timer on close so no playback fires after the sheet is gone", async () => {
    vi.useFakeTimers();
    const props = baseProps();
    let rerender: ReturnType<typeof render>["rerender"] | undefined;
    await act(async () => {
      ({ rerender } = render(<MasksSheet {...props} />));
    });
    fireEvent.click(screen.getByTestId("masks-sheet-hear"));
    pumpAudio();
    // Close mid-recording: teardown must clear the record timer too.
    await act(async () => {
      rerender!(<MasksSheet {...props} open={false} />);
    });
    lastBufferSource = null;
    // Advancing past the record window must NOT start playback.
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(lastBufferSource).toBeNull();
  });
});

// Task #597: the in-sheet REVOKE control flips both clear grants OFF.
// Gating for re-selecting a CLEAR option must read the LIVE pref mirror,
// not the (possibly stale) prop captured at open — otherwise a user could
// revoke and then silently re-commit an unmasked stream without the grant
// confirm. This pins the revoke -> re-select -> confirm-required contract.
describe("MasksSheet REVOKE then re-select requires the grant confirm again (Task #597)", () => {
  beforeEach(() => {
    lastProcessor = null;
    lastBufferSource = null;
    streamSourceCount = 0;
    setVoiceMode.mockClear();
    setVideoStyle.mockClear();
    try { localStorage.clear(); } catch {}
    (globalThis as unknown as { AudioContext: unknown }).AudioContext =
      FakeAudioContext as unknown;
    (window as unknown as { AudioContext: unknown }).AudioContext =
      FakeAudioContext as unknown;
    (globalThis as unknown as { MediaStream: unknown }).MediaStream =
      class {
        constructor(_tracks?: unknown) {}
      } as unknown;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    try { localStorage.clear(); } catch {}
  });

  it("has no axe violations when open", async () => {
    await act(async () => {
      render(<MasksSheet {...baseProps()} />);
    });
    await expectNoAxeViolations(screen.getByTestId("masks-sheet"));
  });

  it("revoking then re-selecting CLEAR video re-opens the grant confirm", async () => {
    // Open with a live video grant in effect.
    localStorage.setItem("voidAllowUnmaskedVideo", "1");
    await act(async () => {
      render(<MasksSheet {...baseProps()} allowUnmaskedVideo={true} />);
    });

    // Revoke is visible because a grant is live; clicking it clears it.
    await act(async () => {
      screen.getByTestId("masks-sheet-revoke").click();
    });
    expect(screen.getByTestId("masks-sheet-revoke-note")).toBeInTheDocument();
    expect(localStorage.getItem("voidAllowUnmaskedVideo")).toBeNull();

    // Re-selecting the CLEAR (NONE) video option must now prompt the grant
    // confirm again — the stale prop must not let it through.
    await act(async () => {
      screen.getByTestId("masks-sheet-video-option-0").click();
    });
    expect(screen.getByTestId("masks-sheet-video-confirm")).toBeInTheDocument();
  });
});
