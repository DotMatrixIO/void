// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  buildEffectiveConfigSummary,
  buildCorsMisconfigWarning,
  buildPublicOriginRejectedWarning,
  buildOnionHostnameRejectedWarning,
  buildCloudflareTurnPartialWarning,
  buildNtfyPartialWarning,
  buildNtfyServerUrlWarning,
} from "../lib/effectiveConfig";
import {
  resolveAllowedOrigins,
  rejectedPublicOrigin,
  rejectedOnionHostname,
} from "../lib/corsOrigins";
import { describeLogRetention } from "../lib/logRetention";
import {
  configuredLightningBackend,
  lightningConfigSummary,
} from "../services/lightning";

// A minimal env where none of the Cloudflare creds are present, so the
// summary exercises the self-hosted coturn / STUN branches deterministically.
// cloudflareCredsConfigured() reads process.env directly, so we clear those
// keys on the real process.env for the few cases that depend on that branch.
function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...overrides };
}

describe("configuredLightningBackend", () => {
  it("defaults to mock when unset", () => {
    expect(configuredLightningBackend({})).toBe("mock");
  });

  it("normalizes case", () => {
    expect(configuredLightningBackend({ LIGHTNING_BACKEND: "LNbits" })).toBe(
      "lnbits",
    );
  });
});

describe("lightningConfigSummary", () => {
  it("names the backend and an effective fetch timeout without the redundant prefix", () => {
    const summary = lightningConfigSummary();
    expect(summary).toMatch(/^backend=/);
    expect(summary).toContain("fetch timeout");
    // The "Lightning: " prefix from describeLightningFetchTimeout is stripped
    // so it does not appear twice under the "Lightning" summary row.
    expect(summary).not.toContain("Lightning:");
  });
});

describe("describeLogRetention", () => {
  it("reports the check is off when neither knob is set", () => {
    const out = describeLogRetention({ env: baseEnv() });
    expect(out).toContain("check off");
    expect(out).toContain("LOG_RETENTION_MAX_DAYS");
    expect(out).toContain("≤5-day");
  });

  it("reports a within-ceiling env value without an EXCEEDS flag", () => {
    const out = describeLogRetention({
      env: baseEnv({ LOG_RETENTION_MAX_DAYS: "5" }),
    });
    expect(out).toContain("~5 day(s)");
    expect(out).toContain("LOG_RETENTION_MAX_DAYS");
    expect(out).not.toContain("EXCEEDS");
  });

  it("flags an env value above the published ceiling", () => {
    const out = describeLogRetention({
      env: baseEnv({ LOG_RETENTION_MAX_DAYS: "30" }),
    });
    expect(out).toContain("~30 day(s)");
    expect(out).toContain("EXCEEDS");
  });

  it("reports unverifiable for a non-integer env value", () => {
    const out = describeLogRetention({
      env: baseEnv({ LOG_RETENTION_MAX_DAYS: "five" }),
    });
    expect(out).toContain("unverifiable");
  });

  it("derives retention from an injected logrotate config", () => {
    const out = describeLogRetention({
      env: baseEnv({ LOGROTATE_CONFIG_PATH: "/etc/logrotate.d/void" }),
      readFile: () => "daily\nrotate 4\nmaxage 5\n",
    });
    expect(out).toContain("~5 day(s)");
    expect(out).toContain("logrotate config");
    expect(out).not.toContain("EXCEEDS");
  });

  it("reports unverifiable when the logrotate config cannot be read", () => {
    const out = describeLogRetention({
      env: baseEnv({ LOGROTATE_CONFIG_PATH: "/nope" }),
      readFile: () => {
        throw new Error("ENOENT");
      },
    });
    expect(out).toContain("unverifiable");
    expect(out).toContain("could not be read");
  });
});

