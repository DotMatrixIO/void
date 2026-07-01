// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  probeWebRtcCapability,
  DEFAULT_PROBE_TIMEOUT_MS,
} from "./browserCapability";

afterEach(() => {
  vi.useRealTimers();
});

// Minimal fake PC: lets us drive onicecandidate from the test body.
function makeFakePC(opts: { failConstruct?: boolean } = {}) {
  if (opts.failConstruct) {
    return class {
      constructor() {
        throw new Error("construction blocked");
      }
    } as unknown as typeof RTCPeerConnection;
  }
  class FakePC {
    onicecandidate: ((ev: { candidate: unknown }) => void) | null = null;
    createDataChannel(_label: string) {
      return { label: _label } as unknown as RTCDataChannel;
    }
    async createOffer() {
      return { type: "offer", sdp: "" } as RTCSessionDescriptionInit;
    }
    async setLocalDescription(_desc: RTCSessionDescriptionInit) {
      // no-op for the probe; ICE gathering is driven by the test.
    }
    close() {
      // no-op
    }
  }
  return FakePC as unknown as typeof RTCPeerConnection;
}

describe("probeWebRtcCapability", () => {
  it("returns 'no-rtc' when RTCPeerConnection isn't available", async () => {
    // Cast a constructor-less impl to the type so we can assert
    // the runtime branch returns no-rtc.
    const result = await probeWebRtcCapability({
      RTCPeerConnectionImpl: undefined as unknown as typeof RTCPeerConnection,
    });
    expect(result.status).toBe("no-rtc");
  });

  it("returns 'error' when constructing RTCPeerConnection throws", async () => {
    const result = await probeWebRtcCapability({
      RTCPeerConnectionImpl: makeFakePC({ failConstruct: true }),
    });
    expect(result.status).toBe("error");
  });

  it("resolves to 'ok' as soon as an srflx candidate arrives", async () => {
    const FakePC = makeFakePC();
    const pcInstances: Array<{
      onicecandidate: ((ev: { candidate: unknown }) => void) | null;
    }> = [];
    const Tracked = class extends (FakePC as unknown as { new (): object }) {
      constructor() {
        super();
        pcInstances.push(this as unknown as { onicecandidate: ((ev: { candidate: unknown }) => void) | null });
      }
    } as unknown as typeof RTCPeerConnection;

    const promise = probeWebRtcCapability({
      RTCPeerConnectionImpl: Tracked,
      timeoutMs: 2000,
    });
    // Let the constructor + setLocalDescription microtasks drain.
    await new Promise((r) => setTimeout(r, 0));
    expect(pcInstances).toHaveLength(1);
    pcInstances[0].onicecandidate?.({
      candidate: { type: "srflx", candidate: "candidate:... typ srflx ..." },
    });
    const result = await promise;
    expect(result.status).toBe("ok");
    expect(result.candidates.srflx).toBe(1);
  });

  it("resolves to 'blocked' when end-of-gathering arrives with no usable candidates", async () => {
    const FakePC = makeFakePC();
    const pcInstances: Array<{
      onicecandidate: ((ev: { candidate: unknown }) => void) | null;
    }> = [];
    const Tracked = class extends (FakePC as unknown as { new (): object }) {
      constructor() {
        super();
        pcInstances.push(this as unknown as { onicecandidate: ((ev: { candidate: unknown }) => void) | null });
      }
    } as unknown as typeof RTCPeerConnection;

    const promise = probeWebRtcCapability({
      RTCPeerConnectionImpl: Tracked,
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 0));
    pcInstances[0].onicecandidate?.({ candidate: null });
    const result = await promise;
    expect(result.status).toBe("blocked");
    expect(result.candidates.srflx).toBe(0);
    expect(result.candidates.host).toBe(0);
  });

  it("treats a host-only outcome as 'ok' (browser can gather, even if no NAT traversal)", async () => {
    const FakePC = makeFakePC();
    const pcInstances: Array<{
      onicecandidate: ((ev: { candidate: unknown }) => void) | null;
    }> = [];
    const Tracked = class extends (FakePC as unknown as { new (): object }) {
      constructor() {
        super();
        pcInstances.push(this as unknown as { onicecandidate: ((ev: { candidate: unknown }) => void) | null });
      }
    } as unknown as typeof RTCPeerConnection;

    const promise = probeWebRtcCapability({
      RTCPeerConnectionImpl: Tracked,
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 0));
    pcInstances[0].onicecandidate?.({
      candidate: { type: "host", candidate: "candidate:... typ host ..." },
    });
    pcInstances[0].onicecandidate?.({ candidate: null });
    const result = await promise;
    expect(result.status).toBe("ok");
    expect(result.candidates.host).toBe(1);
  });

  it("respects the timeoutMs budget", async () => {
    const FakePC = makeFakePC();
    // Don't emit any candidates — let the timer fire.
    const result = await probeWebRtcCapability({
      RTCPeerConnectionImpl: FakePC,
      timeoutMs: 50,
    });
    expect(result.status).toBe("blocked");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(40);
  });

  it("DEFAULT_PROBE_TIMEOUT_MS stays bounded for the happy path", () => {
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });
});
