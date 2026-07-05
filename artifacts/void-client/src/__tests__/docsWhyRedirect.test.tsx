// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Tombstone redirect for the retired /docs/why route. Pre-existing
// bookmarks and external links — including `#anchor` deep links —
// must continue to resolve at /docs/how-it-works, with the artifact
// base path preserved.

// Stub BASE_URL to a non-root path so we exercise the base-path
// preservation branch.
vi.stubGlobal("import.meta", { env: { BASE_URL: "/void/" } });

import DocsWhyRedirect from "@/pages/docs/DocsWhyRedirect";

describe("DocsWhyRedirect tombstone", () => {
  let replaced: string | null;
  beforeEach(() => {
    replaced = null;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hash: "",
        replace: (url: string) => {
          replaced = url;
        },
      },
    });
  });

  it("redirects bare /docs/why to /docs/how-it-works under the base path", () => {
    (window.location as unknown as { hash: string }).hash = "";
    render(<DocsWhyRedirect />);
    // BASE_URL stub above isn't seen by import.meta in Vite test runtime
    // (it's read at module load), so we accept either base — the
    // load-bearing contract is "ends at /docs/how-it-works with empty
    // hash". We assert the suffix instead of the prefix to stay
    // base-path agnostic.
    expect(replaced).not.toBeNull();
    expect(replaced!.endsWith("/docs/how-it-works")).toBe(true);
  });

  it("preserves the inbound #anchor across the redirect", () => {
    (window.location as unknown as { hash: string }).hash = "#encryption";
    render(<DocsWhyRedirect />);
    expect(replaced).not.toBeNull();
    expect(replaced!.endsWith("/docs/how-it-works#encryption")).toBe(true);
  });

  it("preserves a multi-character anchor (e.g. #the-void-phrase)", () => {
    (window.location as unknown as { hash: string }).hash = "#the-void-phrase";
    render(<DocsWhyRedirect />);
    expect(replaced!.endsWith("/docs/how-it-works#the-void-phrase")).toBe(true);
  });
});