describe("buildEffectiveConfigSummary", () => {
  const savedCfTokenId = process.env["CLOUDFLARE_TURN_TOKEN_ID"];
  const savedCfApiToken = process.env["CLOUDFLARE_TURN_API_TOKEN"];

  function clearCloudflare() {
    delete process.env["CLOUDFLARE_TURN_TOKEN_ID"];
    delete process.env["CLOUDFLARE_TURN_API_TOKEN"];
  }
  function restoreCloudflare() {
    if (savedCfTokenId === undefined) delete process.env["CLOUDFLARE_TURN_TOKEN_ID"];
    else process.env["CLOUDFLARE_TURN_TOKEN_ID"] = savedCfTokenId;
    if (savedCfApiToken === undefined) delete process.env["CLOUDFLARE_TURN_API_TOKEN"];
    else process.env["CLOUDFLARE_TURN_API_TOKEN"] = savedCfApiToken;
  }

  it("includes a boxed header and one row per main knob", () => {
    clearCloudflare();
    try {
      const out = buildEffectiveConfigSummary(baseEnv());
      expect(out).toContain("VOID — effective runtime configuration");
      expect(out).toContain("Mode:");
      expect(out).toContain("Tor-only:");
      expect(out).toContain("ICE / TURN:");
      expect(out).toContain("Lightning:");
      expect(out).toContain("Log retention:");
      expect(out).toContain("PAYWALL_SECRET:");
      expect(out).toContain("TURN_SECRET:");
      expect(out).toContain("README-selfhost.md §4f");
    } finally {
      restoreCloudflare();
    }
  });

  it("reports secrets by presence only — never their values", () => {
    clearCloudflare();
    try {
      const out = buildEffectiveConfigSummary(
        baseEnv({
          PAYWALL_SECRET: "super-secret-paywall-value-123",
          TURN_SECRET: "super-secret-turn-value-456",
        }),
      );
      expect(out).not.toContain("super-secret-paywall-value-123");
      expect(out).not.toContain("super-secret-turn-value-456");
      expect(out).toMatch(/PAYWALL_SECRET:\s+set \(operator-provided\)/);
      expect(out).toMatch(/TURN_SECRET:\s+set/);
    } finally {
      restoreCloudflare();
    }
  });

  it("reports the ephemeral paywall-secret default when unset", () => {
    clearCloudflare();
    try {
      const out = buildEffectiveConfigSummary(baseEnv());
      expect(out).toContain("ephemeral per-process default");
      expect(out).toMatch(/TURN_SECRET:\s+unset/);
    } finally {
      restoreCloudflare();
    }
  });

  it("reflects the self-hosted single-origin mode under SERVE_STATIC=1", () => {
    clearCloudflare();
    try {
      const out = buildEffectiveConfigSummary(baseEnv({ SERVE_STATIC: "1" }));
      expect(out).toContain("self-hosted single-origin");
    } finally {
      restoreCloudflare();
    }
  });

  it("reflects the active onion-only posture and STUN suppression under TOR_ONLY=1", () => {
    clearCloudflare();
    try {
      const out = buildEffectiveConfigSummary(
        baseEnv({
          TOR_ONLY: "1",
          TURN_URL: "turns:abcdefghij234567.onion:5349?transport=tcp",
          STUN_URL: "stun:stun.void.example:3478",
        }),
      );
      expect(out).toContain("Tor-only:");
      expect(out).toContain("ACTIVE (TOR_ONLY=1)");
      expect(out).toContain("suppressed by TOR_ONLY");
    } finally {
      restoreCloudflare();
    }
  });

  it("warns inline when a clearnet TURN is configured under TOR_ONLY", () => {
    clearCloudflare();
    try {
      const out = buildEffectiveConfigSummary(
        baseEnv({
          TOR_ONLY: "1",
          TURN_URL: "turn:203.0.113.7:3478",
        }),
      );
      expect(out).toContain("does not look over-Tor");
    } finally {
      restoreCloudflare();
    }
  });

  it("flags the no-TURN failure mode when neither STUN nor TURN is set", () => {
    clearCloudflare();
    try {
      const out = buildEffectiveConfigSummary(baseEnv());
      expect(out).toContain("host candidates only");
    } finally {
      restoreCloudflare();
    }
  });

  it("reports an empty CORS allowlist as same-origin only", () => {
    clearCloudflare();
    try {
      const out = buildEffectiveConfigSummary(baseEnv());
      expect(out).toContain("CORS origins:");
      expect(out).toContain("none — same-origin requests only (fail-closed)");
    } finally {
      restoreCloudflare();
    }
  });

  it("lists the resolved CORS origins when derivable", () => {
    clearCloudflare();
    try {
      const out = buildEffectiveConfigSummary(
        baseEnv({ PUBLIC_ORIGIN: "https://void.example.com" }),
      );
      expect(out).toContain("https://void.example.com");
      expect(out).not.toContain("none — same-origin requests only");
    } finally {
      restoreCloudflare();
    }
  });

  it("reports Cloudflare TURN by token suffix only when configured", () => {
    process.env["CLOUDFLARE_TURN_TOKEN_ID"] = "cf-token-id-WXYZ";
    process.env["CLOUDFLARE_TURN_API_TOKEN"] = "cf-api-token-secret-value";
    try {
      const out = buildEffectiveConfigSummary(
        baseEnv({
          CLOUDFLARE_TURN_TOKEN_ID: "cf-token-id-WXYZ",
          CLOUDFLARE_TURN_API_TOKEN: "cf-api-token-secret-value",
        }),
      );
      expect(out).toContain("Cloudflare TURN");
      expect(out).toContain("…WXYZ");
      expect(out).not.toContain("cf-api-token-secret-value");
    } finally {
      restoreCloudflare();
    }
  });
});

