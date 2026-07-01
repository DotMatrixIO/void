// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as { __VOICE_MASK_VERSION__?: string }).__VOICE_MASK_VERSION__ = "test";

// jsdom does not expose a MediaStream constructor. The pipeline wraps
// individual tracks in `new MediaStream([track])` to feed them through
// hidden <video> elements; install a minimal shim that satisfies that
// contract for the duration of the leak tests.
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

// jsdom's HTMLMediaElement.play returns undefined synchronously rather
// than a Promise; the pipeline calls `.catch(...)` on the result, so
// patch it to always return a resolved Promise for the duration of the
// leak tests.
{
  const proto = HTMLMediaElement.prototype as unknown as {
    play: () => Promise<void>;
  };
  proto.play = function fakePlay() {
    return Promise.resolve();
  };
}

import {
  buildMediaPipeline,
  createWatermarkedScreenShareTrack,
} from "./mediaPipeline";

// ── Test harness ─────────────────────────────────────────────────────────────
//
// jsdom does not implement getUserMedia, WebGL2, captureStream, or the Web
// Audio API end-to-end. The leak-regression tests for the camera and
// screen-share pipelines need just enough of those surfaces to let the
// pipeline's build → stop cycle run, and they need to be able to count
// requestAnimationFrame / cancelAnimationFrame and WEBGL_lose_context calls
// across the cycle. This harness wires up minimal fakes for each of those.

interface RAFTracker {
  scheduledIds: Set<number>;
  cancelledIds: Set<number>;
  rafSpy: ReturnType<typeof vi.spyOn>;
  cancelSpy: ReturnType<typeof vi.spyOn>;
  restore: () => void;
}

function installRafTracker(): RAFTracker {
  const scheduledIds = new Set<number>();
  const cancelledIds = new Set<number>();
  let nextId = 1;
  const rafSpy = vi
    .spyOn(globalThis, "requestAnimationFrame")
    .mockImplementation(() => {
      // Don't actually schedule the callback — we don't want render loops
      // firing during a unit test, just to count scheduling intent.
      const id = nextId++;
      scheduledIds.add(id);
      return id;
    });
  const cancelSpy = vi
    .spyOn(globalThis, "cancelAnimationFrame")
    .mockImplementation((id: number) => {
      cancelledIds.add(id);
    });
  return {
    scheduledIds,
    cancelledIds,
    rafSpy,
    cancelSpy,
    restore: () => {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    },
  };
}

interface FakeGL {
  loseContextCalls: number;
  deleteCount: number;
}

