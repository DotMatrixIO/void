// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { webcrypto, createHash } from "node:crypto";
import RuntimeProofPage from "@/pages/RuntimeProofPage";

// Task #388: end-to-end coverage for /proof/runtime.
//
// Boots RuntimeProofPage against a stubbed fetch (for /api/proof/build
// and the asset URLs) and a real Web Crypto SubtleCrypto from Node, with
// a tiny set of <script>/<link> tags injected into the document so
// discoverLoadedAssetUrls() finds them. One assertion proves the all-
// match state. A second flips one published hash and proves the row
// renders the MISMATCH label with both hashes shown, and the summary
// switches to the red/mismatch color.

const JS_URL = "/assets/index-test.js";
const CSS_URL = "/assets/style-test.css";
const JS_BYTES = new TextEncoder().encode("export const x = 1;\n");
const CSS_BYTES = new TextEncoder().encode("body{color:#000}\n");

function hexSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

const JS_HASH = hexSha256(JS_BYTES);
const CSS_HASH = hexSha256(CSS_BYTES);

function makeBuildResponse(sums: Record<string, string>) {
  return {
    schemaVersion: 1,
    gitSha: "0".repeat(40),
    gitShaShort: "0000000",
    builtAt: "2026-01-01T00:00:00Z",
    releaseTag: null,
    nodeVersion: "v20.0.0",
    clientDist: "artifacts/void-client/dist/public",
    sha256sums: sums,
    caveat: "test fixture",
  };
}