describe("buildCorsMisconfigWarning", () => {
  it("warns when the allowlist is empty and SERVE_STATIC is unset", () => {
    const out = buildCorsMisconfigWarning({});
    expect(out).not.toBeNull();
    expect(out).toContain("CORS ALLOWLIST EMPTY IN SPLIT-ORIGIN MODE");
    expect(out).toContain("PUBLIC_ORIGIN");
    expect(out).toContain("README-selfhost.md §5");
  });

  it("stays quiet under SERVE_STATIC=1 even with an empty allowlist", () => {
    expect(buildCorsMisconfigWarning({ SERVE_STATIC: "1" })).toBeNull();
  });

  it("stays quiet when PUBLIC_ORIGIN populates the allowlist", () => {
    expect(
      buildCorsMisconfigWarning({ PUBLIC_ORIGIN: "https://void.example.com" }),
    ).toBeNull();
  });

  it("stays quiet when a Replit domain populates the allowlist", () => {
    expect(
      buildCorsMisconfigWarning({ REPLIT_DEV_DOMAIN: "dev.replit.example" }),
    ).toBeNull();
  });

  it("still warns when PUBLIC_ORIGIN is set but malformed", () => {
    const out = buildCorsMisconfigWarning({ PUBLIC_ORIGIN: "not-a-url" });
    expect(out).not.toBeNull();
  });
});

describe("rejectedPublicOrigin", () => {
  it("returns null when PUBLIC_ORIGIN is unset or empty", () => {
    expect(rejectedPublicOrigin({})).toBeNull();
    expect(rejectedPublicOrigin({ PUBLIC_ORIGIN: "   " })).toBeNull();
  });

  it("returns null for a valid https origin", () => {
    expect(
      rejectedPublicOrigin({ PUBLIC_ORIGIN: "https://void.example.com" }),
    ).toBeNull();
  });

  it("flags a scheme-less value as unparseable", () => {
    const out = rejectedPublicOrigin({ PUBLIC_ORIGIN: "void.example.com" });
    expect(out).not.toBeNull();
    expect(out!.value).toBe("void.example.com");
    expect(out!.reason).toContain("scheme is required");
  });

  it("flags a non-http(s) scheme by name", () => {
    const out = rejectedPublicOrigin({
      PUBLIC_ORIGIN: "ftp://void.example.com",
    });
    expect(out).not.toBeNull();
    expect(out!.reason).toContain('unsupported scheme "ftp"');
  });

  it("does not change the allowlist behaviour — rejected values stay dropped", () => {
    expect(
      resolveAllowedOrigins({ PUBLIC_ORIGIN: "void.example.com" }),
    ).toEqual([]);
    expect(
      resolveAllowedOrigins({ PUBLIC_ORIGIN: "https://void.example.com" }),
    ).toEqual(["https://void.example.com"]);
  });
});

describe("buildPublicOriginRejectedWarning", () => {
  it("stays quiet when PUBLIC_ORIGIN is unset", () => {
    expect(buildPublicOriginRejectedWarning({})).toBeNull();
  });

  it("stays quiet for a valid PUBLIC_ORIGIN", () => {
    expect(
      buildPublicOriginRejectedWarning({
        PUBLIC_ORIGIN: "https://void.example.com",
      }),
    ).toBeNull();
  });

  it("names the rejected value and the expected format for a scheme-less value", () => {
    const out = buildPublicOriginRejectedWarning({
      PUBLIC_ORIGIN: "void.example.com",
    });
    expect(out).not.toBeNull();
    expect(out).toContain("PUBLIC_ORIGIN SET BUT REJECTED");
    expect(out).toContain("Rejected value: void.example.com");
    expect(out).toContain("scheme is required");
    expect(out).toContain("https://void.example.com");
    expect(out).toContain("README-selfhost.md §5");
  });

  it("names the offending scheme for a non-http(s) value", () => {
    const out = buildPublicOriginRejectedWarning({
      PUBLIC_ORIGIN: "ftp://void.example.com",
    });
    expect(out).not.toBeNull();
    expect(out).toContain('unsupported scheme "ftp"');
  });
});

