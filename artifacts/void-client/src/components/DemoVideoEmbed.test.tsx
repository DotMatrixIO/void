// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DemoVideoEmbed from "./DemoVideoEmbed";

// DemoVideoEmbed has three states driven by a single HEAD request:
//   1. "checking" (initial) — render the placeholder while we wait.
//   2. "available"          — HEAD returned 2xx with Content-Type starting
//                              with "video/". Render a real <video> player.
//   3. "missing"            — HEAD returned a non-video Content-Type
//                              (e.g. Vite's SPA fallback returns 200 with
//                              text/html for any unmatched route), or the
//                              fetch rejected outright. Render the
//                              "Recording in production" placeholder card.
//
// The Content-Type sniffing is the load-bearing part: without it, a naive
// `res.ok` check would treat Vite's HTML fallback as a valid video and ship
// broken <video> controls on the landing page in dev. These tests pin that
// behavior so a future refactor can't silently regress it.

const PROPS = {
  src: "demo.mp4",
  poster: "demo-poster.jpg",
  caption: "DEMO CAPTION TEXT",
  label: "DEMO LABEL",
  ariaLabel: "Demo video aria label",
};

function mockHeadResponse(contentType: string, ok = true): Response {
  return {
    ok,
    headers: new Headers({ "content-type": contentType }),
  } as Response;
}

describe("DemoVideoEmbed", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("renders the placeholder immediately (checking state) before the HEAD response arrives", () => {
    // fetch returns a promise that never resolves so the component stays in
    // its initial "checking" state for the duration of this synchronous
    // assertion. The placeholder is the correct UI for this transient state
    // because we don't yet know whether the file exists.
    fetchSpy.mockReturnValueOnce(new Promise(() => {}));

    const { container } = render(<DemoVideoEmbed {...PROPS} />);

    expect(screen.getByText("Recording in production")).toBeInTheDocument();
    expect(container.querySelector("video")).not.toBeInTheDocument();
  });

  it("renders the placeholder with the 'Recording in production' badge when the HEAD response is a non-video Content-Type (Vite SPA fallback)", async () => {
    // Vite's dev server falls back to index.html for any path that isn't a
    // real asset, so a missing /demo.mp4 returns 200 + text/html. Without
    // the Content-Type guard we'd treat that as a valid video.
    fetchSpy.mockResolvedValueOnce(mockHeadResponse("text/html; charset=utf-8"));

    const { container } = render(<DemoVideoEmbed {...PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Recording in production")).toBeInTheDocument();
    });
    expect(container.querySelector("video")).not.toBeInTheDocument();
  });

  it("renders the <video> element with a <source> when the HEAD response Content-Type starts with 'video/'", async () => {
    fetchSpy.mockResolvedValueOnce(mockHeadResponse("video/mp4"));

    const { container } = render(<DemoVideoEmbed {...PROPS} />);

    await waitFor(() => {
      expect(container.querySelector("video")).toBeInTheDocument();
    });

    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("aria-label", PROPS.ariaLabel);
    const source = video.querySelector("source");
    expect(source).not.toBeNull();
    expect(source).toHaveAttribute("type", "video/mp4");
    expect(source!.getAttribute("src")).toContain(PROPS.src);

    expect(
      screen.queryByText("Recording in production"),
    ).not.toBeInTheDocument();
  });

  it("renders the placeholder when the HEAD fetch rejects (network error)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));

    const { container } = render(<DemoVideoEmbed {...PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Recording in production")).toBeInTheDocument();
    });
    expect(container.querySelector("video")).not.toBeInTheDocument();
  });

  it("renders the caption in both the available and missing states", async () => {
    // Missing branch (SPA fallback).
    fetchSpy.mockResolvedValueOnce(mockHeadResponse("text/html"));
    const { unmount } = render(<DemoVideoEmbed {...PROPS} />);
    await waitFor(() => {
      expect(screen.getByText("Recording in production")).toBeInTheDocument();
    });
    expect(screen.getByText(PROPS.caption)).toBeInTheDocument();
    unmount();

    // Available branch.
    fetchSpy.mockResolvedValueOnce(mockHeadResponse("video/mp4"));
    const { container } = render(<DemoVideoEmbed {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector("video")).toBeInTheDocument();
    });
    expect(screen.getByText(PROPS.caption)).toBeInTheDocument();
  });
});
