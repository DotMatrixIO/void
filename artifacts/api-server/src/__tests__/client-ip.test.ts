// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { __test } from "../lib/clientIp";

const { resolveTrustedIp } = __test;

describe("getTrustedClientIp / resolveTrustedIp", () => {
  it("falls back to the immediate TCP peer when no X-Forwarded-For is present", () => {
    expect(
      resolveTrustedIp(
        { remoteAddress: "10.0.0.1", forwardedHeader: undefined },
        1,
      ),
    ).toBe("10.0.0.1");
  });

  it("returns the rightmost X-Forwarded-For entry with trust=1 (single trusted proxy)", () => {
    // Topology: real_client -> trusted_proxy -> our_server.
    // The trusted proxy appended `203.0.113.5` (the actual client) to the
    // right of XFF. We trust 1 hop, so that's the value we should attribute.
    expect(
      resolveTrustedIp(
        {
          remoteAddress: "10.0.0.1",
          forwardedHeader: "203.0.113.5",
        },
        1,
      ),
    ).toBe("203.0.113.5");
  });

  it("ignores attacker-supplied leftmost X-Forwarded-For tokens (the H-01 bug)", () => {
    // Threat: a single attacker (real IP 198.51.100.7) sends a request with
    // a forged X-Forwarded-For header. The trusted reverse proxy then
    // appends the actual client IP to the right, producing:
    //   "spoofed.victim.ip, 198.51.100.7"
    // The buggy implementation read the LEFT-most token and would attribute
    // the request to "spoofed.victim.ip", letting the attacker mint a fresh
    // per-IP rate-limit bucket on every request by rotating that prefix.
    //
    // The fix must return the *real* attacker IP (the one the trusted proxy
    // appended), so the attacker shares one bucket regardless of what they
    // put in the spoofed prefix.
    const realAttackerIp = "198.51.100.7";

    const firstSpoof = resolveTrustedIp(
      {
        remoteAddress: "10.0.0.1",
        forwardedHeader: `192.0.2.1, ${realAttackerIp}`,
      },
      1,
    );
    const secondSpoof = resolveTrustedIp(
      {
        remoteAddress: "10.0.0.1",
        forwardedHeader: `192.0.2.222, ${realAttackerIp}`,
      },
      1,
    );
    const thirdSpoofMultiHopAttempt = resolveTrustedIp(
      {
        remoteAddress: "10.0.0.1",
        forwardedHeader: `192.0.2.99, 192.0.2.100, ${realAttackerIp}`,
      },
      1,
    );

    expect(firstSpoof).toBe(realAttackerIp);
    expect(secondSpoof).toBe(realAttackerIp);
    expect(thirdSpoofMultiHopAttempt).toBe(realAttackerIp);
  });

  it("walks N entries from the right when trust=N (multi-proxy chain)", () => {
    // Topology: client -> CDN -> LB -> our_server, both CDN and LB trusted.
    // XFF as we'd see it: "client_ip, cdn_appended_lb_ip" plus the LB
    // appends the CDN IP it saw, giving "client, lb-saw-cdn".
    expect(
      resolveTrustedIp(
        {
          remoteAddress: "10.0.0.1",
          forwardedHeader: "203.0.113.42, 198.51.100.10",
        },
        2,
      ),
    ).toBe("203.0.113.42");
  });

  it("collapses to the leftmost entry when the chain is shorter than the trusted hop count", () => {
    // If we claim to trust 3 hops but only 1 XFF entry was provided, every
    // entry in the chain is trusted; the leftmost one is the safest value
    // (it's the actual client behind every trusted proxy).
    expect(
      resolveTrustedIp(
        { remoteAddress: "10.0.0.1", forwardedHeader: "203.0.113.5" },
        3,
      ),
    ).toBe("203.0.113.5");
  });

  it("handles an array-valued X-Forwarded-For header (multiple header lines)", () => {
    // Node sometimes presents repeated headers as an array. Joining with ','
    // and walking from the right must still pick the rightmost entry.
    expect(
      resolveTrustedIp(
        {
          remoteAddress: "10.0.0.1",
          forwardedHeader: ["192.0.2.1", "203.0.113.7"],
        },
        1,
      ),
    ).toBe("203.0.113.7");
  });

  it("returns 'unknown' when both remoteAddress and the header are missing", () => {
    expect(
      resolveTrustedIp(
        { remoteAddress: undefined, forwardedHeader: undefined },
        1,
      ),
    ).toBe("unknown");
  });
});
