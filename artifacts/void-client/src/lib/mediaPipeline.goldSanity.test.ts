// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as { __VOICE_MASK_VERSION__?: string }).__VOICE_MASK_VERSION__ = "test";

// ─── jsdom shims ─────────────────────────────────────────────────────────────
//
// Mirrors the leak-test harness, plus two extras the GOLD sanity-check
// scenarios need that the leak suite does not:
//
//   • `HTMLMediaElement.readyState` must be ≥ 2 so the render loop's
//     `if (srcVideo.readyState < 2) return;` guard does not skip the
//     frame we're trying to drive.
//   • `requestAnimationFrame` must actually invoke its callback (with
//     a controllable timestamp) so the render loop runs — the leak
//     suite only counts scheduling intent and never fires frames.

if (typeof (globalThis as { MediaStream?: unknown }).MediaStream === "undefined") {
  class FakeMediaStream {
    private readonly _tracks: unknown[];
    constructor(tracks: unknown[] = []) {
      this._tracks = tracks.slice();
    }
    getTracks() {
      return this._tracks.slice();
    }
    getVideoTracks() {
      return this._tracks.filter(
        (t) => (t as { kind?: string }).kind === "video",
      );
    }
    getAudioTracks() {
      return this._tracks.filter(
        (t) => (t as { kind?: string }).kind === "audio",
      );
    }
  }
  (globalThis as { MediaStream?: unknown }).MediaStream =
    FakeMediaStream as unknown as typeof MediaStream;
}

{
  const proto = HTMLMediaElement.prototype as unknown as {
    play: () => Promise<void>;
  };
  proto.play = function fakePlay() {
    return Promise.resolve();
  };
  // Pretend the hidden <video> always has decoded data so the render
  // loop's readyState gate does not skip frames during the test.
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get() {
      return 4; // HAVE_ENOUGH_DATA
    },
  });
}

import { buildMediaPipeline } from "./mediaPipeline";

// ─── Controllable RAF driver ─────────────────────────────────────────────────
//
// The render loop re-schedules itself at the TOP of every callback
// (`rafId = requestAnimationFrame(render)`), so this driver only ever
// holds the single most-recently-scheduled callback. `drive(ts)` runs
// it with the supplied timestamp, after which the next callback (the
// re-schedule) is captured for the following call.

interface RafDriver {
  drive: (timestamp: number) => void;
  scheduled: () => number;
  cancelled: () => number;
  restore: () => void;
}

function installRafDriver(): RafDriver {
  let pending: FrameRequestCallback | null = null;
  let scheduled = 0;
  let cancelled = 0;
  let nextId = 1;
  const rafSpy = vi
    .spyOn(globalThis, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      pending = cb;
      scheduled += 1;
      return nextId++;
    });
  const cancelSpy = vi
    .spyOn(globalThis, "cancelAnimationFrame")
    .mockImplementation(() => {
      cancelled += 1;
      pending = null;
    });
  return {
    drive(timestamp: number) {
      const cb = pending;
      pending = null;
      if (cb) cb(timestamp);
    },
    scheduled: () => scheduled,
    cancelled: () => cancelled,
    restore: () => {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    },
  };
}

// ─── Fake WebGL2 with controllable readPixels ────────────────────────────────
//
// The leak-suite fake gl is no-op everywhere; the sanity check needs
// `readPixels` to actually write into the destination buffer so the
// production code's all-zero scan has something to scan. The "pixels"
// closure variable lets a test rewrite the fill value between frames.

interface GLController {
  setPixels: (pattern: number[] | "zero" | "nonzero") => void;
  readPixelsCalls: () => number;
}

