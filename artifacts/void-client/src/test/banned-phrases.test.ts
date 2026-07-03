// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";

// @ts-expect-error -- .mjs sibling without type declarations.
import { BANNED_PHRASES, scanContent } from "../../scripts/banned-phrases.mjs";
// @ts-expect-error -- .mjs sibling without type declarations.
import { listPageFiles } from "../../scripts/check-banned-phrases.mjs";

type Violation = { line: number; phrase: string; excerpt: string };

function scan(content: string): Violation[] {
  return scanContent(content) as Violation[];
}

describe("banned marketing phrase detector", () => {
  it("flags every phrase from the canonical list", () => {
    for (const { label } of BANNED_PHRASES as { label: string }[]) {
      const sample =
        label === "we're committed to"
          ? "<p>We're committed to your privacy.</p>"
          : `<p>VOID is a ${label} tool.</p>`;
      const hits = scan(sample);
      expect(
        hits.map((h) => h.phrase),
        `expected to flag "${label}" in: ${sample}`,
      ).toContain(label);
    }
  });

  // The file scan in check-banned-phrases.mjs used to be a flat,
  // non-recursive readdirSync that silently skipped src/pages/docs/ — the
  // long-form docs pages that hold the most Tor-related prose. listPageFiles
  // now recurses; these cases lock in that the deep docs pages stay in scope
  // so a media-over-Tor / "Tor-routed" claim there can't drift in unnoticed
  // (Task #819).
  describe("docs-page scan coverage", () => {
    it("includes the deep src/pages/docs/*.tsx pages in the scan", () => {
      const scanned = (listPageFiles() as string[]).map((p) =>
        p.replace(/\\/g, "/"),
      );
      const docsPages = scanned.filter((p) => p.includes("/src/pages/docs/"));
      expect(docsPages.length).toBeGreaterThan(0);
      expect(
        docsPages.some((p) => p.endsWith("DocsThreatModelPage.tsx")),
        "expected DocsThreatModelPage.tsx to be in scan scope",
      ).toBe(true);
    });

    it("excludes *.test.tsx files from the scan", () => {
      const scanned = listPageFiles() as string[];
      expect(scanned.some((p) => p.endsWith(".test.tsx"))).toBe(false);
    });

    it("flags a planted media-over-Tor claim like one on a docs page", () => {
      const planted = "All your video is routed over Tor for total anonymity.";
      expect(scan(planted).map((h) => h.phrase)).toContain(
        "media routed over Tor",
      );
    });
  });

  it("matches case-insensitively", () => {
    const hits = scan("<p>POWERFUL and Seamless and ROBUST.</p>");
    const phrases = hits.map((h) => h.phrase).sort();
    expect(phrases).toEqual(["powerful", "robust", "seamless"]);
  });

  // Media-over-Tor positioning guard (Task #817). The TURN-over-Tor research
  // spike concluded routing WebRTC *media* over Tor is unusable, so VOID only
  // fronts the *signaling* layer with Tor. These cases lock in that the
  // detector flags copy asserting media is routed/tunnelled/anonymized over
  // Tor, while leaving the accurate signaling-over-Tor + relay framing — and
  // the honest "media over Tor is a bad experience" caveat — sayable.
  describe("media-over-Tor coverage", () => {
    it("flags media asserted as routed/tunnelled/anonymized over Tor", () => {
      const banned = [
        "All media is routed over Tor.",
        "We route your video over Tor.",
        "Your calls are tunnelled over Tor.",
        "Audio is anonymized over Tor.",
        "Media is routed through the Tor network.",
        "We anonymize every call over Tor by default.",
      ];
      for (const sample of banned) {
        expect(
          scan(sample).map((h) => h.phrase),
          `expected to flag media-over-Tor in: ${sample}`,
        ).toContain("media routed over Tor");
      }
    });

    it("allows the accurate signaling-over-Tor and relay framing", () => {
      const allowed = [
        "Signaling runs over Tor.",
        "We publish an .onion mirror.",
        "Relay-pinned so your IP isn't shared with peers.",
        "Media relays via clearnet TURN.",
        "WebRTC media over Tor is usually a bad experience.",
        "Tor covers how you reach us, not the video moving between you.",
        "Signaling rides over Tor; media relays via clearnet TURN.",
      ];
      for (const sample of allowed) {
        expect(
          scan(sample).map((h) => h.phrase),
          `did not expect a media-over-Tor flag in: ${sample}`,
        ).not.toContain("media routed over Tor");
      }
    });
  });

  // "stateless" over-claim guard (Task #1086). Describing VOID as "stateless"
  // is technically inaccurate — a minimal paid-room metadata snapshot survives
  // an operator restart (VOID_TECHNICAL_OVERVIEW.md §3.5) — so the accurate
  // framing is "ephemeral" / "no accounts and no room content stored". This
  // class of drift shipped unguarded in the root README tagline until the scan
  // was extended to cover it. These cases lock in that a bare "stateless"
  // adjective is flagged while the legitimate component-scoped technical terms
  // that appear in the docs pages stay sayable.
  describe("stateless over-claim coverage", () => {
    it("flags a bare stateless product claim", () => {
      const banned = [
        "Stateless, end-to-end encrypted P2P video over Lightning.",
        "VOID is a stateless, end-to-end encrypted app.",
        "The room is stateless.",
        "A stateless system with no persistence.",
        "One of the pleasures of a stateless app.",
      ];
      for (const sample of banned) {
        expect(
          scan(sample).map((h) => h.phrase),
          `expected to flag a stateless over-claim in: ${sample}`,
        ).toContain("stateless (over-claim — use ephemeral)");
      }
    });

    it("allows the legitimate component-scoped technical terms", () => {
      const allowed = [
        "STATELESS ARCHITECTURE",
        "Stateless architecture, log policy, the VOID phrase.",
        "Stateless JWT authentication.",
        "A stateless signaling server: brief outages do not interrupt.",
      ];
      for (const sample of allowed) {
        expect(
          scan(sample).map((h) => h.phrase),
          `did not expect a stateless flag in: ${sample}`,
        ).not.toContain("stateless (over-claim — use ephemeral)");
      }
    });
  });

  it("matches inflected forms (powerfully, seamlessly, robustness)", () => {
    expect(scan("<p>works powerfully</p>").map((h) => h.phrase)).toContain(
      "powerful",
    );
    expect(scan("<p>integrates seamlessly</p>").map((h) => h.phrase)).toContain(
      "seamless",
    );
    expect(scan("<p>protocol robustness</p>").map((h) => h.phrase)).toContain(
      "robust",
    );
  });

  it("matches curly-apostrophe variants of we're committed to", () => {
    const hits = scan("<p>We\u2019re committed to ephemerality.</p>");
    expect(hits.map((h) => h.phrase)).toContain("we're committed to");
  });

  it("returns no violations for clean copy", () => {
    expect(
      scan("<p>Meet in real time. Then, the room burns down.</p>"),
    ).toEqual([]);
  });

  it("does not flag unrelated words containing the same letters", () => {
    // 'empower' should not trip 'powerful'; 'first' alone should not trip
    // 'sovereignty-first'.
    expect(scan("<p>empower the host. first time visitors.</p>")).toEqual([]);
  });

  it("respects an inline allowlist comment on the same line", () => {
    const content = `<p>banned-phrase-allow: doc page quoting list — "powerful"</p>`;
    expect(scan(content)).toEqual([]);
  });

  it("respects an allowlist comment on the line above", () => {
    const content = [
      "{/* banned-phrase-allow: doc page quoting list */}",
      `<p>Avoid words like "powerful" and "seamless".</p>`,
    ].join("\n");
    expect(scan(content)).toEqual([]);
  });

  it("still flags violations on the line two below an allowlist comment", () => {
    const content = [
      "{/* banned-phrase-allow: covers next line only */}",
      "<p>clean line</p>",
      `<p>but this one is powerful</p>`,
    ].join("\n");
    const hits = scan(content);
    expect(hits).toHaveLength(1);
    expect(hits[0].phrase).toBe("powerful");
    expect(hits[0].line).toBe(3);
  });

  it("reports the 1-indexed line number and a trimmed excerpt", () => {
    const content = ["", "  <p>seamless integration</p>  "].join("\n");
    const hits = scan(content);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
    expect(hits[0].excerpt).toBe("<p>seamless integration</p>");
  });

  // The detector is reused by scripts/check-banned-phrases.mjs to scan the
  // per-route OG metadata in scripts/og-routes.mjs and the head meta tags in
  // index.html. Those strings are what social sites (Twitter/X, Slack,
  // iMessage, WhatsApp, LinkedIn, Facebook) show in link previews, and a
  // banned phrase slipping in there would reach far more eyes than the
  // same phrase on a page nobody has clicked through to. These cases lock
  // in that the detector flags banned phrases inside OG-shape content.
  describe("OG metadata coverage", () => {
    it("flags banned phrases in og-routes.mjs route fields", () => {
      const content = [
        "{",
        "  slug: \"landing\",",
        "  path: \"/\",",
        "  title: \"VOID | A powerful video room\",",
        "  description: \"Seamless peer-to-peer video.\",",
        "  headline: \"The robust way to talk.\",",
        "}",
      ].join("\n");
      const phrases = scan(content)
        .map((h) => h.phrase)
        .sort();
      expect(phrases).toEqual(["powerful", "robust", "seamless"]);
    });

    it("flags banned phrases in index.html meta tag content", () => {
      const content = [
        "<title>VOID | The world-class video room</title>",
        '<meta name="description" content="A powerful, seamless tool." />',
        '<meta property="og:title" content="VOID | next-generation video" />',
        '<meta property="og:description" content="best-in-class privacy." />',
        '<meta name="twitter:title" content="VOID | sovereignty-first" />',
      ].join("\n");
      const phrases = scan(content)
        .map((h) => h.phrase)
        .sort();
      expect(phrases).toEqual([
        "best-in-class",
        "next-generation",
        "powerful",
        "seamless",
        "sovereignty-first",
        "world-class",
      ]);
    });
  });
});
