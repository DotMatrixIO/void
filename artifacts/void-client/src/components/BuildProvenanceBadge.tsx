// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { Link } from "wouter";

// Inline build-provenance affordance (task #386).
//
// Renders a subtle monospace line like:
//   verified build · git a1b2c3d · 2h ago
// linking to /proof/runtime so every visitor can discover the
// reproducible-build verification surface without typing the URL.
//
// Update prompt (task #428): also fetches /api/proof/latest-release and,
// when the running build's gitSha differs from the latest published
// release tag's SHA, appends a subtle "· UPDATE AVAILABLE" hint so a
// visitor on a stale build is nudged to refresh / reverify. The release
// check degrades silently (offline, rate-limited, disabled under
// TOR_ONLY) — when it can't resolve a SHA, no hint is shown.
//
// Release notes link (task #942): when the latest-release response also
// carries an htmlUrl (the GitHub release page), the "UPDATE AVAILABLE"
// hint becomes a link to that page (new tab) so a visitor can read what
// changed and decide whether to refresh. When htmlUrl is null it stays a
// plain (non-link) span — no broken link. The hint keeps `color: inherit`
// so it introduces no new accent/background pair (contrast posture
// unchanged); the underline is what marks it clickable.
//
// Degradation: when /api/proof/build is unreachable, returns null and
// never throws. Also returns null when the server reports placeholder
// values (dev mode, gitShaShort === "unknown") — there is nothing
// honest to claim in that case, so we say nothing.

interface BuildInfo {
  gitSha: string;
  gitShaShort: string;
  builtAt: string;
}

const SHA_RE = /^[0-9a-f]{40}$/i;

const BASE_URL = import.meta.env.BASE_URL ?? "/";
function apiUrl(path: string): string {
  return BASE_URL.replace(/\/$/, "") + path;
}

// Only ever render an http(s) release URL as a link. The htmlUrl is the
// server's claim (it comes from the GitHub release lookup), so guard
// against a javascript:/data: payload sneaking into an href.
function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function formatRelativeTime(
  builtAt: string,
  now: number = Date.now(),
): string | null {
  const t = Date.parse(builtAt);
  if (!Number.isFinite(t)) return null;
  const deltaSec = Math.max(0, Math.round((now - t) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.round(deltaHr / 24);
  if (deltaDay < 30) return `${deltaDay}d ago`;
  const deltaMo = Math.round(deltaDay / 30);
  if (deltaMo < 12) return `${deltaMo}mo ago`;
  const deltaYr = Math.round(deltaDay / 365);
  return `${deltaYr}y ago`;
}

export default function BuildProvenanceBadge() {
  const [info, setInfo] = useState<BuildInfo | null>(null);
  const [latestSha, setLatestSha] = useState<string | null>(null);
  const [htmlUrl, setHtmlUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/proof/build"), {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as Partial<BuildInfo>;
        if (cancelled) return;
        if (
          typeof data.gitShaShort === "string" &&
          typeof data.builtAt === "string" &&
          data.gitShaShort !== "unknown" &&
          data.builtAt !== "unknown"
        ) {
          setInfo({
            gitSha: typeof data.gitSha === "string" ? data.gitSha : "",
            gitShaShort: data.gitShaShort,
            builtAt: data.builtAt,
          });
        }
      } catch {
        // Network/parse failure → render nothing. The provenance
        // affordance is a nice-to-have; it must never break the page.
      }
    })();
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/proof/latest-release"), {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          latestSha?: unknown;
          htmlUrl?: unknown;
        };
        if (cancelled) return;
        if (typeof data.latestSha === "string" && SHA_RE.test(data.latestSha)) {
          setLatestSha(data.latestSha);
        }
        if (typeof data.htmlUrl === "string" && isSafeHttpUrl(data.htmlUrl)) {
          setHtmlUrl(data.htmlUrl);
        }
      } catch {
        // Release check is best-effort. Any failure (offline, rate-limited,
        // disabled under TOR_ONLY) simply leaves the hint off.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;
  const rel = formatRelativeTime(info.builtAt);
  if (!rel) return null;

  // Only claim "UPDATE AVAILABLE" when BOTH sides are full, valid SHAs and
  // they genuinely differ. An empty/short running SHA or an unresolved
  // latest SHA leaves the hint off (silent degradation).
  const updateAvailable =
    SHA_RE.test(info.gitSha) &&
    latestSha != null &&
    info.gitSha.toLowerCase() !== latestSha.toLowerCase();

  return (
    <div
      data-testid="build-provenance-badge"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        letterSpacing: "1px",
      }}
    >
      <Link
        href="/proof/runtime"
        style={{
          color: "inherit",
          textDecoration: "none",
        }}
        title={`Built at ${info.builtAt} from git ${info.gitShaShort}`}
      >
        verified build · git {info.gitShaShort} · {rel}
      </Link>
      {/* The "UPDATE AVAILABLE" hint lives OUTSIDE the /proof/runtime Link so
          it can be its own anchor to the release page — anchors must not nest.
          When htmlUrl is present it links to the release notes (new tab) so a
          visitor can see what changed; when null it stays a plain span (no
          broken link). color: inherit keeps the existing contrast posture. */}
      {updateAvailable &&
        (htmlUrl ? (
          <>
            {" · "}
            <a
              href={htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="update-available-hint"
              title="See what changed in the latest release"
              style={{
                color: "inherit",
                fontWeight: 700,
                textDecoration: "underline",
              }}
            >
              UPDATE AVAILABLE
            </a>
          </>
        ) : (
          <>
            {" · "}
            <span data-testid="update-available-hint" style={{ fontWeight: 700 }}>
              UPDATE AVAILABLE
            </span>
          </>
        ))}
    </div>
  );
}