function bytesResponse(bytes: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  // A non-OK asset re-fetch: the page should classify this as
  // fetch-error without ever reading the body.
  return {
    ok: false,
    status,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function installAssetTags() {
  const script = document.createElement("script");
  script.setAttribute("src", JS_URL);
  document.head.appendChild(script);
  const link = document.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", CSS_URL);
  document.head.appendChild(link);
  return () => {
    script.remove();
    link.remove();
  };
}

function disabledReleaseResponse() {
  return {
    schemaVersion: 1,
    latestTag: null,
    latestSha: null,
    htmlUrl: null,
    checkedAt: "2026-01-01T00:00:00Z",
    source: "disabled",
    caveat: "test fixture",
  };
}

function installFetch(
  published: Record<string, string>,
  release: unknown = disabledReleaseResponse(),
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/proof/latest-release")) {
      return jsonResponse(release);
    }
    if (url.endsWith("/api/proof/build")) {
      return jsonResponse(makeBuildResponse(published));
    }
    if (url.endsWith(JS_URL)) return bytesResponse(JS_BYTES);
    if (url.endsWith(CSS_URL)) return bytesResponse(CSS_BYTES);
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("RuntimeProofPage — /proof/runtime hash-check flow (task #388)", () => {
  let removeTags: () => void;

  beforeEach(() => {
    // The component reads crypto.subtle.digest. jsdom does not ship a
    // WebCrypto implementation by default, so we wire in Node's real
    // SubtleCrypto. Using a real digest (not a stub) is intentional:
    // the assertion that JS_HASH/CSS_HASH match what the page computed
    // proves the page is hashing the actual bytes fetched, not just
    // echoing the published map.
    vi.stubGlobal("crypto", webcrypto);
    removeTags = installAssetTags();
  });

  afterEach(() => {
    removeTags();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders all rows in MATCH state when computed hashes equal the published map", async () => {
    installFetch({
      "assets/index-test.js": JS_HASH,
      "assets/style-test.css": CSS_HASH,
    });

    render(<RuntimeProofPage />);

    // Wait for /api/proof/build to land — the button is disabled until
    // buildInfo is set.
    const runBtn = await screen.findByTestId("run-hash-check");
    await waitFor(() => expect(runBtn).not.toBeDisabled());

    await act(async () => {
      fireEvent.click(runBtn);
    });

    await waitFor(() => {
      const summary = screen.getByTestId("hash-check-summary");
      expect(summary.textContent).toMatch(/2 match/);
    });

    const summary = screen.getByTestId("hash-check-summary");
    expect(summary.textContent).toMatch(/0 mismatch/);
    expect(summary.getAttribute("style") ?? "").toContain("var(--teal)");

    const matchRows = screen.getAllByTestId("hash-row-match");
    expect(matchRows).toHaveLength(2);
    expect(matchRows.some((r) => r.textContent?.includes(JS_HASH))).toBe(true);
    expect(matchRows.some((r) => r.textContent?.includes(CSS_HASH))).toBe(true);
    expect(screen.queryByTestId("hash-row-mismatch")).toBeNull();
  });

  it("renders a MISMATCH row in red with both published and computed hashes when one published hash is tampered", async () => {
    // Flip the JS published hash to a value that cannot match the
    // computed digest of JS_BYTES. The CSS hash stays correct so we
    // also prove the page reports per-row, not all-or-nothing.
    const TAMPERED_JS_HASH = "f".repeat(64);
    installFetch({
      "assets/index-test.js": TAMPERED_JS_HASH,
      "assets/style-test.css": CSS_HASH,
    });

    render(<RuntimeProofPage />);

    const runBtn = await screen.findByTestId("run-hash-check");
    await waitFor(() => expect(runBtn).not.toBeDisabled());

    await act(async () => {
      fireEvent.click(runBtn);
    });

    const mismatchRow = await screen.findByTestId("hash-row-mismatch");
    expect(mismatchRow.textContent).toMatch(/MISMATCH/);
    // Both hashes must be visible — the whole point of the mismatch row
    // is so the user can see which side disagrees.
    expect(mismatchRow.textContent).toContain(TAMPERED_JS_HASH);
    expect(mismatchRow.textContent).toContain(JS_HASH);
    // Red border on the mismatch row.
    expect(mismatchRow.getAttribute("style") ?? "").toContain("var(--red)");

    // Summary flips to red when there is at least one mismatch.
    const summary = screen.getByTestId("hash-check-summary");
    expect(summary.textContent).toMatch(/1 match/);
    expect(summary.textContent).toMatch(/1 mismatch/);
    expect(summary.getAttribute("style") ?? "").toContain("var(--red)");

    // The unrelated CSS row still reports match — per-row reporting.
    const matchRow = screen.getByTestId("hash-row-match");
    expect(matchRow.textContent).toContain(CSS_HASH);
  });

  it("renders a NOT IN PUBLISHED LIST row in gold when the loaded asset's key is absent from the published sums", async () => {
    // Publish only the CSS hash. The browser still loaded the JS chunk
    // (its <script> tag is injected), but its key
    // "assets/index-test.js" is not in sha256sums, so the page must
    // flag it as missing-published rather than silently dropping it —
    // this is the "browser ran a chunk the published manifest never
    // listed" case.
    installFetch({
      "assets/style-test.css": CSS_HASH,
    });

    render(<RuntimeProofPage />);

    const runBtn = await screen.findByTestId("run-hash-check");
    await waitFor(() => expect(runBtn).not.toBeDisabled());

    await act(async () => {
      fireEvent.click(runBtn);
    });

    const missingRow = await screen.findByTestId("hash-row-missing-published");
    expect(missingRow.textContent).toMatch(/NOT IN PUBLISHED LIST/);
    // The computed hash is still shown so the user can record what ran.
    expect(missingRow.textContent).toContain(JS_HASH);
    // Gold left border on the missing-published row.
    expect(missingRow.getAttribute("style") ?? "").toContain("var(--gold)");

    // Summary counts the missing row, and stays teal (no mismatch).
    const summary = screen.getByTestId("hash-check-summary");
    expect(summary.textContent).toMatch(/1 not in published list/);
    expect(summary.textContent).toMatch(/0 mismatch/);

    // The CSS row still reports match — per-row reporting.
    const matchRow = screen.getByTestId("hash-row-match");
    expect(matchRow.textContent).toContain(CSS_HASH);
  });

  it("renders FETCH ERROR rows in burnt when the asset re-fetch returns non-OK or throws", async () => {
    // Both published hashes are correct, but the re-fetch fails: the JS
    // asset returns HTTP 500 and the CSS asset throws outright. Neither
    // can be hashed, so both must surface as fetch-error rows — a
    // refactor that swallowed the non-OK branch or the catch would flip
    // these to a misleading state.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/proof/build")) {
        return jsonResponse(
          makeBuildResponse({
            "assets/index-test.js": JS_HASH,
            "assets/style-test.css": CSS_HASH,
          }),
        );
      }
      if (url.endsWith(JS_URL)) return errorResponse(500);
      if (url.endsWith(CSS_URL)) throw new Error("network down");
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RuntimeProofPage />);

    const runBtn = await screen.findByTestId("run-hash-check");
    await waitFor(() => expect(runBtn).not.toBeDisabled());

    await act(async () => {
      fireEvent.click(runBtn);
    });

    await waitFor(() => {
      const summary = screen.getByTestId("hash-check-summary");
      expect(summary.textContent).toMatch(/2 fetch error/);
    });

    const errorRows = screen.getAllByTestId("hash-row-fetch-error");
    expect(errorRows).toHaveLength(2);
    // The non-OK fetch reports its HTTP status; the thrown fetch reports
    // the error message.
    expect(errorRows.some((r) => r.textContent?.includes("HTTP 500"))).toBe(
      true,
    );
    expect(errorRows.some((r) => r.textContent?.includes("network down"))).toBe(
      true,
    );
    // Burnt left border on every fetch-error row.
    errorRows.forEach((r) => {
      expect(r.getAttribute("style") ?? "").toContain("var(--burnt)");
    });

    // No row was hashable, so there are no match or mismatch rows.
    expect(screen.queryByTestId("hash-row-match")).toBeNull();
    expect(screen.queryByTestId("hash-row-mismatch")).toBeNull();
  });

  it("surfaces UPDATE AVAILABLE when the running gitSha differs from the latest release SHA (task #428)", async () => {
    installFetch(
      { "assets/index-test.js": JS_HASH },
      {
        schemaVersion: 1,
        latestTag: "v9.9.9",
        // makeBuildResponse uses gitSha "0"*40 — use a different valid SHA.
        latestSha: "a".repeat(40),
        htmlUrl: "https://example.invalid/releases/v9.9.9",
        checkedAt: "2026-01-01T00:00:00Z",
        source: "github",
        caveat: "test fixture",
      },
    );

    render(<RuntimeProofPage />);

    const status = await screen.findByTestId("release-status");
    await waitFor(() =>
      expect(status.textContent).toMatch(/UPDATE AVAILABLE/),
    );
    expect(status.textContent).toContain("v9.9.9");
    expect(status.getAttribute("style") ?? "").toContain("var(--gold)");
  });

  it("links 'See what changed' to the release page when htmlUrl is present (task #942)", async () => {
    installFetch(
      { "assets/index-test.js": JS_HASH },
      {
        schemaVersion: 1,
        latestTag: "v9.9.9",
        latestSha: "a".repeat(40),
        htmlUrl: "https://example.invalid/releases/v9.9.9",
        checkedAt: "2026-01-01T00:00:00Z",
        source: "github",
        caveat: "test fixture",
      },
    );

    render(<RuntimeProofPage />);

    const link = await screen.findByTestId("release-notes-link");
    expect(link.getAttribute("href")).toBe(
      "https://example.invalid/releases/v9.9.9",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders no release-notes link when htmlUrl is absent (task #942)", async () => {
    installFetch(
      { "assets/index-test.js": JS_HASH },
      {
        schemaVersion: 1,
        latestTag: "v9.9.9",
        latestSha: "a".repeat(40),
        htmlUrl: null,
        checkedAt: "2026-01-01T00:00:00Z",
        source: "github",
        caveat: "test fixture",
      },
    );

    render(<RuntimeProofPage />);

    const status = await screen.findByTestId("release-status");
    await waitFor(() => expect(status.textContent).toMatch(/UPDATE AVAILABLE/));
    expect(screen.queryByTestId("release-notes-link")).toBeNull();
  });

  it("reports up to date when the running gitSha matches the latest release SHA (task #428)", async () => {
    installFetch(
      { "assets/index-test.js": JS_HASH },
      {
        schemaVersion: 1,
        latestTag: "v1.0.0",
        latestSha: "0".repeat(40), // equals makeBuildResponse gitSha
        htmlUrl: null,
        checkedAt: "2026-01-01T00:00:00Z",
        source: "github",
        caveat: "test fixture",
      },
    );

    render(<RuntimeProofPage />);

    const status = await screen.findByTestId("release-status");
    await waitFor(() => expect(status.textContent).toMatch(/up to date/));
    expect(status.textContent).not.toMatch(/UPDATE AVAILABLE/);
    expect(status.getAttribute("style") ?? "").toContain("var(--teal)");
  });

  it("degrades to a no-comparison message when the release check is disabled (task #428)", async () => {
    // Default release fixture is source:"disabled".
    installFetch({ "assets/index-test.js": JS_HASH });

    render(<RuntimeProofPage />);

    const status = await screen.findByTestId("release-status");
    await waitFor(() => expect(status.textContent).toMatch(/disabled/));
    expect(status.textContent).not.toMatch(/UPDATE AVAILABLE/);
  });

  it("deep-links the posture block to the verify-the-posture docs subsection (task #1039)", async () => {
    const posture = {
      schemaVersion: 1,
      gitSha: "0".repeat(40),
      gitShaShort: "0000000",
      releaseTag: null,
      torOnly: true,
      iceStunSuppressed: true,
      onionIngress: { configured: true, hostname: "example.onion" },
      onionOnlyPostureActive: true,
      attestedAt: "2026-01-01T00:00:00Z",
      caveat: "test fixture caveat",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/proof/posture")) return jsonResponse(posture);
      if (url.endsWith("/api/proof/latest-release"))
        return jsonResponse(disabledReleaseResponse());
      if (url.endsWith("/api/proof/build"))
        return jsonResponse(makeBuildResponse({ "assets/index-test.js": JS_HASH }));
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RuntimeProofPage />);

    const link = await screen.findByTestId("posture-explainer-link");
    // wouter Link renders an <a>; the hash targets the docs subsection. The
    // in-app route avoids the full-page nav that would strand the user inside
    // the proxied preview iframe.
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toContain(
      "/docs/threat-model#verify-the-posture",
    );
    expect(link).toHaveTextContent(/verify the posture/i);
  });
});