function makeFakeGLContext(): { gl: WebGL2RenderingContext; ctl: GLController } {
  let pattern: number[] | "zero" | "nonzero" = "nonzero";
  let readPixelsCalls = 0;
  const noop = () => {};
  const obj = () => ({});
  const trueFn = () => true;
  const ext = { loseContext: () => {} };
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8,
    TEXTURE_2D: 9, TEXTURE0: 10, TEXTURE1: 11, RGBA: 12, UNSIGNED_BYTE: 13,
    LINEAR: 14, NEAREST: 15, CLAMP_TO_EDGE: 16,
    TEXTURE_MIN_FILTER: 17, TEXTURE_MAG_FILTER: 18,
    TEXTURE_WRAP_S: 19, TEXTURE_WRAP_T: 20, UNPACK_FLIP_Y_WEBGL: 21,
    createShader: obj, shaderSource: noop, compileShader: noop,
    getShaderParameter: trueFn, getShaderInfoLog: () => "", deleteShader: noop,
    createProgram: obj, attachShader: noop, linkProgram: noop,
    getProgramParameter: trueFn, getProgramInfoLog: () => "", deleteProgram: noop,
    createBuffer: obj, bindBuffer: noop, bufferData: noop,
    getAttribLocation: () => 0, createVertexArray: obj, bindVertexArray: noop,
    enableVertexAttribArray: noop, vertexAttribPointer: noop,
    createTexture: obj, bindTexture: noop, texParameteri: noop,
    texImage2D: noop, pixelStorei: noop, useProgram: noop,
    getUniformLocation: obj, uniform1i: noop, uniform1f: noop,
    uniform2f: noop, uniform3f: noop, activeTexture: noop, viewport: noop,
    drawArrays: noop, deleteTexture: noop, deleteBuffer: noop,
    deleteVertexArray: noop,
    readPixels: (
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      _fmt: number,
      _type: number,
      dest: ArrayBufferView,
    ) => {
      readPixelsCalls += 1;
      const buf = dest as Uint8Array;
      if (pattern === "zero") {
        buf.fill(0);
      } else if (pattern === "nonzero") {
        buf.fill(0xff);
      } else {
        for (let i = 0; i < buf.length; i++) {
          buf[i] = pattern[i % pattern.length] ?? 0;
        }
      }
    },
    getExtension: (name: string) =>
      name === "WEBGL_lose_context" ? ext : null,
  } as unknown as WebGL2RenderingContext;
  return {
    gl,
    ctl: {
      setPixels: (p) => { pattern = p; },
      readPixelsCalls: () => readPixelsCalls,
    },
  };
}

function makeFake2DContext(): CanvasRenderingContext2D {
  return {
    fillStyle: "#000",
    font: "10px monospace",
    textBaseline: "top" as CanvasTextBaseline,
    fillRect: () => {},
    fillText: () => {},
    drawImage: () => {},
    measureText: () => ({ width: 50 }),
  } as unknown as CanvasRenderingContext2D;
}

interface ProcessedTrackSpy {
  stopCalls: number;
}

