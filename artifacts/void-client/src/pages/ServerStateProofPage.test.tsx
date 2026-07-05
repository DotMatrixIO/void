// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/HamburgerMenu", () => ({ default: () => null }));
vi.mock("@/components/PageFooter", () => ({
  default: () => <div data-testid="page-footer" />,
}));

import ServerStateProofPage from "./ServerStateProofPage";

const VALID_CODE = "0123456789abcdef0123456789abcdef";

describe("ServerStateProofPage", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes the PageFooter", () => {
    render(<ServerStateProofPage />);
    expect(screen.getByTestId("page-footer")).toBeInTheDocument();
  });

  it("renders the input, submit button, and explainer copy", () => {
    render(<ServerStateProofPage />);
    expect(screen.getByTestId("server-state-input")).toBeInTheDocument();
    expect(screen.getByTestId("server-state-submit")).toBeInTheDocument();
    expect(screen.getByText(/WHAT THE SERVER SEES/i)).toBeInTheDocument();
    expect(screen.getByText(/GET \/api\/room-state/i)).toBeInTheDocument();
  });

  it("rejects malformed codes client-side without calling fetch", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    const user = userEvent.setup();
    render(<ServerStateProofPage />);
    await user.type(screen.getByTestId("server-state-input"), "not-hex");
    await user.click(screen.getByTestId("server-state-submit"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("server-state-error")).toHaveTextContent(
      /INVALID CODE/i,
    );
  });

  it("rejects uppercase codes loudly instead of silently lowercasing them", async () => {
    // The typed code must reach the server unchanged.
    const fetchMock = vi.spyOn(global, "fetch");
    const user = userEvent.setup();
    render(<ServerStateProofPage />);
    await user.type(
      screen.getByTestId("server-state-input"),
      VALID_CODE.toUpperCase(),
    );
    await user.click(screen.getByTestId("server-state-submit"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("server-state-error")).toHaveTextContent(
      /INVALID CODE/i,
    );
  });

  it("renders the JSON snapshot returned by the server with public tier names", async () => {
    const snapshot = {
      exists: true,
      tier: "free",
      expiresAt: 1750000000000,
      participantCount: 2,
    };
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => snapshot,
    } as Response);

    const user = userEvent.setup();
    render(<ServerStateProofPage />);
    await user.type(screen.getByTestId("server-state-input"), VALID_CODE);
    await user.click(screen.getByTestId("server-state-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("server-state-json")).toBeInTheDocument();
    });
    const text = screen.getByTestId("server-state-json").textContent ?? "";
    expect(text).toContain('"exists": true');
    expect(text).toContain('"tier": "free"');
    expect(text).toContain('"participantCount": 2');
  });

  it("loud-fails on non-OK HTTP responses instead of pretending the room is empty", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    const user = userEvent.setup();
    render(<ServerStateProofPage />);
    await user.type(screen.getByTestId("server-state-input"), VALID_CODE);
    await user.click(screen.getByTestId("server-state-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("server-state-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("server-state-error")).toHaveTextContent(
      /500/,
    );
    expect(screen.queryByTestId("server-state-json")).not.toBeInTheDocument();
  });

  it("loud-fails on network errors", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(<ServerStateProofPage />);
    await user.type(screen.getByTestId("server-state-input"), VALID_CODE);
    await user.click(screen.getByTestId("server-state-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("server-state-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("server-state-error")).toHaveTextContent(
      /FETCH FAILED/i,
    );
  });

  it("renders an empty {} snapshot for a non-live room without erroring", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    const user = userEvent.setup();
    render(<ServerStateProofPage />);
    await user.type(screen.getByTestId("server-state-input"), VALID_CODE);
    await user.click(screen.getByTestId("server-state-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("server-state-json")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("server-state-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("server-state-json").textContent).toContain("{}");
  });
});