function makeFakeGLContext(): {
  gl: WebGL2RenderingContext;
  state: FakeGL;
} {
  const state: FakeGL = { loseContextCalls: 0, deleteCount: 0 };
  const noop = () => {};
  const numberFn = () => 0;
  const obj = () => ({});
  const trueFn = () => true;
  const ext = {
    loseContext: () => {
      state.loseContextCalls += 1;
    },
  };
  const gl = {
    // Constants the pipeline reads.
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    TRIANGLES: 8,
    TEXTURE_2D: 9,
    TEXTURE0: 10,
    TEXTURE1: 11,
    RGBA: 12,
    UNSIGNED_BYTE: 13,
    LINEAR: 14,
    NEAREST: 15,
    CLAMP_TO_EDGE: 16,
    TEXTURE_MIN_FILTER: 17,
    TEXTURE_MAG_FILTER: 18,
    TEXTURE_WRAP_S: 19,
    TEXTURE_WRAP_T: 20,
    UNPACK_FLIP_Y_WEBGL: 21,

    createShader: () => ({}),
    shaderSource: noop,
    compileShader: noop,
    getShaderParameter: trueFn,
    getShaderInfoLog: () => "",
    deleteShader: noop,
    createProgram: () => ({}),
    attachShader: noop,
    linkProgram: noop,
    getProgramParameter: trueFn,
    getProgramInfoLog: () => "",
    deleteProgram: () => {
      state.deleteCount += 1;
    },
    createBuffer: obj,
    bindBuffer: noop,
    bufferData: noop,
    getAttribLocation: numberFn,
    createVertexArray: obj,
    bindVertexArray: noop,
    enableVertexAttribArray: noop,
    vertexAttribPointer: noop,
    createTexture: obj,
    bindTexture: noop,
    texParameteri: noop,
    texImage2D: noop,
    pixelStorei: noop,
    useProgram: noop,
    getUniformLocation: obj,
    uniform1i: noop,
    uniform1f: noop,
    uniform2f: noop,
    uniform3f: noop,
    activeTexture: noop,
    viewport: noop,
    drawArrays: noop,
    deleteTexture: () => {
      state.deleteCount += 1;
    },
    deleteBuffer: () => {
      state.deleteCount += 1;
    },
    deleteVertexArray: () => {
      state.deleteCount += 1;
    },
    getExtension: (name: string) =>
      name === "WEBGL_lose_context" ? ext : null,
  } as unknown as WebGL2RenderingContext;
  return { gl, state };
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

interface CanvasContextController {
  webglState: FakeGL;
  // Force the next get-2d-context call to return null (simulates a
  // browser without 2D canvas support, e.g. headless-printer-style
  // contexts) so we can exercise the partial-init failure path that
  // happens AFTER the WebGL2 context has already been allocated.
  failNextGet2D: { value: boolean };
  // Force the next get-webgl2-context call to return null (simulates
  // a browser that refuses WebGL2). The pipeline tries `webgl2` twice
  // — once with options, once without — so this counter exists to
  // suppress N consecutive attempts.
  failNextWebGL2: { value: number };
  restore: () => void;
}

function installCanvasMocks(): CanvasContextController {
  const failNextGet2D = { value: false };
  const failNextWebGL2 = { value: 0 };
  const webglState: FakeGL = { loseContextCalls: 0, deleteCount: 0 };

  const origGetContext = HTMLCanvasElement.prototype.getContext;
  const origCaptureStream = (
    HTMLCanvasElement.prototype as unknown as {
      captureStream?: (fps?: number) => MediaStream;
    }
  ).captureStream;

  // captureStream is missing in jsdom; install a minimal version that
  // returns a stream with one fake video track so the pipeline can
  // hand a track to the caller.
  (
    HTMLCanvasElement.prototype as unknown as {
      captureStream: (fps?: number) => MediaStream;
    }
  ).captureStream = function fakeCaptureStream(): MediaStream {
    const track = makeFakeTrack("video");
    return {
      getTracks: () => [track],
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
  };

  HTMLCanvasElement.prototype.getContext = function patchedGetContext(
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ): unknown {
    if (type === "webgl2") {
      if (failNextWebGL2.value > 0) {
        failNextWebGL2.value -= 1;
        return null;
      }
      const { gl, state } = makeFakeGLContext();
      // Mirror state into the shared controller so the test can read
      // loseContext / delete counts after pipeline.stop().
      Object.assign(webglState, {});
      const proxy = new Proxy(gl, {
        get(target, prop, receiver) {
          if (prop === "getExtension") {
            return (name: string) => {
              const ext = (
                target as unknown as {
                  getExtension: (name: string) => unknown;
                }
              ).getExtension(name);
              return ext;
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      // Bridge state: every fake gl gets its own counter; we want the
      // controller's webglState to reflect the LATEST gl that the test
      // touched. So forward writes by replacing the methods on `state`.
      const origLose = (gl.getExtension("WEBGL_lose_context") as {
        loseContext: () => void;
      }).loseContext;
      (gl.getExtension("WEBGL_lose_context") as {
        loseContext: () => void;
      }).loseContext = () => {
        origLose();
        webglState.loseContextCalls = state.loseContextCalls;
      };
      const origDeleteTexture = gl.deleteTexture.bind(gl);
      gl.deleteTexture = ((tex: WebGLTexture | null) => {
        origDeleteTexture(tex);
        webglState.deleteCount = state.deleteCount;
      }) as typeof gl.deleteTexture;
      const origDeleteBuffer = gl.deleteBuffer.bind(gl);
      gl.deleteBuffer = ((buf: WebGLBuffer | null) => {
        origDeleteBuffer(buf);
        webglState.deleteCount = state.deleteCount;
      }) as typeof gl.deleteBuffer;
      const origDeleteVAO = gl.deleteVertexArray.bind(gl);
      gl.deleteVertexArray = ((vao: WebGLVertexArrayObject | null) => {
        origDeleteVAO(vao);
        webglState.deleteCount = state.deleteCount;
      }) as typeof gl.deleteVertexArray;
      const origDeleteProgram = gl.deleteProgram.bind(gl);
      gl.deleteProgram = ((prog: WebGLProgram | null) => {
        origDeleteProgram(prog);
        webglState.deleteCount = state.deleteCount;
      }) as typeof gl.deleteProgram;
      return proxy;
    }
    if (type === "2d") {
      if (failNextGet2D.value) {
        failNextGet2D.value = false;
        return null;
      }
      return makeFake2DContext();
    }
    return origGetContext.call(this, type as never, ...(rest as []));
  } as typeof HTMLCanvasElement.prototype.getContext;

  return {
    webglState,
    failNextGet2D,
    failNextWebGL2,
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
  const listeners: Record<string, Array<EventListener>> = {};
  return {
    kind,
    stop: () => {},
    getSettings: () => ({ width: 1280, height: 720 }),
    addEventListener: (name: string, fn: EventListener) => {
      (listeners[name] ??= []).push(fn);
    },
    removeEventListener: (name: string, fn: EventListener) => {
      listeners[name] = (listeners[name] ?? []).filter((l) => l !== fn);
    },
  } as unknown as MediaStreamTrack;
}

function makeFakeMediaStream(opts: {
  video?: boolean;
  audio?: boolean;
}): MediaStream {
  const tracks: MediaStreamTrack[] = [];
  if (opts.video !== false) tracks.push(makeFakeTrack("video"));
  if (opts.audio !== false) tracks.push(makeFakeTrack("audio"));
  return {
    getTracks: () => tracks.slice(),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
  } as unknown as MediaStream;
}

function installGetUserMedia(opts?: {
  video?: boolean;
  audio?: boolean;
}): () => void {
  const orig = navigator.mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => makeFakeMediaStream(opts ?? {})),
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
      // jsdom may not have set this; remove our shim.
      delete (navigator as unknown as { mediaDevices?: MediaDevices })
        .mediaDevices;
    }
  };
}

function makeFakeAudioContext(opts?: {
  audioWorkletFails?: boolean;
}): AudioContext {
  const node = () => ({
    connect: () => {},
    disconnect: () => {},
    gain: { value: 0, setTargetAtTime: () => {} },
    frequency: { value: 0 },
    type: "lowpass",
    fftSize: 0,
    port: { close: () => {}, postMessage: () => {} },
    stream: makeFakeMediaStream({ video: false }),
  });
  return {
    currentTime: 0,
    destination: {},
    audioWorklet: {
      addModule: opts?.audioWorkletFails
        ? () => Promise.reject(new Error("worklet add failed"))
        : () => Promise.resolve(),
    },
    createMediaStreamSource: node,
    createGain: node,
    createBiquadFilter: node,
    createMediaStreamDestination: node,
    createAnalyser: node,
    close: () => Promise.resolve(),
  } as unknown as AudioContext;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("buildMediaPipeline resource teardown", () => {
  let raf: RAFTracker;
  let canvasMocks: CanvasContextController;
  let restoreMedia: () => void;

  beforeEach(() => {
    raf = installRafTracker();
    canvasMocks = installCanvasMocks();
    restoreMedia = installGetUserMedia();
  });

  afterEach(() => {
    raf.restore();
    canvasMocks.restore();
    restoreMedia();
  });

  it("balances requestAnimationFrame with cancelAnimationFrame across build → stop", async () => {
    const audioCtx = makeFakeAudioContext({ audioWorkletFails: true });
    const pipeline = await buildMediaPipeline(audioCtx);

    // The render loop schedules exactly one RAF on entry; until stop()
    // runs nothing has cancelled it.
    expect(raf.scheduledIds.size).toBeGreaterThanOrEqual(1);
    expect(raf.cancelledIds.size).toBe(0);

    pipeline.stop();

    // Every scheduled RAF id must have been passed to cancelAnimationFrame
    // by the time stop() returns — otherwise a render callback could fire
    // after teardown and re-touch the WebGL context the user just released.
    for (const id of raf.scheduledIds) {
      expect(raf.cancelledIds.has(id)).toBe(true);
    }
  });

  it("calls WEBGL_lose_context.loseContext exactly once across build → stop", async () => {
    const audioCtx = makeFakeAudioContext({ audioWorkletFails: true });
    const pipeline = await buildMediaPipeline(audioCtx);

    expect(canvasMocks.webglState.loseContextCalls).toBe(0);

    pipeline.stop();

    // stop() releases the context explicitly; the partial-cleanup stack
    // also pushes a loseContext closure but it is removed when the
    // success path returns, so we must end at exactly 1, not 2.
    expect(canvasMocks.webglState.loseContextCalls).toBe(1);
  });

  it("releases the WebGL context and stops the render loop when the 2D compositor is unavailable mid-build", async () => {
    // Force the SECOND get-2d-context call (the compositor canvas; the
    // first one is the font-atlas in generateFontAtlas) to return null
    // so we hit the throw at L444 of mediaPipeline.ts. By that point
    // the WebGL2 context is fully allocated and its lose-context
    // cleanup is already on the stack — it must run during teardown.
    let twoDeeCalls = 0;
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patched(
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ): unknown {
      if (type === "2d") {
        twoDeeCalls += 1;
        if (twoDeeCalls === 2) return null;
      }
      return origGetContext.call(this, type as never, ...(rest as []));
    } as typeof HTMLCanvasElement.prototype.getContext;

    try {
      const audioCtx = makeFakeAudioContext({ audioWorkletFails: true });
      await expect(buildMediaPipeline(audioCtx)).rejects.toThrow(
        /2D context unavailable/,
      );
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }

    // Failure path released the WebGL context, and no render loop ever
    // started so RAF should still be balanced (zero scheduled, zero
    // cancelled, both fine — but never positive-and-uncancelled).
    expect(canvasMocks.webglState.loseContextCalls).toBe(1);
    expect(raf.scheduledIds.size).toBe(0);
  });

  it("cleans up tracks and DOM on the WebGL2-not-supported failure path without leaking RAF", async () => {
    canvasMocks.failNextWebGL2.value = 2; // both fallback attempts return null

    const audioCtx = makeFakeAudioContext({ audioWorkletFails: true });
    await expect(buildMediaPipeline(audioCtx)).rejects.toThrow(
      /WebGL2 not supported/,
    );

    // The hidden <video> and the WebGL canvas are both inserted before
    // the WebGL2 check; partial cleanup should remove them so the DOM
    // does not accumulate orphan nodes after a failed init.
    expect(document.querySelectorAll("video").length).toBe(0);
    expect(document.querySelectorAll("canvas").length).toBe(0);

    // No render loop was ever scheduled on this path; nothing to cancel.
    expect(raf.scheduledIds.size).toBe(0);
    expect(canvasMocks.webglState.loseContextCalls).toBe(0);
  });
});

describe("createWatermarkedScreenShareTrack resource teardown", () => {
  let raf: RAFTracker;
  let canvasMocks: CanvasContextController;

  beforeEach(() => {
    raf = installRafTracker();
    canvasMocks = installCanvasMocks();
  });

  afterEach(() => {
    raf.restore();
    canvasMocks.restore();
  });

  it("balances requestAnimationFrame with cancelAnimationFrame across build → stop", () => {
    const sourceStream = makeFakeMediaStream({ audio: false });
    const wrapped = createWatermarkedScreenShareTrack(
      sourceStream,
      () => null,
      15,
    );

    expect(raf.scheduledIds.size).toBeGreaterThanOrEqual(1);
    expect(raf.cancelledIds.size).toBe(0);

    wrapped.stop();

    for (const id of raf.scheduledIds) {
      expect(raf.cancelledIds.has(id)).toBe(true);
    }
  });

  it("does not leak RAF, hidden <video>, or compositor canvas when 2D context is unavailable", () => {
    // First get-2d-context call belongs to the compositor and is the
    // only one in the screen-share path (no font-atlas here).
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patched(
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ): unknown {
      if (type === "2d") return null;
      return origGetContext.call(this, type as never, ...(rest as []));
    } as typeof HTMLCanvasElement.prototype.getContext;

    try {
      const sourceStream = makeFakeMediaStream({ audio: false });
      expect(() =>
        createWatermarkedScreenShareTrack(sourceStream, () => null, 15),
      ).toThrow(/2D context unavailable for screen-share compositor/);
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }

    // Failure path runs before requestAnimationFrame is called, but
    // also before any cancelAnimationFrame — so the assertion is that
    // nothing was ever scheduled, not that things were balanced after.
    expect(raf.scheduledIds.size).toBe(0);
    expect(document.querySelectorAll("video").length).toBe(0);
    expect(document.querySelectorAll("canvas").length).toBe(0);
  });

  it("cancels the scheduled RAF before throwing when captureStream yields no track", () => {
    // Override captureStream to return a stream with zero video tracks
    // — the post-RAF failure path that the inline comment at L737-744
    // explicitly guards against.
    (
      HTMLCanvasElement.prototype as unknown as {
        captureStream: (fps?: number) => MediaStream;
      }
    ).captureStream = () =>
      ({
        getTracks: () => [],
        getVideoTracks: () => [],
        getAudioTracks: () => [],
      }) as unknown as MediaStream;

    const sourceStream = makeFakeMediaStream({ audio: false });
    expect(() =>
      createWatermarkedScreenShareTrack(sourceStream, () => null, 15),
    ).toThrow(/captureStream did not yield a video track/);

    // RAF was scheduled BEFORE the captureStream check; the failure
    // path must cancel it so the render loop does not outlive the
    // throw and keep ticking against a torn-down compositor.
    expect(raf.scheduledIds.size).toBeGreaterThanOrEqual(1);
    for (const id of raf.scheduledIds) {
      expect(raf.cancelledIds.has(id)).toBe(true);
    }
  });
});