const VALID_ONION = `${"a".repeat(56)}.onion`;

describe("rejectedOnionHostname", () => {
  it("returns null when ONION_HOSTNAME is unset or empty", () => {
    expect(rejectedOnionHostname({})).toBeNull();
    expect(rejectedOnionHostname({ ONION_HOSTNAME: "   " })).toBeNull();
  });

  it("returns null for a valid onion hostname", () => {
    expect(rejectedOnionHostname({ ONION_HOSTNAME: VALID_ONION })).toBeNull();
  });

  it("flags a non-onion domain", () => {
    const out = rejectedOnionHostname({ ONION_HOSTNAME: "void.example.com" });
    expect(out).not.toBeNull();
    expect(out!.value).toBe("void.example.com");
  });

  it("flags a value with non-base32 characters", () => {
    const out = rejectedOnionHostname({
      ONION_HOSTNAME: "contains1890digits.onion",
    });
    expect(out).not.toBeNull();
    expect(out!.value).toBe("contains1890digits.onion");
  });

  it("does not change the allowlist behaviour — rejected values stay dropped", () => {
    expect(
      resolveAllowedOrigins({ ONION_HOSTNAME: "void.example.com" }),
    ).toEqual([]);
    expect(resolveAllowedOrigins({ ONION_HOSTNAME: VALID_ONION })).toEqual([
      `http://${VALID_ONION}`,
    ]);
  });
});

describe("buildOnionHostnameRejectedWarning", () => {
  it("stays quiet when ONION_HOSTNAME is unset or empty", () => {
    expect(buildOnionHostnameRejectedWarning({})).toBeNull();
    expect(
      buildOnionHostnameRejectedWarning({ ONION_HOSTNAME: "  " }),
    ).toBeNull();
  });

  it("stays quiet for a valid onion hostname", () => {
    expect(
      buildOnionHostnameRejectedWarning({ ONION_HOSTNAME: VALID_ONION }),
    ).toBeNull();
  });

  it("names the rejected value and the expected v3 shape", () => {
    const out = buildOnionHostnameRejectedWarning({
      ONION_HOSTNAME: "void.example.com",
    });
    expect(out).not.toBeNull();
    expect(out).toContain("ONION_HOSTNAME SET BUT REJECTED");
    expect(out).toContain("Rejected value: void.example.com");
    expect(out).toContain("56 base32 characters");
    expect(out).toContain(".onion");
    expect(out).toContain("Onion-Location header is NOT emitted");
  });

  it("names a too-short onion value", () => {
    const out = buildOnionHostnameRejectedWarning({
      ONION_HOSTNAME: "short.onion",
    });
    expect(out).not.toBeNull();
    expect(out).toContain("Rejected value: short.onion");
  });
});

describe("buildCloudflareTurnPartialWarning", () => {
  it("stays quiet when neither Cloudflare variable is set", () => {
    expect(buildCloudflareTurnPartialWarning({})).toBeNull();
  });

  it("stays quiet when both Cloudflare variables are set", () => {
    expect(
      buildCloudflareTurnPartialWarning({
        CLOUDFLARE_TURN_TOKEN_ID: "id",
        CLOUDFLARE_TURN_API_TOKEN: "token",
      }),
    ).toBeNull();
  });

  it("names the missing API token when only the token ID is set", () => {
    const out = buildCloudflareTurnPartialWarning({
      CLOUDFLARE_TURN_TOKEN_ID: "id",
    });
    expect(out).not.toBeNull();
    expect(out).toContain("CLOUDFLARE TURN HALF-CONFIGURED");
    expect(out).toContain(
      "CLOUDFLARE_TURN_TOKEN_ID is set, but CLOUDFLARE_TURN_API_TOKEN is not",
    );
  });

  it("names the missing token ID when only the API token is set", () => {
    const out = buildCloudflareTurnPartialWarning({
      CLOUDFLARE_TURN_API_TOKEN: "token",
    });
    expect(out).not.toBeNull();
    expect(out).toContain(
      "CLOUDFLARE_TURN_API_TOKEN is set, but CLOUDFLARE_TURN_TOKEN_ID is not",
    );
  });

  it("never echoes the API token value", () => {
    const out = buildCloudflareTurnPartialWarning({
      CLOUDFLARE_TURN_API_TOKEN: "super-secret-token-value",
    });
    expect(out).not.toBeNull();
    expect(out).not.toContain("super-secret-token-value");
  });

  it("treats a whitespace-only value as unset", () => {
    expect(
      buildCloudflareTurnPartialWarning({
        CLOUDFLARE_TURN_TOKEN_ID: "  ",
      }),
    ).toBeNull();
  });
});

