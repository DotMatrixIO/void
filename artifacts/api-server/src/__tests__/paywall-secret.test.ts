// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  assertPaywallSecretNotPlaceholder,
  assertPaywallSecretConfiguredInProduction,
  isPlaceholderPaywallSecret,
  MissingPaywallSecretError,
  PlaceholderPaywallSecretError,
  PAYWALL_SECRET_PLACEHOLDERS,
} from "../lib/paywallSecret";

describe("assertPaywallSecretNotPlaceholder", () => {
  it("returns silently when PAYWALL_SECRET is unset (ephemeral fallback path)", () => {
    expect(() => assertPaywallSecretNotPlaceholder(undefined)).not.toThrow();
  });

  it("returns silently when PAYWALL_SECRET is the empty string", () => {
    expect(() => assertPaywallSecretNotPlaceholder("")).not.toThrow();
    expect(() => assertPaywallSecretNotPlaceholder("   ")).not.toThrow();
  });

  it("returns silently for a real-looking 32-byte hex secret", () => {
    // openssl rand -hex 32
    const real =
      "9f1d4b6c2a5e7f8019283746556677889900aabbccddeeff112233445566aabb";
    expect(() => assertPaywallSecretNotPlaceholder(real)).not.toThrow();
  });

  it("throws PlaceholderPaywallSecretError when set to the README example placeholder", () => {
    expect(() =>
      assertPaywallSecretNotPlaceholder("REPLACE_WITH_LONG_RANDOM_SECRET"),
    ).toThrow(PlaceholderPaywallSecretError);
  });

  it("matches placeholders case-insensitively", () => {
    expect(() => assertPaywallSecretNotPlaceholder("YOUR_STRONG_SECRET")).toThrow(
      PlaceholderPaywallSecretError,
    );
    expect(() => assertPaywallSecretNotPlaceholder("your_strong_secret")).toThrow(
      PlaceholderPaywallSecretError,
    );
    expect(() => assertPaywallSecretNotPlaceholder("Your_Strong_Secret")).toThrow(
      PlaceholderPaywallSecretError,
    );
  });

  it("matches placeholders with surrounding whitespace", () => {
    expect(() =>
      assertPaywallSecretNotPlaceholder("  REPLACE_WITH_LONG_RANDOM_SECRET  "),
    ).toThrow(PlaceholderPaywallSecretError);
  });

  it("rejects every placeholder in the registered list", () => {
    for (const placeholder of PAYWALL_SECRET_PLACEHOLDERS) {
      expect(
        () => assertPaywallSecretNotPlaceholder(placeholder),
        `expected placeholder "${placeholder}" to be rejected`,
      ).toThrow(PlaceholderPaywallSecretError);
    }
  });

  it("rejects the README-selfhost.md prose placeholders", () => {
    // These strings appear verbatim in README-selfhost.md as placeholder
    // values an operator might paste into their .env on autopilot.
    expect(() =>
      assertPaywallSecretNotPlaceholder("REPLACE_WITH_LONG_RANDOM_SECRET"),
    ).toThrow(PlaceholderPaywallSecretError);
    expect(() =>
      assertPaywallSecretNotPlaceholder("YOUR_STRONG_SECRET"),
    ).toThrow(PlaceholderPaywallSecretError);
  });

  it("rejects the task-description placeholder spelled out in full", () => {
    // Task #195 calls this variant out by name as something docs have
    // historically carried — keep it covered even if the README phrasing
    // shifts again later.
    expect(() =>
      assertPaywallSecretNotPlaceholder(
        "REPLACE_WITH_LONG_RANDOM_PAYWALL_SECRET",
      ),
    ).toThrow(PlaceholderPaywallSecretError);
  });

  it("error carries the offending placeholder for actionable logging", () => {
    try {
      assertPaywallSecretNotPlaceholder("YOUR_STRONG_SECRET");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PlaceholderPaywallSecretError);
      expect((err as PlaceholderPaywallSecretError).placeholder).toBe(
        "YOUR_STRONG_SECRET",
      );
    }
  });
});

// ── Production posture (Task #1143) ─────────────────────────────────────────
// An unset PAYWALL_SECRET silently invalidates every host JWT and recovery
// code on each restart. Fine for dev; in production it must be an explicit
// choice (PAYWALL_ALLOW_EPHEMERAL_SECRET=1), never the accidental default.
describe("assertPaywallSecretConfiguredInProduction", () => {
  const real =
    "9f1d4b6c2a5e7f8019283746556677889900aabbccddeeff112233445566aabb";

  it("throws MissingPaywallSecretError in production when unset", () => {
    expect(() =>
      assertPaywallSecretConfiguredInProduction(undefined, "production", undefined),
    ).toThrow(MissingPaywallSecretError);
  });

  it("throws in production when set but blank/whitespace-only", () => {
    expect(() =>
      assertPaywallSecretConfiguredInProduction("", "production", undefined),
    ).toThrow(MissingPaywallSecretError);
    expect(() =>
      assertPaywallSecretConfiguredInProduction("   ", "production", undefined),
    ).toThrow(MissingPaywallSecretError);
  });

  it("passes in production with a configured secret", () => {
    expect(() =>
      assertPaywallSecretConfiguredInProduction(real, "production", undefined),
    ).not.toThrow();
  });

  it("passes in production when unset but explicitly opted into ephemeral", () => {
    expect(() =>
      assertPaywallSecretConfiguredInProduction(undefined, "production", "1"),
    ).not.toThrow();
  });

  it("does not treat other truthy-looking opt-out values as consent", () => {
    for (const notOne of ["true", "yes", "0", "", " 1"]) {
      expect(
        () =>
          assertPaywallSecretConfiguredInProduction(undefined, "production", notOne),
        `expected opt-out value ${JSON.stringify(notOne)} to be rejected`,
      ).toThrow(MissingPaywallSecretError);
    }
  });

  it("never throws outside production regardless of secret state", () => {
    for (const env of [undefined, "development", "test", "staging"]) {
      expect(() =>
        assertPaywallSecretConfiguredInProduction(undefined, env, undefined),
      ).not.toThrow();
    }
  });

  it("the error message names both remediation paths", () => {
    try {
      assertPaywallSecretConfiguredInProduction(undefined, "production", undefined);
      expect.fail("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("PAYWALL_SECRET");
      expect(msg).toContain("PAYWALL_ALLOW_EPHEMERAL_SECRET=1");
    }
  });
});

describe("isPlaceholderPaywallSecret", () => {
  it("returns false for a real-looking secret", () => {
    expect(
      isPlaceholderPaywallSecret(
        "9f1d4b6c2a5e7f8019283746556677889900aabbccddeeff112233445566aabb",
      ),
    ).toBe(false);
  });

  it("returns true for known placeholders", () => {
    expect(isPlaceholderPaywallSecret("YOUR_STRONG_SECRET")).toBe(true);
    expect(isPlaceholderPaywallSecret("REPLACE_WITH_LONG_RANDOM_SECRET")).toBe(
      true,
    );
  });

  it("returns false for empty / whitespace-only input", () => {
    expect(isPlaceholderPaywallSecret("")).toBe(false);
    expect(isPlaceholderPaywallSecret("   ")).toBe(false);
  });
});
