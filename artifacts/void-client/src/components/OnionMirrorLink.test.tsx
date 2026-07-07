// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  ONION_BACKGROUND_REPROBE_THRESHOLD_MS,
  ONION_REACHABILITY_CACHE_KEY,
} from "@/lib/onionReachability";
import OnionMirrorLink from "./OnionMirrorLink";

const ONION_URL = "http://voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion/";

beforeEach(() => {
  sessionStorage.clear();
  vi.stubEnv("VITE_VOID_ONION_HOST", ONION_URL);
  // jsdom defaults `location.hostname` to "localhost" — i.e. clearnet,
  // which is what `OnionMirrorLink` checks for via `isOnionOrigin()`.
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OnionMirrorLink reachability hint (Task #389)", () => {
  it("does not render a hint when the cached reachability is 'reachable'", () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "reachable");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    render(<OnionMirrorLink />);
    expect(screen.getByTestId("onion-mirror-link")).toBeInTheDocument();
    expect(screen.queryByTestId("onion-mirror-hint")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the 'requires Tor Browser' hint when the probe rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("net"));
    render(<OnionMirrorLink />);
    const hint = await screen.findByTestId("onion-mirror-hint");
    expect(hint).toHaveTextContent(/requires tor browser/i);
  });

  it("omits the hint when the probe resolves (network can reach .onion)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    render(<OnionMirrorLink />);
    await waitFor(() => {
      expect(sessionStorage.getItem(ONION_REACHABILITY_CACHE_KEY)).toBe("reachable");
    });
    expect(screen.queryByTestId("onion-mirror-hint")).not.toBeInTheDocument();
    // Link itself still renders — degrades to current behaviour.
    expect(screen.getByTestId("onion-mirror-link")).toBeInTheDocument();
  });

  it("does not render anything when the onion env var is unset", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", "");
    const { container } = render(<OnionMirrorLink />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("OnionMirrorLink explicit clearnet state + bootstrap honesty (Task #1022)", () => {
  it("names the current path and discloses the bootstrap clearnet exposure", () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "reachable");
    render(<OnionMirrorLink />);
    // Clearnet is an explicit, named state — not an invisible default.
    expect(screen.getByTestId("onion-mirror-clearnet-state")).toHaveTextContent(
      /you are on the clearnet path/i,
    );
    // Bootstrap honesty: this very visit already touched the public internet,
    // and switching only moves the signaling layer — not the call's media IP.
    const note = screen.getByTestId("onion-mirror-bootstrap-note");
    expect(note).toHaveTextContent(/already reached us over the public internet/i);
    expect(note).toHaveTextContent(/does not hide your IP/i);
    // The one-click switch (the .onion link itself) is still present.
    expect(screen.getByTestId("onion-mirror-link")).toBeInTheDocument();
  });

  it("renders neither the clearnet state nor the bootstrap note when no onion is configured", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", "");
    render(<OnionMirrorLink />);
    expect(screen.queryByTestId("onion-mirror-clearnet-state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("onion-mirror-bootstrap-note")).not.toBeInTheDocument();
  });
});

describe("OnionMirrorLink explainer deep link (Task #1039)", () => {
  it("deep-links the switch to the .onion-path docs subsection via in-app routing", () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "reachable");
    render(<OnionMirrorLink />);
    const link = screen.getByTestId("onion-mirror-explainer-link");
    // wouter Link renders an <a>; the hash targets the docs subsection.
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toContain(
      "/docs/threat-model#how-void-surfaces-the-onion-path",
    );
    expect(link).toHaveTextContent(/how void surfaces the .onion path/i);
  });

  it("does not render the explainer link when no onion is configured", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", "");
    render(<OnionMirrorLink />);
    expect(
      screen.queryByTestId("onion-mirror-explainer-link"),
    ).not.toBeInTheDocument();
  });
});