describe("buildNtfyPartialWarning", () => {
  it("stays quiet when nothing ntfy-related is set", () => {
    expect(buildNtfyPartialWarning({})).toBeNull();
  });

  it("stays quiet when NTFY_TOPIC is set", () => {
    expect(buildNtfyPartialWarning({ NTFY_TOPIC: "topic" })).toBeNull();
    expect(
      buildNtfyPartialWarning({
        NTFY_TOPIC: "topic",
        NTFY_SERVER: "https://ntfy.example.com",
        NTFY_TOKEN: "tok",
      }),
    ).toBeNull();
  });

  it("warns when NTFY_SERVER is set without a topic", () => {
    const out = buildNtfyPartialWarning({
      NTFY_SERVER: "https://ntfy.example.com",
    });
    expect(out).not.toBeNull();
    expect(out).toContain("NTFY ALERTING HALF-CONFIGURED");
    expect(out).toContain("NTFY_SERVER is set, but NTFY_TOPIC is not");
  });

  it("warns when NTFY_TOKEN is set without a topic and never echoes it", () => {
    const out = buildNtfyPartialWarning({ NTFY_TOKEN: "secret-ntfy-token" });
    expect(out).not.toBeNull();
    expect(out).toContain("NTFY_TOKEN is set, but NTFY_TOPIC is not");
    expect(out).not.toContain("secret-ntfy-token");
  });

  it("names both variables when both are set without a topic", () => {
    const out = buildNtfyPartialWarning({
      NTFY_SERVER: "https://ntfy.example.com",
      NTFY_TOKEN: "tok",
    });
    expect(out).not.toBeNull();
    expect(out).toContain(
      "NTFY_SERVER and NTFY_TOKEN are set, but NTFY_TOPIC is not",
    );
  });
});

describe("buildNtfyServerUrlWarning", () => {
  it("stays quiet when NTFY_SERVER is unset", () => {
    expect(buildNtfyServerUrlWarning({})).toBeNull();
  });

  it("treats a whitespace-only value as unset", () => {
    expect(buildNtfyServerUrlWarning({ NTFY_SERVER: "  " })).toBeNull();
  });

  it("stays quiet for valid http(s) URLs", () => {
    expect(
      buildNtfyServerUrlWarning({ NTFY_SERVER: "https://ntfy.sh" }),
    ).toBeNull();
    expect(
      buildNtfyServerUrlWarning({ NTFY_SERVER: "http://ntfy.internal:8080" }),
    ).toBeNull();
    expect(
      buildNtfyServerUrlWarning({ NTFY_SERVER: "https://ntfy.example.com/" }),
    ).toBeNull();
  });

  it("warns on a scheme-less value, echoing the value", () => {
    const out = buildNtfyServerUrlWarning({ NTFY_SERVER: "ntfy.example.com" });
    expect(out).not.toBeNull();
    expect(out).toContain("NTFY_SERVER IS NOT A VALID URL");
    expect(out).toContain('"ntfy.example.com"');
    expect(out).toContain("not a parseable URL");
  });

  it("warns on a non-http(s) scheme, naming the scheme", () => {
    const out = buildNtfyServerUrlWarning({
      NTFY_SERVER: "ftp://ntfy.example.com",
    });
    expect(out).not.toBeNull();
    expect(out).toContain('unsupported scheme "ftp"');
    expect(out).toContain('"ftp://ntfy.example.com"');
  });

  it("warns on unparseable garbage", () => {
    const out = buildNtfyServerUrlWarning({
      NTFY_SERVER: "https:// not a url",
    });
    expect(out).not.toBeNull();
    expect(out).toContain("NTFY_SERVER IS NOT A VALID URL");
  });

  it("never echoes topic or token even when they are also set", () => {
    const out = buildNtfyServerUrlWarning({
      NTFY_SERVER: "ntfy.example.com",
      NTFY_TOPIC: "secret-topic-value",
      NTFY_TOKEN: "secret-token-value",
    });
    expect(out).not.toBeNull();
    expect(out).not.toContain("secret-topic-value");
    expect(out).not.toContain("secret-token-value");
  });
});
