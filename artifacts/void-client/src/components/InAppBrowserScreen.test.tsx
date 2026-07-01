// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import InAppBrowserScreen from "./InAppBrowserScreen";

function withLocationHref(href: string): () => void {
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...original, href },
  });
  return () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

describe("InAppBrowserScreen", () => {
  let restore: () => void = () => {};

  beforeEach(() => {
    restore = withLocationHref("https://void.example.com/#abc-def");
  });
  afterEach(() => {
    restore();
  });

  it("names the detected app (Instagram)", () => {
    render(<InAppBrowserScreen detected="instagram" isIOS isAndroid={false} />);
    expect(screen.getByText(/Instagram/)).toBeInTheDocument();
  });

  it("shows the iOS-specific instructions on iOS", () => {
    render(<InAppBrowserScreen detected="facebook" isIOS isAndroid={false} />);
    expect(screen.getByText(/Open in Safari/i)).toBeInTheDocument();
  });

  it("shows the Android Chrome deep link (googlechrome:// scheme, hash-safe)", () => {
    render(<InAppBrowserScreen detected="generic-webview" isIOS={false} isAndroid />);
    expect(screen.getByText(/Open in browser/i)).toBeInTheDocument();
    const link = screen.getByTestId("in-app-browser-android-chrome");
    const href = link.getAttribute("href") ?? "";
    expect(href).toMatch(/^googlechrome:\/\/navigate\?url=/);
    // The full URL (including the #abc-def hash) must survive intact
    // as a URL-encoded query value — this is exactly the property the
    // `intent://` form fails.
    expect(decodeURIComponent(href.replace(/^googlechrome:\/\/navigate\?url=/, "")))
      .toBe("https://void.example.com/#abc-def");
  });

  it("does NOT show the Android Chrome link on iOS", () => {
    render(<InAppBrowserScreen detected="facebook" isIOS isAndroid={false} />);
    expect(screen.queryByTestId("in-app-browser-android-chrome")).toBeNull();
  });

  it("shows the current URL", () => {
    render(<InAppBrowserScreen detected="tiktok" isIOS={false} isAndroid />);
    expect(screen.getByTestId("in-app-browser-url").textContent).toBe(
      "https://void.example.com/#abc-def",
    );
  });

  it("copies the URL to clipboard when COPY LINK is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<InAppBrowserScreen detected="instagram" isIOS isAndroid={false} />);
    fireEvent.click(screen.getByRole("button", { name: /COPY LINK/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://void.example.com/#abc-def");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /COPIED/i })).toBeInTheDocument();
    });
  });
});
