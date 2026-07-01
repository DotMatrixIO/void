// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "@/test/axe";

const mockState = vi.hoisted(() => ({
  instance: null as null | {
    onDecode: (result: { data: string }) => void;
    stop: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  },
  hasCamera: () => Promise.resolve(true) as Promise<boolean>,
  start: () => Promise.resolve() as Promise<void>,
  scanImage: (() =>
    Promise.resolve({ data: "" })) as (file: unknown) => Promise<{ data: string }>,
}));

vi.mock("qr-scanner", () => {
  class MockQrScanner {
    static hasCamera = vi.fn(() => mockState.hasCamera());
    static scanImage = vi.fn((file: unknown) => mockState.scanImage(file));

    onDecode: (result: { data: string }) => void;
    start = vi.fn(() => mockState.start());
    stop = vi.fn();
    destroy = vi.fn();

    constructor(
      _video: HTMLVideoElement,
      onDecode: (result: { data: string }) => void,
    ) {
      this.onDecode = onDecode;
      mockState.instance = {
        onDecode,
        stop: this.stop,
        destroy: this.destroy,
        start: this.start,
      };
    }
  }

  return { default: MockQrScanner };
});

import QrScannerModal from "./QrScannerModal";

const VALID_PHRASE = "ability about above absent absorb abstract";
const VALID_QR_URL = `https://void.example/#ability-about-above-absent-absorb-abstract`;

function installMediaDevices() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
}

function removeMediaDevices() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
}

async function flush() {
  // Let queued microtasks (hasCamera().then(...).then(...)) settle inside an
  // `act` so React state updates are applied before assertions.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockState.instance = null;
  mockState.hasCamera = () => Promise.resolve(true);
  mockState.start = () => Promise.resolve();
  mockState.scanImage = () => Promise.resolve({ data: "" });
  installMediaDevices();
});

afterEach(() => {
  removeMediaDevices();
});

describe("QrScannerModal error states", () => {
  it("shows the unsupported copy when the browser has no mediaDevices.getUserMedia", async () => {
    removeMediaDevices();
    render(<QrScannerModal onResult={vi.fn()} onClose={vi.fn()} />);

    expect(
      await screen.findByText(/SCANNING NOT SUPPORTED/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This browser cannot open the camera/i),
    ).toBeInTheDocument();
  });

  it("shows the permission-denied copy when hasCamera rejects with NotAllowedError", async () => {
    mockState.hasCamera = () =>
      Promise.reject(
        new DOMException("Permission denied by user", "NotAllowedError"),
      );

    render(<QrScannerModal onResult={vi.fn()} onClose={vi.fn()} />);
    await flush();

    expect(screen.getByText(/CAMERA ACCESS BLOCKED/i)).toBeInTheDocument();
    expect(
      screen.getByText(/VOID needs camera permission to scan a QR/i),
    ).toBeInTheDocument();
  });

  it("shows the no-camera copy when hasCamera resolves false", async () => {
    mockState.hasCamera = () => Promise.resolve(false);

    render(<QrScannerModal onResult={vi.fn()} onClose={vi.fn()} />);
    await flush();

    expect(screen.getByText(/NO CAMERA FOUND/i)).toBeInTheDocument();
    expect(
      screen.getByText(/This device does not seem to have a camera/i),
    ).toBeInTheDocument();
  });

  it("shows the no-camera copy when hasCamera rejects with NotFoundError", async () => {
    mockState.hasCamera = () =>
      Promise.reject(new DOMException("No camera", "NotFoundError"));

    render(<QrScannerModal onResult={vi.fn()} onClose={vi.fn()} />);
    await flush();

    expect(screen.getByText(/NO CAMERA FOUND/i)).toBeInTheDocument();
  });

  it("shows a generic CAMERA ERROR when hasCamera rejects with an unclassified Error", async () => {
    mockState.hasCamera = () => Promise.reject(new Error("kaboom"));

    render(<QrScannerModal onResult={vi.fn()} onClose={vi.fn()} />);
    await flush();

    expect(screen.getByText(/CAMERA ERROR/i)).toBeInTheDocument();
    expect(screen.getByText(/KABOOM/)).toBeInTheDocument();
  });
});

describe("QrScannerModal decode behavior", () => {
  it("shows the NOT A VOID ROOM QR hint and keeps the scanner mounted on a non-Void decode", async () => {
    const onResult = vi.fn();
    const onClose = vi.fn();
    render(<QrScannerModal onResult={onResult} onClose={onClose} />);
    await flush();

    expect(mockState.instance).not.toBeNull();
    const inst = mockState.instance!;

    // Sanity: no error copy is rendered, scanner is alive.
    expect(screen.queryByText(/CAMERA ACCESS BLOCKED/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NO CAMERA FOUND/i)).not.toBeInTheDocument();

    act(() => {
      inst.onDecode({ data: "https://example.com/not-a-void-room" });
    });

    expect(
      await screen.findByText(/NOT A VOID ROOM QR/i),
    ).toBeInTheDocument();

    // The scanner stays running so the user can try again.
    expect(onResult).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(inst.stop).not.toHaveBeenCalled();
    expect(inst.destroy).not.toHaveBeenCalled();
  });

  it("invokes onResult with the parsed phrase and stops the scanner on a valid decode", async () => {
    const onResult = vi.fn();
    const onClose = vi.fn();
    render(<QrScannerModal onResult={onResult} onClose={onClose} />);
    await flush();

    const inst = mockState.instance!;

    act(() => {
      inst.onDecode({ data: VALID_QR_URL });
    });

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(VALID_PHRASE);
    expect(inst.stop).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores additional decodes after a successful one", async () => {
    const onResult = vi.fn();
    render(<QrScannerModal onResult={onResult} onClose={vi.fn()} />);
    await flush();

    const inst = mockState.instance!;

    act(() => {
      inst.onDecode({ data: VALID_QR_URL });
    });
    act(() => {
      inst.onDecode({ data: VALID_QR_URL });
    });

    expect(onResult).toHaveBeenCalledTimes(1);
  });
});

