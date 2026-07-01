// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  assertTurnSecretNotPlaceholder,
  isPlaceholderTurnSecret,
  PlaceholderTurnSecretError,
  TURN_SECRET_MIN_LENGTH,
  TURN_SECRET_PLACEHOLDERS,
} from "../lib/turnSecret";

describe("assertTurnSecretNotPlaceholder", () => {
  it("returns silently when TURN_SECRET is unset (TURN is optional)", () => {
    expect(() => assertTurnSecretNotPlaceholder(undefined)).not.toThrow();
  });

  it("returns silently when TURN_SECRET is the empty string", () => {
    expect(() => assertTurnSecretNotPlaceholder("")).not.toThrow();
    expect(() => assertTurnSecretNotPlaceholder("   ")).not.toThrow();
  });

  it("returns silently for a real-looking 32-byte hex secret", () => {
    // openssl rand -hex 32
    const real =
      "9f1d4b6c2a5e7f8019283746556677889900aabbccddeeff112233445566aabb";
    expect(() => assertTurnSecretNotPlaceholder(real)).not.toThrow();
  });

  it("throws PlaceholderTurnSecretError when set to the example-file placeholder", () => {
    expect(() => assertTurnSecretNotPlaceholder("YOUR_SECRET_HERE")).toThrow(
      PlaceholderTurnSecretError,
    );
  });

  it("matches placeholders case-insensitively", () => {
    expect(() => assertTurnSecretNotPlaceholder("your_secret_here")).toThrow(
      PlaceholderTurnSecretError,
    );
    expect(() => assertTurnSecretNotPlaceholder("Your_Secret_Here")).toThrow(
      PlaceholderTurnSecretError,
    );
  });

  it("matches placeholders with surrounding whitespace", () => {
    expect(() =>
      assertTurnSecretNotPlaceholder("  YOUR_SECRET_HERE  "),
    ).toThrow(PlaceholderTurnSecretError);
  });

  it("rejects every placeholder in the registered list", () => {
    for (const placeholder of TURN_SECRET_PLACEHOLDERS) {
      expect(
        () => assertTurnSecretNotPlaceholder(placeholder),
        `expected placeholder "${placeholder}" to be rejected`,
      ).toThrow(PlaceholderTurnSecretError);
    }
  });

  it("rejects the README-selfhost.md prose placeholders", () => {
    // These three strings appear verbatim in README-selfhost.md as placeholder
    // values an operator might paste into their .env on autopilot.
    expect(() =>
      assertTurnSecretNotPlaceholder("REPLACE_WITH_YOUR_TURN_SECRET"),
    ).toThrow(PlaceholderTurnSecretError);
    expect(() =>
      assertTurnSecretNotPlaceholder("REPLACE_WITH_LONG_RANDOM_TURN_SECRET"),
    ).toThrow(PlaceholderTurnSecretError);
    expect(() =>
      assertTurnSecretNotPlaceholder("REPLACE_WITH_THE_SAME_SECRET"),
    ).toThrow(PlaceholderTurnSecretError);
  });

  it("rejects a single-character secret as too short (R-N2)", () => {
    expect(() => assertTurnSecretNotPlaceholder("x")).toThrow(
      PlaceholderTurnSecretError,
    );
  });

  it("rejects a non-placeholder secret just below the minimum length", () => {
    const shortSecret = "a".repeat(TURN_SECRET_MIN_LENGTH - 1);
    expect(() => assertTurnSecretNotPlaceholder(shortSecret)).toThrow(
      PlaceholderTurnSecretError,
    );
  });

  it("accepts a non-placeholder secret at exactly the minimum length", () => {
    const justLongEnough = "a".repeat(TURN_SECRET_MIN_LENGTH);
    expect(() =>
      assertTurnSecretNotPlaceholder(justLongEnough),
    ).not.toThrow();
  });

  it("measures length post-trim so padded short secrets are rejected", () => {
    expect(() => assertTurnSecretNotPlaceholder("   x   ")).toThrow(
      PlaceholderTurnSecretError,
    );
  });

  it("min-length error message names the length floor and the offending length", () => {
    try {
      assertTurnSecretNotPlaceholder("short");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PlaceholderTurnSecretError);
      const message = (err as PlaceholderTurnSecretError).message;
      expect(message).toContain(String(TURN_SECRET_MIN_LENGTH));
      expect(message).toContain("5 characters");
      expect((err as PlaceholderTurnSecretError).placeholder).toBe("short");
    }
  });

  it("error carries the offending placeholder for actionable logging", () => {
    try {
      assertTurnSecretNotPlaceholder("YOUR_SECRET_HERE");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PlaceholderTurnSecretError);
      expect((err as PlaceholderTurnSecretError).placeholder).toBe(
        "YOUR_SECRET_HERE",
      );
    }
  });
});

describe("isPlaceholderTurnSecret", () => {
  it("returns false for a real-looking secret", () => {
    expect(
      isPlaceholderTurnSecret(
        "9f1d4b6c2a5e7f8019283746556677889900aabbccddeeff112233445566aabb",
      ),
    ).toBe(false);
  });

  it("returns true for known placeholders", () => {
    expect(isPlaceholderTurnSecret("YOUR_SECRET_HERE")).toBe(true);
  });
});
