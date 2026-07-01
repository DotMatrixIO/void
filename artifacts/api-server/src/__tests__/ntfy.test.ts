// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { publishNtfy, isNtfyConfigured, __testing } from "../lib/ntfy";

// Task #274 — the shared ntfy operator-alert publisher.
//
// The contract this guards:
//   1. Silent no-op when NTFY_TOPIC is unset — returns false, sends nothing,
//      never throws. Alerting must never be on a hot path that can break a
//      request.
//   2. Posts to `${server}/${topic}` with the title/priority/tags headers and
//      the message as the body; default server is https://ntfy.sh.
//   3. Per-key dedupe — a repeat with the same dedupeKey inside the window is
//      dropped, but a different key still sends.
//   4. Bearer auth only when NTFY_TOKEN is set.
//   5. Transport failures (reject or non-OK status) are swallowed → false.

function okResponse(): Response {
  return new Response(null, { status: 200 });
}

describe("publishNtfy", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __testing.resetDedupe();
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    // Start each test from a known-clean env.
    vi.stubEnv("NTFY_TOPIC", "");
    vi.stubEnv("NTFY_SERVER", "");
    vi.stubEnv("NTFY_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is a silent no-op when NTFY_TOPIC is unset", async () => {
    const sent = await publishNtfy({
      title: "VOID: test",
      message: "body",
      dedupeKey: "k",
    });
    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isNtfyConfigured()).toBe(false);
  });

  it("posts to the default server with title/priority/tags headers and message body", async () => {
    vi.stubEnv("NTFY_TOPIC", "void-alerts-abc");
    const sent = await publishNtfy({
      title: "VOID: Lightning response shape drift",
      message: "btcpay invoice missing field: paymentRequest",
      priority: "high",
      tags: ["warning", "zap"],
      dedupeKey: "lightning-shape:btcpay:paymentRequest",
    });
    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ntfy.sh/void-alerts-abc");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("btcpay invoice missing field: paymentRequest");
    expect(init.headers.Title).toBe("VOID: Lightning response shape drift");
    expect(init.headers.Priority).toBe("high");
    expect(init.headers.Tags).toBe("warning,zap");
    expect(init.headers.Authorization).toBeUndefined();
    expect(isNtfyConfigured()).toBe(true);
  });

  it("uses NTFY_SERVER (trimmed of trailing slash) when set", async () => {
    vi.stubEnv("NTFY_TOPIC", "topic");
    vi.stubEnv("NTFY_SERVER", "https://ntfy.example.org/");
    await publishNtfy({ title: "t", message: "m", dedupeKey: "k" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://ntfy.example.org/topic");
  });

  it("sends a Bearer Authorization header only when NTFY_TOKEN is set", async () => {
    vi.stubEnv("NTFY_TOPIC", "topic");
    vi.stubEnv("NTFY_TOKEN", "tk_secret");
    await publishNtfy({ title: "t", message: "m", dedupeKey: "k" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tk_secret");
  });

  it("defaults priority to 'default' and omits Tags when none given", async () => {
    vi.stubEnv("NTFY_TOPIC", "topic");
    await publishNtfy({ title: "t", message: "m", dedupeKey: "k" });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Priority).toBe("default");
    expect(headers.Tags).toBeUndefined();
  });

  it("dedupes a repeat with the same key inside the window, but allows a different key", async () => {
    vi.stubEnv("NTFY_TOPIC", "topic");
    const first = await publishNtfy({ title: "t", message: "m", dedupeKey: "same" });
    const second = await publishNtfy({ title: "t", message: "m", dedupeKey: "same" });
    const other = await publishNtfy({ title: "t", message: "m", dedupeKey: "other" });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(other).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-sends the same key after the dedupe window elapses", async () => {
    vi.stubEnv("NTFY_TOPIC", "topic");
    const first = await publishNtfy({
      title: "t",
      message: "m",
      dedupeKey: "k",
      dedupeWindowMs: 1,
    });
    expect(first).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    const second = await publishNtfy({
      title: "t",
      message: "m",
      dedupeKey: "k",
      dedupeWindowMs: 1,
    });
    expect(second).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("swallows a rejected fetch and returns false", async () => {
    vi.stubEnv("NTFY_TOPIC", "topic");
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const sent = await publishNtfy({ title: "t", message: "m", dedupeKey: "k" });
    expect(sent).toBe(false);
  });

  it("swallows a non-OK status and returns false", async () => {
    vi.stubEnv("NTFY_TOPIC", "topic");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const sent = await publishNtfy({ title: "t", message: "m", dedupeKey: "k" });
    expect(sent).toBe(false);
  });
});