function installCanvasMocks(glCtl: GLController, glRef: WebGL2RenderingContext): {
  processedTrack: ProcessedTrackSpy;
  restore: () => void;
} {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  const origCaptureStream = (
    HTMLCanvasElement.prototype as unknown as {
      captureStream?: (fps?: number) => MediaStream;
    }
  ).captureStream;

  const processedTrack: ProcessedTrackSpy = { stopCalls: 0 };

  (
    HTMLCanvasElement.prototype as unknown as {
      captureStream: (fps?: number) => MediaStream;
    }
  ).captureStream = function fakeCaptureStream(): MediaStream {
    const track = {
      kind: "video",
      stop: () => { processedTrack.stopCalls += 1; },
      getSettings: () => ({ width: 320, height: 240 }),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStreamTrack;
    return {
      getTracks: () => [track],
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
  };

  HTMLCanvasElement.prototype.getContext = function patched(
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ): unknown {
    if (type === "webgl2") return glRef;
    if (type === "2d") return makeFake2DContext();
    return origGetContext.call(this, type as never, ...(rest as []));
  } as typeof HTMLCanvasElement.prototype.getContext;

  // touch glCtl so eslint/ts don't flag it as unused on the surface;
  // the controller is the test's handle for mutating readPixels.
  void glCtl;

  return {
    processedTrack,
    restore: () => {
      HTMLCanvasElement.prototype.getContext = origGetContext;
      if (origCaptureStream) {
        (
          HTMLCanvasElement.prototype as unknown as {
            captureStream: (fps?: number) => MediaStream;
          }
        ).captureStream = origCaptureStream;
      } else {
        delete (
          HTMLCanvasElement.prototype as unknown as {
            captureStream?: (fps?: number) => MediaStream;
          }
        ).captureStream;
      }
    },
  };
}

function makeFakeTrack(kind: "video" | "audio"): MediaStreamTrack {
  return {
    kind,
    stop: () => {},
    getSettings: () => ({ width: 1280, height: 720 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaStreamTrack;
}

function installGetUserMedia(): () => void {
  const orig = navigator.mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        const v = makeFakeTrack("video");
        const a = makeFakeTrack("audio");
        return {
          getTracks: () => [v, a],
          getVideoTracks: () => [v],
          getAudioTracks: () => [a],
        } as unknown as MediaStream;
      }),
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  return () => {
    if (orig) {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: orig,
      });
    } else {
      delete (navigator as unknown as { mediaDevices?: MediaDevices })
        .mediaDevices;
    }
  };
}

function makeFakeAudioContext(): AudioContext {
  const node = () => ({
    connect: () => {},
    disconnect: () => {},
    gain: { value: 0, setTargetAtTime: () => {} },
    frequency: { value: 0 },
    type: "lowpass",
    fftSize: 0,
    port: { close: () => {}, postMessage: () => {} },
    stream: {
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [makeFakeTrack("audio")],
    } as unknown as MediaStream,
  });
  return {
    currentTime: 0,
    destination: {},
    audioWorklet: {
      addModule: () => Promise.reject(new Error("worklet add failed")),
    },
    createMediaStreamSource: node,
    createGain: node,
    createBiquadFilter: node,
    createMediaStreamDestination: node,
    createAnalyser: node,
    close: () => Promise.resolve(),
  } as unknown as AudioContext;
}

// FRAME_INTERVAL inside the pipeline is 1000/15 ≈ 66.7ms. Use 100ms
// steps so each driven frame clears the throttle.
const FRAME_STEP = 100;
function tsAt(i: number): number {
  return FRAME_STEP * (i + 1);
}

describe("GOLD blank-frame sanity check", () => {
  let raf: RafDriver;
  let restoreMedia: () => void;
  let gl: WebGL2RenderingContext;
  let glCtl: GLController;
  let canvasMocks: ReturnType<typeof installCanvasMocks>;

  beforeEach(() => {
    raf = installRafDriver();
    restoreMedia = installGetUserMedia();
    const made = makeFakeGLContext();
    gl = made.gl;
    glCtl = made.ctl;
    canvasMocks = installCanvasMocks(glCtl, gl);
  });

  afterEach(() => {
    raf.restore();
    restoreMedia();
    canvasMocks.restore();
  });

  it("disables GOLD via onVideoStyleDisabled (does NOT call onError, does NOT stop the track) when GOLD renders blank", async () => {
    // Task #526: the GOLD blank-frame sanity trip used to kill the
    // outgoing track and surface a PipelineError, which blacked out
    // the user's camera mid-call. The new contract: keep streaming,
    // fire onVideoStyleDisabled(1) so the React side can skip GOLD
    // in the cycle, and (if currently on GOLD) snap currentMode back
    // to passthrough so the next driven frame is non-blank.
    const onError = vi.fn();
    const onVideoStyleDisabled = vi.fn();
    const pipeline = await buildMediaPipeline(makeFakeAudioContext(), {
      onError,
      onVideoStyleDisabled,
    });

    glCtl.setPixels("zero");
    pipeline.setVideoStyle(1);

    for (let i = 0; i < 5; i++) raf.drive(tsAt(i));

    expect(onError).not.toHaveBeenCalled();
    expect(onVideoStyleDisabled).toHaveBeenCalledTimes(1);
    expect(onVideoStyleDisabled).toHaveBeenCalledWith(1);
    expect(canvasMocks.processedTrack.stopCalls).toBe(0);
    // The render loop must keep ticking after the disable — the
    // pipeline only stops on explicit pipeline.stop() now.
    const scheduledAtDisable = raf.scheduled();
    raf.drive(tsAt(10));
    expect(raf.scheduled()).toBeGreaterThan(scheduledAtDisable);

    pipeline.stop();
  });

  it("does not fire onVideoStyleDisabled when GOLD renders a non-blank frame", async () => {
    const onError = vi.fn();
    const onVideoStyleDisabled = vi.fn();
    const pipeline = await buildMediaPipeline(makeFakeAudioContext(), {
      onError,
      onVideoStyleDisabled,
    });

    glCtl.setPixels("nonzero");
    pipeline.setVideoStyle(1);

    for (let i = 0; i < 6; i++) raf.drive(tsAt(i));

    expect(glCtl.readPixelsCalls()).toBe(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onVideoStyleDisabled).not.toHaveBeenCalled();
    expect(canvasMocks.processedTrack.stopCalls).toBe(0);

    pipeline.stop();
  });

  it("skips the sanity check entirely when the user switches away from GOLD before warm-up completes", async () => {
    const onError = vi.fn();
    const onVideoStyleDisabled = vi.fn();
    const pipeline = await buildMediaPipeline(makeFakeAudioContext(), {
      onError,
      onVideoStyleDisabled,
    });

    glCtl.setPixels("zero");
    pipeline.setVideoStyle(1);

    raf.drive(tsAt(0));
    pipeline.setVideoStyle(0);
    for (let i = 1; i < 6; i++) raf.drive(tsAt(i));

    expect(glCtl.readPixelsCalls()).toBe(0);
    expect(onError).not.toHaveBeenCalled();
    expect(onVideoStyleDisabled).not.toHaveBeenCalled();
    expect(canvasMocks.processedTrack.stopCalls).toBe(0);

    pipeline.stop();
  });

  it("once GOLD is disabled, a subsequent setVideoStyle(1) is coerced back to passthrough (no re-arm of the bad mode)", async () => {
    // Task #526 defensive backstop: even if a stale press of the
    // cycle button asks for GOLD after the disable, the pipeline
    // must refuse to switch into it. We verify this by checking
    // that no further sanity-check readPixels call ever fires
    // after the disable, regardless of how many times we ask for
    // GOLD afterwards — `goldSanityNeeded` is only set inside
    // setVideoStyle(1) on the non-disabled path.
    const onVideoStyleDisabled = vi.fn();
    const pipeline = await buildMediaPipeline(makeFakeAudioContext(), {
      onVideoStyleDisabled,
    });

    glCtl.setPixels("zero");
    pipeline.setVideoStyle(1);
    for (let i = 0; i < 5; i++) raf.drive(tsAt(i));
    expect(onVideoStyleDisabled).toHaveBeenCalledTimes(1);
    const readPixelsAfterDisable = glCtl.readPixelsCalls();

    // Switch to a different mode, then back to GOLD. Even with
    // pixels still set to zero, no further readPixels should fire
    // (the early-return in setVideoStyle short-circuits the warm-up
    // arm) and no second disable callback should be raised.
    pipeline.setVideoStyle(2);
    for (let i = 5; i < 8; i++) raf.drive(tsAt(i));
    pipeline.setVideoStyle(1);
    for (let i = 8; i < 14; i++) raf.drive(tsAt(i));

    expect(glCtl.readPixelsCalls()).toBe(readPixelsAfterDisable);
    expect(onVideoStyleDisabled).toHaveBeenCalledTimes(1);

    pipeline.stop();
  });

  it("when GOLD is the active mode at trip time, the pipeline internally swaps to passthrough so the next frame is non-blank", async () => {
    // Task #526: the user is on GOLD when the sanity trips. After
    // the trip the pipeline must have switched its own currentMode
    // back to 0 (PASS). We verify this by toggling pixels to
    // nonzero AFTER the disable and then asking for GOLD again —
    // because GOLD is now coerced to passthrough, the pixels stay
    // nonzero from the readPixels point of view but no NEW sanity
    // readPixels call fires. (The behavioural assertion that the
    // next frame is non-blank is implicit: the render loop kept
    // ticking and currentMode is 0.)
    const onVideoStyleDisabled = vi.fn();
    const pipeline = await buildMediaPipeline(makeFakeAudioContext(), {
      onVideoStyleDisabled,
    });

    glCtl.setPixels("zero");
    pipeline.setVideoStyle(1);
    for (let i = 0; i < 5; i++) raf.drive(tsAt(i));
    expect(onVideoStyleDisabled).toHaveBeenCalledWith(1);

    // After the disable, drive more frames in GOLD-was-requested
    // mode. The pipeline has snapped to mode 0, so requesting GOLD
    // again is a no-op for the sanity machinery.
    const readPixelsBefore = glCtl.readPixelsCalls();
    pipeline.setVideoStyle(1);
    for (let i = 5; i < 12; i++) raf.drive(tsAt(i));
    expect(glCtl.readPixelsCalls()).toBe(readPixelsBefore);

    pipeline.stop();
  });
});
