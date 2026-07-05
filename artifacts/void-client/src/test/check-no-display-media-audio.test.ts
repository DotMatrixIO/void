// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanArtifacts } from "../../scripts/check-no-display-media-audio.mjs";

/**
 * Unit tests for the screen-share privacy guard
 * (`scripts/check-no-display-media-audio.mjs`).
 *
 * The scanner's own logic — constraint detection, comment stripping,
 * same-file helper expansion, DI-passthrough recognition, and
 * multi-artifact discovery — was previously validated only indirectly
 * by passing against the live codebase. These tests drive it against
 * synthetic fixture trees so a regression in the scanner itself can't
 * silently weaken the no-system-audio guarantee (Task #404 / #412 /
 * #420).
 *
 * Each test builds its own throwaway `artifacts/` root, drops one or
 * more `<artifact>/src/<file>.ts` fixtures into it, and asserts the
 * exact pass/fail outcome of `scanArtifacts(root)`.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "display-media-scan-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write `content` to `<root>/<artifact>/src/<file>` (mkdir -p). */
function writeFixture(artifact: string, file: string, content: string): string {
  const dir = join(root, artifact, "src");
  mkdirSync(dir, { recursive: true });
  const full = join(dir, file);
  writeFileSync(full, content, "utf8");
  return full;
}

/** A fully compliant callsite: explicit `audio: false` + stop/remove cleanup. */
const COMPLIANT_CALLSITE = `
export async function startShare(peer: RTCPeerConnection) {
  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: false,
  });
  const stragglers = displayStream.getAudioTracks();
  for (const t of stragglers) {
    try { t.stop(); } catch {}
  }
  for (const t of stragglers) {
    try { displayStream.removeTrack(t); } catch {}
  }
  for (const t of displayStream.getVideoTracks()) peer.addTrack(t, displayStream);
}
`;

describe("check-no-display-media-audio scanner", () => {
  it("passes a fully compliant callsite (audio:false + stop/remove cleanup)", () => {
    writeFixture("void-client", "share.ts", COMPLIANT_CALLSITE);
    const { violations } = scanArtifacts(root);
    expect(violations).toEqual([]);
  });

  it("flags a callsite missing `audio: false` (audio-false-required)", () => {
    // Cleanup IS present, so only the audio-false rule should fire —
    // isolating the constraint check.
    const file = writeFixture(
      "void-client",
      "leaky.ts",
      `
export async function startShare() {
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const a = s.getAudioTracks();
  for (const t of a) t.stop();
  for (const t of a) s.removeTrack(t);
}
`,
    );
    const { violations } = scanArtifacts(root);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("audio-false-required");
    expect(violations[0].file).toBe(file);
  });

  it("flags a callsite missing the audio-track cleanup (audio-track-cleanup-required)", () => {
    // `audio: false` IS present, so only the cleanup rule should fire —
    // isolating the belt-and-suspenders check.
    const file = writeFixture(
      "void-client",
      "no-cleanup.ts",
      `
export async function startShare(peer: RTCPeerConnection) {
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  for (const t of s.getVideoTracks()) peer.addTrack(t, s);
}
`,
    );
    const { violations } = scanArtifacts(root);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("audio-track-cleanup-required");
    expect(violations[0].file).toBe(file);
  });

  it("discovers callsites in a second (non-void-client) artifact", () => {
    // A future operator console / mobile-web entry point must be held
    // to the same guarantee with zero per-artifact wiring.
    const file = writeFixture(
      "operator-console",
      "capture.ts",
      `
export async function grab() {
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
  return s;
}
`,
    );
    const { violations, roots } = scanArtifacts(root);
    // Proves discovery walked the second artifact's src/ tree.
    expect(roots.some((r: string) => r.includes("operator-console"))).toBe(true);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((v) => v.file === file)).toBe(true);
  });

  it("ignores a `getDisplayMedia(` string that only appears inside comments", () => {
    writeFixture(
      "void-client",
      "comments.ts",
      `
// We must never call navigator.mediaDevices.getDisplayMedia({ video: true })
// without audio: false — this line documents the rule, it is not a call.
/*
 * Example of the WRONG shape:
 *   const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
 */
export const note = 1;
`,
    );
    const { violations } = scanArtifacts(root);
    expect(violations).toEqual([]);
  });

  it("skips a dependency-injection pass-through wrapper", () => {
    // The wrapper forwards opaque constraints and owns no stream; the
    // real audio policy is enforced at its callers. Treating it as a
    // violation would force fake cleanup with no stream to clean up.
    writeFixture(
      "void-client",
      "di-wrapper.ts",
      `
export type ShareFn = (c: DisplayMediaStreamOptions) => Promise<MediaStream>;

export const defaultGetDisplayMedia: ShareFn = (constraints: DisplayMediaStreamOptions) =>
  navigator.mediaDevices.getDisplayMedia(constraints);
`,
    );
    const { violations } = scanArtifacts(root);
    expect(violations).toEqual([]);
  });

  it("resolves named const constraints declared in the same file", () => {
    // Factoring constraints into a same-file `const NAME = { ..., audio: false }`
    // is a normal DRY refactor and must still pass.
    writeFixture(
      "void-client",
      "named-const.ts",
      `
const SHARE_CONSTRAINTS = {
  video: { frameRate: 30 },
  audio: false,
} as const;

export async function startShare() {
  const displayStream = await navigator.mediaDevices.getDisplayMedia(SHARE_CONSTRAINTS);
  const stragglers = displayStream.getAudioTracks();
  for (const t of stragglers) t.stop();
  for (const t of stragglers) displayStream.removeTrack(t);
}
`,
    );
    const { violations } = scanArtifacts(root);
    expect(violations).toEqual([]);
  });

  it("counts a factored-out same-file cleanup helper as satisfying the cleanup rule", () => {
    // The belt-and-suspenders cleanup is often extracted into a helper;
    // inlining same-file helper bodies must let the cleanup regexes
    // still find it.
    writeFixture(
      "void-client",
      "helper-cleanup.ts",
      `
function stripStragglerAudio(stream: MediaStream) {
  const a = stream.getAudioTracks();
  for (const t of a) t.stop();
  for (const t of a) stream.removeTrack(t);
}

export async function startShare() {
  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
  stripStragglerAudio(displayStream);
}
`,
    );
    const { violations } = scanArtifacts(root);
    expect(violations).toEqual([]);
  });

  it("reports both rules when a callsite omits audio:false AND cleanup", () => {
    const file = writeFixture(
      "void-client",
      "double.ts",
      `
export async function startShare(peer: RTCPeerConnection) {
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
  for (const t of s.getVideoTracks()) peer.addTrack(t, s);
}
`,
    );
    const { violations } = scanArtifacts(root);
    const rules = violations.filter((v) => v.file === file).map((v) => v.rule).sort();
    expect(rules).toEqual(["audio-false-required", "audio-track-cleanup-required"]);
  });

  it("returns no violations when no artifacts/ root exists", () => {
    const { violations, roots } = scanArtifacts(join(root, "does-not-exist"));
    expect(violations).toEqual([]);
    expect(roots).toEqual([]);
  });
});
