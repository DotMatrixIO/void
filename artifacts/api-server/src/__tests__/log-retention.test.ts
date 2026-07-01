// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  PUBLISHED_LOG_RETENTION_CEILING_DAYS,
  parseRetentionDaysEnv,
  parseLogrotateRetentionDays,
  evaluateLogRetention,
} from "../lib/logRetention";

describe("PUBLISHED_LOG_RETENTION_CEILING_DAYS", () => {
  it("matches the ≤5-day ceiling published on /why and README-selfhost.md §8", () => {
    expect(PUBLISHED_LOG_RETENTION_CEILING_DAYS).toBe(5);
  });
});

describe("parseRetentionDaysEnv", () => {
  it("parses a bare positive integer", () => {
    expect(parseRetentionDaysEnv("5")).toBe(5);
    expect(parseRetentionDaysEnv(" 30 ")).toBe(30);
  });

  it("returns null for unset/empty", () => {
    expect(parseRetentionDaysEnv(undefined)).toBeNull();
    expect(parseRetentionDaysEnv("")).toBeNull();
    expect(parseRetentionDaysEnv("   ")).toBeNull();
  });

  it("rejects non-integer / non-positive / garbage values", () => {
    expect(parseRetentionDaysEnv("5d")).toBeNull();
    expect(parseRetentionDaysEnv("five")).toBeNull();
    expect(parseRetentionDaysEnv("0")).toBeNull();
    expect(parseRetentionDaysEnv("-3")).toBeNull();
    expect(parseRetentionDaysEnv("2.5")).toBeNull();
  });
});

describe("parseLogrotateRetentionDays", () => {
  // The exact config VOID ships in deploy/logrotate.d/void.
  const SHIPPED = `
/var/log/void/*.log {
    daily
    rotate 4
    maxage 5
    missingok
    notifempty
    compress
    delaycompress
    dateext
    copytruncate
    su root root
}
`;

  it("resolves the shipped daily+rotate4+maxage5 config to 5 days", () => {
    expect(parseLogrotateRetentionDays(SHIPPED)).toBe(5);
  });

  it("ignores keywords that appear only inside comments", () => {
    const commented = `
# this config used to be weekly rotate 52 maxage 365
/var/log/void/*.log {
    daily
    rotate 4
}
`;
    // (4 + 1) daily = 5; the commented 'weekly'/'maxage 365' must not count.
    expect(parseLogrotateRetentionDays(commented)).toBe(5);
  });

  it("computes (rotate + 1) × interval when only rotate is present", () => {
    expect(parseLogrotateRetentionDays("weekly\nrotate 4")).toBe(35);
    expect(parseLogrotateRetentionDays("daily\nrotate 9")).toBe(10);
  });

  it("uses maxage directly as a hard day bound", () => {
    expect(parseLogrotateRetentionDays("daily\nmaxage 14")).toBe(14);
  });

  it("takes the smaller of the rotate and maxage bounds", () => {
    // rotate bound (4+1=5) vs maxage 30 → 5
    expect(parseLogrotateRetentionDays("daily\nrotate 4\nmaxage 30")).toBe(5);
    // rotate bound (30+1=31) vs maxage 7 → 7
    expect(parseLogrotateRetentionDays("daily\nrotate 30\nmaxage 7")).toBe(7);
  });

  it("defaults to daily when rotate has no frequency keyword", () => {
    expect(parseLogrotateRetentionDays("rotate 4")).toBe(5);
  });

  it("returns null when no rotate/maxage directive is present", () => {
    expect(parseLogrotateRetentionDays("daily\ncompress\nmissingok")).toBeNull();
    expect(parseLogrotateRetentionDays("")).toBeNull();
  });
});

describe("evaluateLogRetention", () => {
  it("is silent (opt-out) when neither knob is set", () => {
    expect(evaluateLogRetention({ env: {} }).warning).toBeNull();
  });

  it("is silent when LOG_RETENTION_MAX_DAYS is within the ceiling", () => {
    expect(
      evaluateLogRetention({ env: { LOG_RETENTION_MAX_DAYS: "5" } }).warning,
    ).toBeNull();
    expect(
      evaluateLogRetention({ env: { LOG_RETENTION_MAX_DAYS: "1" } }).warning,
    ).toBeNull();
  });

  it("warns when LOG_RETENTION_MAX_DAYS exceeds the ceiling", () => {
    const { warning } = evaluateLogRetention({
      env: { LOG_RETENTION_MAX_DAYS: "365" },
    });
    expect(warning).toContain("365");
    expect(warning).toContain("EXCEEDS");
    expect(warning).toContain("≤5-day");
    expect(warning).toContain("README-selfhost.md §8");
  });

  it("warns explicitly when LOG_RETENTION_MAX_DAYS is set but unparseable", () => {
    const { warning } = evaluateLogRetention({
      env: { LOG_RETENTION_MAX_DAYS: "forever" },
    });
    expect(warning).toContain("not a positive");
    expect(warning).toContain("forever");
  });

  it("probes the logrotate config when LOGROTATE_CONFIG_PATH is set", () => {
    const result = evaluateLogRetention({
      env: { LOGROTATE_CONFIG_PATH: "/etc/logrotate.d/void" },
      readFile: () => "daily\nrotate 364",
    });
    // (364 + 1) daily = 365 → exceeds the ceiling.
    expect(result.warning).toContain("365");
    expect(result.warning).toContain("EXCEEDS");
  });

  it("is silent when the probed config is within the ceiling", () => {
    const result = evaluateLogRetention({
      env: { LOGROTATE_CONFIG_PATH: "/etc/logrotate.d/void" },
      readFile: () => "daily\nrotate 4\nmaxage 5",
    });
    expect(result.warning).toBeNull();
  });

  it("warns when the probed config path cannot be read", () => {
    const result = evaluateLogRetention({
      env: { LOGROTATE_CONFIG_PATH: "/nope/void" },
      readFile: () => {
        throw new Error("ENOENT");
      },
    });
    expect(result.warning).toContain("could not");
    expect(result.warning).toContain("/nope/void");
  });

  it("warns when the probed config has no rotate/maxage directive", () => {
    const result = evaluateLogRetention({
      env: { LOGROTATE_CONFIG_PATH: "/etc/logrotate.d/void" },
      readFile: () => "daily\ncompress",
    });
    expect(result.warning).toContain("no rotate/maxage");
  });

  it("prefers LOG_RETENTION_MAX_DAYS over the logrotate probe", () => {
    const result = evaluateLogRetention({
      env: {
        LOG_RETENTION_MAX_DAYS: "3",
        LOGROTATE_CONFIG_PATH: "/etc/logrotate.d/void",
      },
      readFile: () => {
        throw new Error("should not be read");
      },
    });
    expect(result.warning).toBeNull();
  });
});