describe("OnionMirrorLink on-pavement ink (Task #1112)", () => {
  it("keeps the light-background dark-ink tokens by default", () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "reachable");
    render(<OnionMirrorLink />);
    expect(screen.getByTestId("onion-mirror-clearnet-state")).toHaveStyle({
      color: "var(--fg-dim)",
    });
    expect(screen.getByTestId("onion-mirror-bootstrap-note")).toHaveStyle({
      color: "var(--fg-dim)",
    });
    expect(screen.getByTestId("onion-mirror-copy")).toHaveStyle({
      color: "var(--fg)",
    });
    expect(screen.getByTestId("onion-mirror-explainer-link")).toHaveStyle({
      color: "var(--fg)",
    });
  });

  it("swaps to the audited dark-surface palette when onPavement is set", async () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "unreachable");
    render(<OnionMirrorLink onPavement />);
    // Dim captions → #A89E90 (headerBtn/headerBg, 7.13:1 on #14110D).
    expect(screen.getByTestId("onion-mirror-clearnet-state")).toHaveStyle({
      color: "#A89E90",
    });
    expect(screen.getByTestId("onion-mirror-bootstrap-note")).toHaveStyle({
      color: "#A89E90",
    });
    expect(screen.getByTestId("onion-mirror-hint")).toHaveStyle({
      color: "#A89E90",
    });
    // Primary text → --fg-on-dark (fgOnDark/surfaceDark, ~16.6:1).
    const url = screen.getByRole("link", { name: ONION_URL });
    expect(url).toHaveStyle({ color: "var(--fg-on-dark)" });
    expect(screen.getByTestId("onion-mirror-copy")).toHaveStyle({
      color: "var(--fg-on-dark)",
    });
    expect(screen.getByTestId("onion-mirror-explainer-link")).toHaveStyle({
      color: "var(--fg-on-dark)",
    });
  });
});

describe("OnionMirrorLink re-probe on connectivity recovery (Task #426)", () => {
  it("clears the cache and re-probes when the browser fires 'online'", async () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "unreachable");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(<OnionMirrorLink />);
    // Stale cached "unreachable" → hint visible on first render.
    expect(screen.getByTestId("onion-mirror-hint")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(sessionStorage.getItem(ONION_REACHABILITY_CACHE_KEY)).toBe("reachable");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("onion-mirror-hint")).not.toBeInTheDocument();
  });

  it("re-probes when the tab returns to foreground after a long background period", async () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "unreachable");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const nowSpy = vi.spyOn(Date, "now");
    let t = 1_000_000;
    nowSpy.mockImplementation(() => t);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    let visibility: DocumentVisibilityState = "visible";

    render(<OnionMirrorLink />);
    expect(screen.getByTestId("onion-mirror-hint")).toBeInTheDocument();

    // Tab goes hidden.
    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // ...returns later, well past the threshold.
    t += ONION_BACKGROUND_REPROBE_THRESHOLD_MS + 1;
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(sessionStorage.getItem(ONION_REACHABILITY_CACHE_KEY)).toBe("reachable");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("onion-mirror-hint")).not.toBeInTheDocument();
  });

  it("does NOT re-probe on a quick alt-tab (under the background threshold)", async () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "unreachable");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const nowSpy = vi.spyOn(Date, "now");
    let t = 2_000_000;
    nowSpy.mockImplementation(() => t);

    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });

    render(<OnionMirrorLink />);
    expect(screen.getByTestId("onion-mirror-hint")).toBeInTheDocument();

    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Comes back almost immediately.
    t += 500;
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Cache untouched, no re-probe, hint still showing.
    expect(sessionStorage.getItem(ONION_REACHABILITY_CACHE_KEY)).toBe("unreachable");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("onion-mirror-hint")).toBeInTheDocument();
  });

  it("re-probes at most once per online transition (no probe storm)", async () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "unreachable");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("net"));

    render(<OnionMirrorLink />);
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(sessionStorage.getItem(ONION_REACHABILITY_CACHE_KEY)).toBe("unreachable");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A second 'online' without any new state change re-invalidates and
    // re-probes exactly once more — not a storm of N events → N probes
    // per render.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
