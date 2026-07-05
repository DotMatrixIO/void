// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import BuildProvenanceBadge, {
  formatRelativeTime,
} from "./BuildProvenanceBadge";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-05-20T12:00:00Z");

  it("returns seconds for sub-minute deltas", () => {
    expect(formatRelativeTime("2026-05-20T11:59:30Z", now)).toBe("30s ago");
  });

  it("returns minutes under an hour", () => {
    expect(formatRelativeTime("2026-05-20T11:45:00Z", now)).toBe("15m ago");
  });

  it("returns hours under a day", () => {
    expect(formatRelativeTime("2026-05-20T09:00:00Z", now)).toBe("3h ago");
  });

  it("returns days under a month", () => {
    expect(formatRelativeTime("2026-05-15T12:00:00Z", now)).toBe("5d ago");
  });

  it("returns months under a year", () => {
    expect(formatRelativeTime("2026-02-20T12:00:00Z", now)).toBe("3mo ago");
  });

  it("returns years for older builds", () => {
    expect(formatRelativeTime("2024-05-20T12:00:00Z", now)).toBe("2y ago");
  });

  it("returns null for unparseable input", () => {
    expect(formatRelativeTime("unknown", now)).toBeNull();
  });
});

describe("BuildProvenanceBadge", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-05-20T12:00:00Z"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("renders sha, relative time, and links to /proof/runtime", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        gitShaShort: "a1b2c3d",
        builtAt: "2026-05-20T09:00:00Z",
      }),
    }) as unknown as typeof fetch;

    render(<BuildProvenanceBadge />);

    const link = await screen.findByTestId("build-provenance-badge");
    expect(link.textContent).toContain("git a1b2c3d");
    expect(link.textContent).toContain("3h ago");
    expect(link.querySelector("a")?.getAttribute("href")).toBe(
      "/proof/runtime",
    );
  });

  it("renders nothing when /api/proof/build returns dev placeholder", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        gitShaShort: "unknown",
        builtAt: "unknown",
      }),
    }) as unknown as typeof fetch;

    const { container } = render(<BuildProvenanceBadge />);
    await waitFor(() => {
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBeGreaterThan(0);
    });
    expect(container.querySelector("[data-testid='build-provenance-badge']"))
      .toBeNull();
  });

  it("degrades silently when the request fails", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const { container } = render(<BuildProvenanceBadge />);
    await waitFor(() => {
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBeGreaterThan(0);
    });
    expect(container.querySelector("[data-testid='build-provenance-badge']"))
      .toBeNull();
  });

  it("degrades silently on non-2xx responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const { container } = render(<BuildProvenanceBadge />);
    await waitFor(() => {
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBeGreaterThan(0);
    });
    expect(container.querySelector("[data-testid='build-provenance-badge']"))
      .toBeNull();
  });

  // Task #428: stub both /api/proof/build and /api/proof/latest-release.
  function installRouter(
    build: Record<string, unknown>,
    release: Record<string, unknown> | { reject: true } | { status: number },
  ) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/proof/latest-release")) {
        if ("reject" in release) throw new Error("network down");
        if ("status" in release) {
          return { ok: false, status: release.status, json: async () => ({}) };
        }
        return { ok: true, json: async () => release };
      }
      return { ok: true, json: async () => build };
    }) as unknown as typeof fetch;
  }

  const RUNNING = {
    gitSha: "a".repeat(40),
    gitShaShort: "aaaaaaa",
    builtAt: "2026-05-20T09:00:00Z",
  };

  it("appends UPDATE AVAILABLE when running gitSha differs from latest release SHA", async () => {
    installRouter(RUNNING, { latestSha: "b".repeat(40) });

    render(<BuildProvenanceBadge />);

    const hint = await screen.findByTestId("update-available-hint");
    expect(hint.textContent).toBe("UPDATE AVAILABLE");
  });

  it("does not show the hint when running gitSha equals the latest release SHA", async () => {
    installRouter(RUNNING, { latestSha: "A".repeat(40) }); // case-insensitive

    render(<BuildProvenanceBadge />);

    const badge = await screen.findByTestId("build-provenance-badge");
    expect(badge.textContent).toContain("git aaaaaaa");
    expect(screen.queryByTestId("update-available-hint")).toBeNull();
  });

  it("does not show the hint when the release check degrades (rejects)", async () => {
    installRouter(RUNNING, { reject: true });

    render(<BuildProvenanceBadge />);

    const badge = await screen.findByTestId("build-provenance-badge");
    expect(badge.textContent).toContain("git aaaaaaa");
    expect(screen.queryByTestId("update-available-hint")).toBeNull();
  });

  it("does not show the hint when the release SHA is unresolved (null)", async () => {
    installRouter(RUNNING, { latestSha: null });

    render(<BuildProvenanceBadge />);

    const badge = await screen.findByTestId("build-provenance-badge");
    expect(badge.textContent).toContain("git aaaaaaa");
    expect(screen.queryByTestId("update-available-hint")).toBeNull();
  });

  // Task #942: the hint links to the release page when htmlUrl is present.
  it("links UPDATE AVAILABLE to the release page (new tab) when htmlUrl is present", async () => {
    installRouter(RUNNING, {
      latestSha: "b".repeat(40),
      htmlUrl: "https://example.invalid/releases/v9.9.9",
    });

    render(<BuildProvenanceBadge />);

    const hint = await screen.findByTestId("update-available-hint");
    expect(hint.tagName).toBe("A");
    expect(hint.getAttribute("href")).toBe(
      "https://example.invalid/releases/v9.9.9",
    );
    expect(hint.getAttribute("target")).toBe("_blank");
    expect(hint.getAttribute("rel")).toContain("noopener");
  });

  it("keeps UPDATE AVAILABLE as a plain span when htmlUrl is absent (no broken link)", async () => {
    installRouter(RUNNING, { latestSha: "b".repeat(40) });

    render(<BuildProvenanceBadge />);

    const hint = await screen.findByTestId("update-available-hint");
    expect(hint.tagName).toBe("SPAN");
    expect(hint.getAttribute("href")).toBeNull();
  });

  it("does not render a javascript: htmlUrl as a link", async () => {
    installRouter(RUNNING, {
      latestSha: "b".repeat(40),
      // eslint-disable-next-line no-script-url
      htmlUrl: "javascript:alert(1)",
    });

    render(<BuildProvenanceBadge />);

    const hint = await screen.findByTestId("update-available-hint");
    expect(hint.tagName).toBe("SPAN");
  });
});
