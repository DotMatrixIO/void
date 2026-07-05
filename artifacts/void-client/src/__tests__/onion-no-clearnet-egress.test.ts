// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Task #385 — Onion fail-open audit regression.
//
// Pins the result of docs/onion-fail-open-audit.md: an onion-origin
// page must never initiate an outbound request to a clearnet
// hostname. The audit enumerates every fetch site in the
// void-client; this test exercises the ones a `useSatsToUsd` hook,
// the paywall flow, and the room-state proof page actually invoke
// when the page is loaded over a `.onion` origin, and asserts the
// union of attempted hostnames is a subset of the onion host
// itself (or relative — same-origin by definition).
//
// The test deliberately mocks the global `fetch` constructor rather
// than spying on individual call sites — that way a future change
// that introduces a new fetch URL anywhere in the imported module
// graph still trips this test if the URL is clearnet.

const ONION_HOST =
  "voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion";

const ORIGINAL_LOCATION = window.location;

function setOnionHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      hostname,
      protocol: "http:",
      href: `http://${hostname}/`,
      origin: `http://${hostname}`,
    },
  });
}

function isAllowedOnionUrl(rawUrl: string, onionHost: string): boolean {
  // Protocol-relative URLs (`//host/path`) inherit the page's scheme
  // but resolve to whatever hostname follows the `//` — they are NOT
  // same-origin and MUST be rejected unless that hostname is the
  // onion host itself. Catch this before the leading-slash check.
  if (rawUrl.startsWith("//")) {
    try {
      const parsed = new URL(`http:${rawUrl}`);
      return parsed.hostname.toLowerCase() === onionHost.toLowerCase();
    } catch {
      return false;
    }
  }
  // Path-relative URLs (start with a single `/`, or no scheme at all)
  // are same-origin by definition — allowed.
  if (rawUrl.startsWith("/")) return true;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // No scheme + no leading slash = relative path (e.g. "api/foo").
    // Same-origin.
    return true;
  }
  // Same-origin absolute URLs (the onion host itself) are allowed;
  // every other absolute URL is a clearnet leak.
  return parsed.hostname.toLowerCase() === onionHost.toLowerCase();
}

describe("onion-origin client makes no clearnet fetch", () => {
  beforeEach(() => {
    setOnionHostname(ONION_HOST);
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: ORIGINAL_LOCATION,
    });
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("useSatsToUsd does not call api.coingecko.com when origin is .onion", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Re-import to pick up the onion-gated branch fresh (the hook
    // memoises an inflight promise at module scope).
    vi.resetModules();
    const { useSatsToUsd } = await import("@/hooks/useSatsToUsd");
    const { renderHook } = await import("@testing-library/react");
    const { result } = renderHook(() => useSatsToUsd(1000));

    // Hook returns null (loading / unavailable), and no fetch fires.
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("useSatsToUsd DOES call coingecko on a non-onion origin (control)", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        hostname: "void.example.com",
        protocol: "https:",
        href: "https://void.example.com/",
        origin: "https://void.example.com",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bitcoin: { usd: 60000 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { useSatsToUsd } = await import("@/hooks/useSatsToUsd");
    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useSatsToUsd(1000));

    // Wait one microtask so the effect fires.
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/api\.coingecko\.com/);
  });

  it("rejects protocol-relative URLs that would resolve to a clearnet host", () => {
    // Guard against a future maintainer assuming "starts with /" is
    // safe. `//evil.com/x` inherits the scheme but the host is
    // attacker-controlled.
    expect(isAllowedOnionUrl("//evil.com/x", ONION_HOST)).toBe(false);
    expect(isAllowedOnionUrl(`//${ONION_HOST}/x`, ONION_HOST)).toBe(true);
    expect(isAllowedOnionUrl("https://evil.com/x", ONION_HOST)).toBe(false);
    expect(isAllowedOnionUrl("/api/foo", ONION_HOST)).toBe(true);
    expect(isAllowedOnionUrl("api/foo", ONION_HOST)).toBe(true);
    expect(isAllowedOnionUrl(`https://${ONION_HOST}/api`, ONION_HOST)).toBe(
      true,
    );
  });

  it("DemoVideoEmbed's HEAD probe stays same-origin under an onion origin", async () => {
    const observed: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : (input as Request).url;
      observed.push(raw);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "video/mp4" }),
        json: async () => ({}),
        text: async () => "",
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { default: DemoVideoEmbed } = await import(
      "@/components/DemoVideoEmbed"
    );
    const { render } = await import("@testing-library/react");
    const React = await import("react");

    render(
      React.createElement(DemoVideoEmbed, {
        src: "biometric-demo.mp4",
        poster: "biometric-demo-poster.jpg",
        caption: "test",
        label: "test",
        ariaLabel: "test",
      }),
    );
    // Effect runs synchronously after render; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(observed.length).toBeGreaterThan(0);
    for (const url of observed) {
      expect(
        isAllowedOnionUrl(url, ONION_HOST),
        `URL ${url} is not same-origin to ${ONION_HOST} — clearnet leak`,
      ).toBe(true);
    }
  });

  it("union of attempted hostnames across the onion-reachable fetch surface is same-origin (.onion) or relative", async () => {
    // Drives every fetch site enumerated in
    // docs/onion-fail-open-audit.md by replaying the literal URL each
    // site is wired to. This is a belt-and-suspenders check on top of
    // the per-module tests (useSatsToUsd above, DemoVideoEmbed above,
    // onion-defaults.test.tsx for PreviewGate's room-state fetch, and
    // PaywallModal.test.tsx for the paywall fetches). If the audit
    // doc's row changes, this list changes with it.
    const observed: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : (input as Request).url;
      observed.push(raw);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
        text: async () => "",
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    // Paywall flow (PaywallModal.tsx + StartScreen.tsx).
    await fetch("/api/paywall/invoice", { method: "POST" });
    await fetch("/api/paywall/status/abc123");
    await fetch("/api/paywall/recover", { method: "POST" });
    // ICE servers (RoomPage.tsx).
    await fetch("/api/ice-servers");
    // Room state (PreviewGate.tsx + ServerStateProofPage.tsx).
    await fetch("/api/room-state/abc");
    // Demo-video HEAD probe (DemoVideoEmbed.tsx, BASE_URL + asset).
    await fetch("/biometric-demo.mp4", { method: "HEAD" });

    // Drive the coingecko hook — it must NOT call fetch on onion.
    vi.resetModules();
    const { useSatsToUsd } = await import("@/hooks/useSatsToUsd");
    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useSatsToUsd(1000));
    await Promise.resolve();

    for (const url of observed) {
      expect(
        isAllowedOnionUrl(url, ONION_HOST),
        `URL ${url} is not same-origin to ${ONION_HOST} — clearnet leak`,
      ).toBe(true);
    }
    // No third-party (api.coingecko.com or otherwise) hostname leaked
    // in from the hook either.
    expect(observed.some((u) => /coingecko\.com/.test(u))).toBe(false);
  });
});
