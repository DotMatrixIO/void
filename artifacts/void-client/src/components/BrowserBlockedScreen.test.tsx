// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BrowserBlockedScreen from "./BrowserBlockedScreen";

function heading() {
  return screen.getByRole("heading", { level: 1 }).textContent ?? "";
}

describe("BrowserBlockedScreen", () => {
  it("renders Vanadium-specific guidance", () => {
    render(<BrowserBlockedScreen detected="vanadium" onBack={() => {}} />);
    expect(heading()).toMatch(/VANADIUM IS BLOCKING/i);
    expect(screen.getByText(/vanadium:\/\/settings\/content\/webrtc/i)).toBeInTheDocument();
  });

  it("renders Mullvad-specific guidance with about:config", () => {
    render(<BrowserBlockedScreen detected="mullvad" onBack={() => {}} />);
    expect(heading()).toMatch(/MULLVAD/i);
    expect(screen.getAllByText(/media\.peerconnection\.enabled/i).length).toBeGreaterThan(0);
  });

  it("renders LibreWolf-specific guidance", () => {
    render(<BrowserBlockedScreen detected="librewolf" onBack={() => {}} />);
    expect(heading()).toMatch(/LIBREWOLF/i);
  });

  it("renders Tor-specific guidance (no peer-to-peer video)", () => {
    render(<BrowserBlockedScreen detected="tor" onBack={() => {}} />);
    expect(heading()).toMatch(/TOR BROWSER/i);
  });

  it("renders Brave guidance when brave=true even if detected is null", () => {
    render(<BrowserBlockedScreen detected={null} brave onBack={() => {}} />);
    expect(heading()).toMatch(/BRAVE IS BLOCKING/i);
    expect(screen.getAllByText(/Shields/i).length).toBeGreaterThan(0);
  });

  it("renders a generic fallback when detected is null", () => {
    render(<BrowserBlockedScreen detected={null} onBack={() => {}} />);
    expect(heading()).toMatch(/YOUR BROWSER IS BLOCKING/i);
    expect(screen.getByText(/Firefox, Chrome, or Safari/i)).toBeInTheDocument();
  });

  it("calls onBack when the BACK button is clicked", () => {
    const onBack = vi.fn();
    render(<BrowserBlockedScreen detected="vanadium" onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /BACK/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