describe("QrScannerModal saved-image upload flow", () => {
  const fakeFile = new File(["fake"], "qr.png", { type: "image/png" });

  function getFileInput() {
    return document.querySelector('input[type="file"]') as HTMLInputElement;
  }

  it("shows NOT A VOID ROOM QR hint and keeps the scanner mounted for a non-Void decoded image", async () => {
    mockState.scanImage = () =>
      Promise.resolve({ data: "https://example.com/not-a-void-room" });
    const onResult = vi.fn();
    render(<QrScannerModal onResult={onResult} onClose={vi.fn()} />);
    await flush();

    await act(async () => {
      fireEvent.change(getFileInput(), { target: { files: [fakeFile] } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      await screen.findByText(/NOT A VOID ROOM QR/i),
    ).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
    expect(mockState.instance?.stop).not.toHaveBeenCalled();
    expect(mockState.instance?.destroy).not.toHaveBeenCalled();
  });

  it("shows COULD NOT READ A QR hint and keeps the scanner mounted when scanImage rejects", async () => {
    mockState.scanImage = () => Promise.reject(new Error("unreadable"));
    const onResult = vi.fn();
    render(<QrScannerModal onResult={onResult} onClose={vi.fn()} />);
    await flush();

    await act(async () => {
      fireEvent.change(getFileInput(), { target: { files: [fakeFile] } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      await screen.findByText(/COULD NOT READ A QR FROM THAT IMAGE/i),
    ).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
    expect(mockState.instance?.stop).not.toHaveBeenCalled();
    expect(mockState.instance?.destroy).not.toHaveBeenCalled();
  });

  it("invokes onResult with the parsed phrase, stops the live scanner, and disables the upload button on a valid image", async () => {
    mockState.scanImage = () => Promise.resolve({ data: VALID_QR_URL });
    const onResult = vi.fn();
    render(<QrScannerModal onResult={onResult} onClose={vi.fn()} />);
    await flush();

    await act(async () => {
      fireEvent.change(getFileInput(), { target: { files: [fakeFile] } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(VALID_PHRASE);
    expect(mockState.instance?.stop).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /USE A SAVED IMAGE/i }),
    ).toBeDisabled();
  });

  it("flips the button label to READING IMAGE... while the decode is in flight", async () => {
    let resolveImage!: (val: { data: string }) => void;
    mockState.scanImage = () =>
      new Promise((res) => {
        resolveImage = res;
      });

    render(<QrScannerModal onResult={vi.fn()} onClose={vi.fn()} />);
    await flush();

    await act(async () => {
      fireEvent.change(getFileInput(), { target: { files: [fakeFile] } });
      // One tick to let setDecodingImage(true) flush through React.
      await Promise.resolve();
    });

    expect(
      screen.getByRole("button", { name: /READING IMAGE/i }),
    ).toBeInTheDocument();

    // Resolve so the component can settle before unmount.
    await act(async () => {
      resolveImage({ data: "https://example.com/not-void" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByRole("button", { name: /USE A SAVED IMAGE/i }),
    ).toBeInTheDocument();
  });
});

describe("QrScannerModal accessibility", () => {
  it("has no axe violations in the live-scanner state", async () => {
    render(<QrScannerModal onResult={vi.fn()} onClose={vi.fn()} />);
    await flush();
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });

  it("has no axe violations in an error state (no camera)", async () => {
    mockState.hasCamera = () => Promise.resolve(false);
    render(<QrScannerModal onResult={vi.fn()} onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText(/NO CAMERA FOUND/i)).toBeInTheDocument();
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });

  it("renders as a labelled dialog with aria-modal pointing at the heading", async () => {
    render(<QrScannerModal onResult={vi.fn()} onClose={vi.fn()} />);
    await flush();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(
      "aria-labelledby",
      "qr-scanner-modal-title",
    );
    expect(
      document.getElementById("qr-scanner-modal-title"),
    ).toHaveTextContent(/Scan Room QR/i);
  });

  it("focuses the first control on mount and traps Tab back to it from the last", async () => {
    render(<QrScannerModal onResult={vi.fn()} onClose={vi.fn()} />);
    await flush();

    const closeBtn = screen.getByRole("button", { name: /close scanner/i });
    expect(closeBtn).toHaveFocus();

    const cancelBtn = screen.getByRole("button", { name: /^cancel$/i });
    cancelBtn.focus();
    expect(cancelBtn).toHaveFocus();
    act(() => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect(closeBtn).toHaveFocus();
  });
});

describe("QrScannerModal dismissal", () => {
  it("calls onClose when the user presses Escape", async () => {
    const onClose = vi.fn();
    render(<QrScannerModal onResult={vi.fn()} onClose={onClose} />);
    await flush();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the user clicks the Close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<QrScannerModal onResult={vi.fn()} onClose={onClose} />);
    await flush();

    await user.click(screen.getByRole("button", { name: /close scanner/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the user clicks the Cancel button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<QrScannerModal onResult={vi.fn()} onClose={onClose} />);
    await flush();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
