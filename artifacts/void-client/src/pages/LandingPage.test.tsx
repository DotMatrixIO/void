// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import { expectNoAxeViolations } from "@/test/axe";

// LandingPage embeds the real StartScreen (chromeless), HamburgerMenu and
// PageFooter so the audit sees production markup. Only the side-effecting
// libraries (socket, the two sound modules) are stubbed so the render stays
// deterministic in jsdom — exactly the mocks StartScreen.test.tsx uses.
vi.mock("@/lib/socket", () => ({
  getSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
  disconnectSocket: vi.fn(),
}));

vi.mock("@/lib/sounds", () => ({
  playClick: vi.fn(),
  resumeAudio: vi.fn(),
}));

vi.mock("@/lib/uiSounds", () => ({
  uiClick: vi.fn(),
  uiSelectClick: vi.fn(),
  getUiSoundsEnabled: vi.fn(() => false),
  setUiSoundsEnabled: vi.fn(),
}));

import LandingPage from "./LandingPage";

// LandingPage probes display-mode on mount to decide whether to show the
// install prompt. jsdom has no matchMedia, so stub it (non-standalone path)
// the same way the App.* tests do.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
}

describe("LandingPage accessibility audit (axe)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("has no axe violations on the main landing render", async () => {
    // HamburgerMenu and PageFooter use wouter <Link>, so the tree must be
    // mounted inside a Router for the links to render.
    const { container } = render(
      <Router>
        <LandingPage onJoinRoom={vi.fn()} />
      </Router>,
    );
    await expectNoAxeViolations(container);
  });

  it("has no axe violations when a session notice banner is shown", async () => {
    const { container } = render(
      <Router>
        <LandingPage
          onJoinRoom={vi.fn()}
          sessionNotice="ROOM EXPIRED"
          onDismissNotice={vi.fn()}
        />
      </Router>,
    );
    await expectNoAxeViolations(container);
  });
});

// The home page is now a leaner entry point: the demo videos and the
// NO-claims refusal band were moved off Landing onto the /media page, and
// the verbose guest on-ramp was replaced by a collapsible accordion. These
// tests pin what the landing page still owns — the thesis eyebrow before
// the tagline, the renamed HOST/JOIN A ROOM controls, and the collapsed
// on-ramp accordion (heading visible, body behind a "+" affordance) — and
// assert the moved pieces are NO LONGER present here so a future edit can't
// quietly drag them back.
describe("LandingPage narrative order and copy", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  function renderLanding() {
    return render(
      <Router>
        <LandingPage onJoinRoom={vi.fn()} />
      </Router>,
    );
  }

  // first.compareDocumentPosition(second) sets DOCUMENT_POSITION_FOLLOWING
  // when `second` comes after `first` in document order.
  function precedes(first: Element, second: Element): boolean {
    return Boolean(
      first.compareDocumentPosition(second) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
  }

  const THESIS = "Conversations belong to the people having them.";
  const TAGLINE = "Send anyone a link.";

  it("renders the thesis eyebrow exactly once, before the tagline", () => {
    renderLanding();

    const eyebrows = screen.getAllByText(THESIS);
    expect(
      eyebrows.length,
      `Expected the thesis eyebrow "${THESIS}" to render exactly once on the ` +
        `home page (it is the whispered premise between the OPEN BETA badge and ` +
        `the tagline). Found ${eyebrows.length}.`,
    ).toBe(1);

    const tagline = screen.getByText(TAGLINE);
    expect(
      precedes(eyebrows[0], tagline),
      `Expected the thesis eyebrow "${THESIS}" to appear BEFORE the tagline ` +
        `"${TAGLINE}" in DOM order. The eyebrow frames the ethos and must sit ` +
        `above the action hook.`,
    ).toBe(true);
  });

  it("renders the renamed HOST A ROOM and JOIN A ROOM controls", () => {
    renderLanding();

    expect(
      screen.getByRole("button", { name: /HOST A ROOM/i }),
      `Expected the embedded StartScreen to expose a "HOST A ROOM" control ` +
        `(renamed from "HOST A SESSION").`,
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /JOIN A ROOM/i }),
      `Expected the embedded StartScreen to expose a "JOIN A ROOM" control ` +
        `(renamed from "JOIN A SESSION").`,
    ).toBeInTheDocument();
  });

  it("collapses the on-ramp by default and expands it on click", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    renderLanding();

    const toggle = screen.getByTestId("on-ramp-toggle");
    expect(
      toggle.getAttribute("aria-expanded"),
      `Expected the on-ramp accordion to start collapsed (aria-expanded=false).`,
    ).toBe("false");
    expect(
      screen.queryByText(/You’re in the right place\./),
      `Expected the on-ramp body to be hidden until the heading is expanded.`,
    ).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByText(/You’re in the right place\./),
    ).toBeInTheDocument();

    const howToJoin = screen.getByRole("link", { name: /How to join/i });
    expect(howToJoin.getAttribute("href")).toBe("/invited");

    const hostInfo = screen.getByRole("link", {
      name: /HOST A ROOM, click here for more information/i,
    });
    expect(hostInfo.getAttribute("href")).toBe("/host");
  });

  it("no longer renders the moved Demos / refusal sections on Landing", () => {
    renderLanding();

    expect(
      screen.queryByRole("region", { name: "Demos" }),
      `The "Demos" section moved to /media and must not render on Landing.`,
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "What VOID refuses" }),
      `The "What VOID refuses" refusal band moved to /media and must not ` +
        `render on Landing.`,
    ).not.toBeInTheDocument();
  });
});
