// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  drawWatermark,
  formatWatermarkText,
  formatWatermarkTimestamp,
  type WatermarkDrawContext,
} from "./mediaPipeline";

// jsdom does not implement the canvas 2D API end-to-end, so we exercise
// the watermark draw helper through a hand-rolled recording context that
// captures every fillRect / fillText call. That is sufficient to verify
// the contract that matters: the right text gets rendered, with a
// background rectangle behind it, in the bottom-right region of the
// frame.
interface RecordedCall {
  kind: "fillRect" | "fillText";
  args: number[];
  text?: string;
  fillStyle: string;
}

function makeRecorder(): { ctx: WatermarkDrawContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let currentFill: string = "#000";
  const ctx: WatermarkDrawContext = {
    font: "10px monospace",
    get fillStyle() {
      return currentFill;
    },
    set fillStyle(v: string | CanvasGradient | CanvasPattern) {
      currentFill = String(v);
    },
    textBaseline: "top",
    measureText(text: string) {
      // Approximate monospace width: ~0.6em per char. The exact number
      // doesn't matter for the tests; we only assert relative positioning.
      const fontSize = parseInt(this.font, 10) || 10;
      return { width: text.length * fontSize * 0.6 };
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ kind: "fillRect", args: [x, y, w, h], fillStyle: currentFill });
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ kind: "fillText", args: [x, y], text, fillStyle: currentFill });
    },
  };
  return { ctx, calls };
}

describe("formatWatermarkTimestamp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats wall-clock time as zero-padded HH:MM:SS in local time", () => {
    // Pick a fixed timestamp with single-digit hours/minutes/seconds so we
    // can verify zero-padding. We construct via the local-time Date
    // constructor so the test is independent of the runner's TZ.
    const d = new Date(2026, 3, 29, 7, 5, 9);
    expect(formatWatermarkTimestamp(d.getTime())).toBe("07:05:09");
  });

  it("zero-pads each segment to two digits", () => {
    const d = new Date(2026, 3, 29, 14, 30, 45);
    expect(formatWatermarkTimestamp(d.getTime())).toBe("14:30:45");
  });
});

describe("formatWatermarkText", () => {
  it("joins room id, timestamp, and peer tag with a separator", () => {
    const d = new Date(2026, 3, 29, 14, 30, 45);
    const text = formatWatermarkText(
      { roomId: "AB12CD", peerTag: "PEER-ABC123" },
      d.getTime(),
    );
    expect(text).toBe("AB12CD · 14:30:45 · PEER-ABC123");
  });
});

describe("drawWatermark", () => {
  it("renders a single fillText call containing the room id, timestamp, and peer tag", () => {
    const { ctx, calls } = makeRecorder();
    const d = new Date(2026, 3, 29, 14, 30, 45);
    drawWatermark(
      ctx,
      320,
      240,
      { roomId: "AB12CD", peerTag: "PEER-ABC123" },
      d.getTime(),
    );

    const textCalls = calls.filter((c) => c.kind === "fillText");
    expect(textCalls).toHaveLength(1);
    expect(textCalls[0]!.text).toBe("AB12CD · 14:30:45 · PEER-ABC123");
  });

  it("draws a background rectangle behind the text", () => {
    const { ctx, calls } = makeRecorder();
    drawWatermark(
      ctx,
      320,
      240,
      { roomId: "AB12CD", peerTag: "PEER-XYZ987" },
    );

    const rectCalls = calls.filter((c) => c.kind === "fillRect");
    expect(rectCalls.length).toBeGreaterThanOrEqual(1);
    // The first rect (the background) should be drawn before the text
    // and use a translucent dark fill.
    const bgRect = rectCalls[0]!;
    expect(bgRect.fillStyle).toMatch(/rgba\(0,\s*0,\s*0/);

    // And the rect should come before the fillText in draw order so the
    // text reads on top.
    const firstRectIdx = calls.findIndex((c) => c.kind === "fillRect");
    const firstTextIdx = calls.findIndex((c) => c.kind === "fillText");
    expect(firstRectIdx).toBeLessThan(firstTextIdx);
  });

  it("anchors the watermark to the bottom-right of the frame", () => {
    const { ctx, calls } = makeRecorder();
    const W = 320;
    const H = 240;
    drawWatermark(
      ctx,
      W,
      H,
      { roomId: "AB12CD", peerTag: "PEER-ABC123" },
    );

    const rect = calls.find((c) => c.kind === "fillRect")!;
    const [x, y, w, h] = rect.args;
    // y should be in the lower half — the box is short, so this is a
    // strong assertion. (The box width can exceed W/2 on small frames,
    // so anchoring is verified via x+w hugging the right edge instead.)
    expect(y).toBeGreaterThan(H / 2);
    // Box should fit entirely inside the frame.
    expect(x + w).toBeLessThanOrEqual(W);
    expect(y + h).toBeLessThanOrEqual(H);
    // And the box should hug the right and bottom edges (a small inset
    // is allowed so encoders that crop a few px don't eat the overlay).
    expect(W - (x + w)).toBeLessThanOrEqual(Math.round(W * 0.1));
    expect(H - (y + h)).toBeLessThanOrEqual(Math.round(H * 0.1));
  });

  it("scales font size with the smaller of width / height", () => {
    const { ctx: smallCtx } = makeRecorder();
    const { ctx: largeCtx } = makeRecorder();
    drawWatermark(smallCtx, 320, 240, { roomId: "AB12", peerTag: "PEER-AAA111" });
    drawWatermark(largeCtx, 1920, 1080, { roomId: "AB12", peerTag: "PEER-AAA111" });
    const smallSize = parseInt(smallCtx.font, 10);
    const largeSize = parseInt(largeCtx.font, 10);
    expect(largeSize).toBeGreaterThan(smallSize);
  });

  it("enforces a minimum font size at very small frame dimensions", () => {
    const { ctx } = makeRecorder();
    drawWatermark(ctx, 64, 48, { roomId: "AB12", peerTag: "PEER-AAA111" });
    expect(parseInt(ctx.font, 10)).toBeGreaterThanOrEqual(10);
  });
});
