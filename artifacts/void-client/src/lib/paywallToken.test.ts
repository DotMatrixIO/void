// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, afterEach } from "vitest";
import { tokenLooksExpired } from "./paywallToken";

// Build an unsigned-but-structurally-valid JWT with the given payload.
// tokenLooksExpired never verifies the signature (the server does that);
// it only decodes the payload locally, so a dummy signature part is fine.
function makeToken(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

describe("tokenLooksExpired (Task #1143 stale-token hygiene)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false for a token expiring in the future", () => {
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(tokenLooksExpired(token)).toBe(false);
  });

  it("returns true for a token that expired in the past", () => {
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    expect(tokenLooksExpired(token)).toBe(true);
  });

  it("returns true exactly at the expiry instant (no grace)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) });
    expect(tokenLooksExpired(token)).toBe(true);
  });

  // The whole point of the helper: anything we cannot positively vouch for
  // is treated as expired so it gets CLEARED instead of wedging the HOST
  // ROOM flow the way silent trust in a stale token did.
  it("treats garbage, missing-exp, and non-JWT strings as expired", () => {
    expect(tokenLooksExpired("")).toBe(true);
    expect(tokenLooksExpired("not-a-jwt")).toBe(true);
    expect(tokenLooksExpired("a.b.c")).toBe(true);
    expect(tokenLooksExpired(makeToken({ tier: "standard" }))).toBe(true);
    expect(tokenLooksExpired(makeToken({ exp: "tomorrow" }))).toBe(true);
  });

  it("decodes base64url payloads (- and _ chars) correctly", () => {
    // A payload chosen so its base64 contains + and / before the url-safe
    // translation — the helper must translate back before atob.
    const token = makeToken({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "??>>~~__--??",
    });
    expect(tokenLooksExpired(token)).toBe(false);
  });
});
