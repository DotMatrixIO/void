// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { Link } from "wouter";
import DocsAnchorLink from "@/components/DocsAnchorLink";
import HamburgerMenu from "@/components/HamburgerMenu";
import PageFooter from "@/components/PageFooter";

// /proof/runtime — client-side bundle hash verification (task #383).
//
// This page uses crypto.subtle.digest("SHA-256", ...) to hash the JS,
// CSS, and asset bundles the CURRENT BROWSER SESSION actually loaded,
// and renders them next to the published sha256 map served by
// /api/proof/build. The user verifies what THEIR OWN BROWSER ran, not
// what the server claims to have shipped.
//
// Why this is the load-bearing piece of task #383: SRI on the entry
// HTML already protects every <script> and <link> tag, but only as
// long as the entry HTML itself is honest. A targeted attacker
// controlling the edge between this user and the server can rewrite
// both the HTML and the SRI hashes inside it together. The only honest
// cross-check is for the browser to hash what it actually executed and
// compare against a reference fetched from a different network path —
// which is exactly the ritual documented in README-selfhost.md.

const BASE_URL = import.meta.env.BASE_URL ?? "/";
function apiUrl(path: string) {
  return BASE_URL.replace(/\/$/, "") + path;
}

interface BuildInfo {
  schemaVersion: number;
  gitSha: string;
  gitShaShort: string;
  builtAt: string;
  releaseTag: string | null;
  nodeVersion: string;
  clientDist: string | null;
  sha256sums: Record<string, string>;
  caveat: string;
}

interface LatestRelease {
  schemaVersion: number;
  latestTag: string | null;
  latestSha: string | null;
  htmlUrl: string | null;
  checkedAt: string;
  source: "github" | "disabled" | "unavailable";
  caveat: string;
}

// Tor-only / onion-ingress posture attestation (task #1023). Served by
// /api/proof/posture, bound to the reproducible-build identity. Lets a reader
// verify the onion-only posture is actually in force rather than trusting the
// disclosure — worded with the precise limits the server's own caveat names.
interface PostureAttestation {
  schemaVersion: number;
  gitSha: string;
  gitShaShort: string;
  releaseTag: string | null;
  torOnly: boolean;
  iceStunSuppressed: boolean;
  onionIngress: { configured: boolean; hostname: string | null };
  onionOnlyPostureActive: boolean;
  attestedAt: string;
  caveat: string;
}

const SHA_RE = /^[0-9a-f]{40}$/i;

// Only render an http(s) release URL as a link (htmlUrl is the server's
// claim from the GitHub lookup) — guard against a javascript:/data: href.
function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

type RowState =
  | { status: "match"; published: string; computed: string }
  | { status: "mismatch"; published: string; computed: string }
  | { status: "missing-published"; computed: string }
  | { status: "fetch-error"; error: string };

interface Row {
  url: string;
  shortName: string;
  state: RowState;
}

const sectionStyle: React.CSSProperties = {
  maxWidth: "680px",
  width: "100%",
  padding: "28px 24px",
  backgroundColor: "var(--surface-dark)",
  backgroundImage:
    "linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('/concrete.jpeg')",
  backgroundSize: "auto, 400px auto",
  backgroundRepeat: "repeat",
  color: "var(--fg-on-dark)",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  lineHeight: "1.9",
  letterSpacing: "0.5px",
};

const headingStyle: React.CSSProperties = {
  fontFamily: "'Staatliches', system-ui, sans-serif",
  fontWeight: 400,
  fontSize: "clamp(28px, 6vw, 36px)",
  letterSpacing: "4px",
  textTransform: "uppercase",
  color: "var(--gold)",
  lineHeight: 1.1,
  marginBottom: "20px",
};

const subheadingStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "22px",
  fontWeight: 700,
  letterSpacing: "3px",
  textTransform: "uppercase",
  color: "var(--burnt)",
  marginBottom: "16px",
  marginTop: "28px",
};

const monoBoxStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  background: "var(--bg)",
  border: "1px solid #2a241c",
  padding: "12px",
};

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

// Discover the asset URLs the current document loaded. We deliberately
// hash only what the browser executed (script / stylesheet / preload
// tags pointing at /assets/...), not the entire bundle, because that's
// the actual attack surface — a bespoke build that ships an extra
// chunk would still be caught by the rebuild-from-source SHA256SUMS,
// but the targeted-tampering threat this page is for is "the JS the
// browser executed differs from the published bundle".
function discoverLoadedAssetUrls(): string[] {
  const urls = new Set<string>();
  const isAssetUrl = (raw: string | null): raw is string => {
    if (!raw) return false;
    try {
      const u = new URL(raw, window.location.href);
      if (u.origin !== window.location.origin) return false;
      return u.pathname.includes("/assets/");
    } catch {
      return false;
    }
  };
  document.querySelectorAll("script[src]").forEach((el) => {
    const src = (el as HTMLScriptElement).getAttribute("src");
    if (isAssetUrl(src)) {
      urls.add(new URL(src, window.location.href).href);
    }
  });
  document
    .querySelectorAll('link[rel="stylesheet"], link[rel="modulepreload"]')
    .forEach((el) => {
      const href = (el as HTMLLinkElement).getAttribute("href");
      if (isAssetUrl(href)) {
        urls.add(new URL(href, window.location.href).href);
      }
    });
  return [...urls].sort();
}

function shortName(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    return parts[parts.length - 1];
  } catch {
    return url;
  }
}

function publishedKeyFor(url: string): string {
  // /api/proof/build sha256sums keys are paths relative to the
  // void-client dist root (e.g. "assets/index-abcd1234.js"). Strip
  // the BASE_URL prefix and any leading slash to match.
  try {
    const u = new URL(url);
    let p = u.pathname;
    const basePrefix = BASE_URL.replace(/\/$/, "");
    if (basePrefix && p.startsWith(basePrefix)) p = p.slice(basePrefix.length);
    return p.replace(/^\/+/, "");
  } catch {
    return url;
  }
}

export default function RuntimeProofPage() {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [latestRelease, setLatestRelease] = useState<LatestRelease | null>(
    null,
  );
  const [posture, setPosture] = useState<PostureAttestation | null>(null);
  const [postureError, setPostureError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/proof/build"), {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as BuildInfo;
        if (!cancelled) setBuildInfo(data);
      } catch (err) {
        if (!cancelled)
          setBuildError(err instanceof Error ? err.message : String(err));
      }
    })();
    // Task #428: fetch the latest published release so we can warn when the
    // running build is older. Best-effort and silent on failure — the page's
    // core hash-check works whether or not this resolves.
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/proof/latest-release"), {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as LatestRelease;
        if (!cancelled) setLatestRelease(data);
      } catch {
        // Leave latestRelease null — the status line then says nothing.
      }
    })();
    // Task #1023: fetch the Tor-only / onion-ingress posture attestation. Like
    // the build fetch this is no-store — the posture is runtime config, not an
    // immutable per-commit artifact, so a cached "active" must never linger.
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/proof/posture"), {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PostureAttestation;
        if (!cancelled) setPosture(data);
      } catch {
        if (!cancelled) setPostureError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runHashCheck() {
    setRunning(true);
    setRows([]);
    const urls = discoverLoadedAssetUrls();
    const published = buildInfo?.sha256sums ?? {};
    const results: Row[] = [];
    for (const url of urls) {
      try {
        // Bypass the service worker so we hash the bytes the NETWORK
        // actually served, not whatever the SW cache holds. `cache:
        // "no-store"` only defeats the HTTP cache; the SW sits in front of
        // it and would otherwise serve cache-first bytes, letting a
        // once-poisoned cache self-attest forever. The header is the
        // signal sw.js passes straight through (see sw.js fetch handler).
        const res = await fetch(url, {
          cache: "no-store",
          headers: { "x-void-proof-bypass": "1" },
        });
        if (!res.ok) {
          results.push({
            url,
            shortName: shortName(url),
            state: { status: "fetch-error", error: `HTTP ${res.status}` },
          });
          continue;
        }
        const bytes = await res.arrayBuffer();
        const computed = await sha256(bytes);
        const key = publishedKeyFor(url);
        const pub = published[key];
        if (!pub) {
          results.push({
            url,
            shortName: shortName(url),
            state: { status: "missing-published", computed },
          });
        } else if (pub === computed) {
          results.push({
            url,
            shortName: shortName(url),
            state: { status: "match", published: pub, computed },
          });
        } else {
          results.push({
            url,
            shortName: shortName(url),
            state: { status: "mismatch", published: pub, computed },
          });
        }
      } catch (err) {
        results.push({
          url,
          shortName: shortName(url),
          state: {
            status: "fetch-error",
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
      setRows([...results]);
    }
    setRunning(false);
  }

  const matchCount = rows.filter((r) => r.state.status === "match").length;
  const mismatchCount = rows.filter(
    (r) => r.state.status === "mismatch",
  ).length;
  const missingCount = rows.filter(
    (r) => r.state.status === "missing-published",
  ).length;
  const errorCount = rows.filter(
    (r) => r.state.status === "fetch-error",
  ).length;

  return (
    <div
      style={{
        minHeight: "100svh",
        background: "transparent",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 16px 60px",
        fontFamily: "var(--font-mono)",
        color: "var(--fg)",
        gap: "0",
      }}
    >
      <HamburgerMenu />
      <div
        style={{
          width: "100%",
          maxWidth: "680px",
          padding: "20px 0",
          paddingRight: "52px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link href="/" style={{ textDecoration: "none", lineHeight: 0 }}>
          <img
            src="/void-icon.png"
            alt="VOID"
            style={{
              width: "36px",
              height: "36px",
              imageRendering: "pixelated",
            }}
          />
        </Link>
        <Link
          href="/"
          style={{
            fontSize: "12px",
            letterSpacing: "2px",
            color: "var(--fg-dim)",
            textDecoration: "none",
            textTransform: "uppercase",
          }}
        >
          ← BACK
        </Link>
      </div>

      <div style={sectionStyle}>
        <div style={headingStyle}>VERIFY WHAT YOUR BROWSER RAN</div>
        <p style={{ marginBottom: "16px" }}>
          This page hashes the JavaScript and CSS files{" "}
          <strong>your browser actually loaded</strong> during this session
          and compares them against the published bundle the server claims
          to be serving.
        </p>
        <p style={{ marginBottom: "16px", color: "var(--burnt)" }}>
          What this defends against: a targeted attack where someone
          between you and the server ships you a bespoke, modified bundle
          while serving the honest one to everyone else. The page-level
          SRI tags only protect you if the entry HTML is honest. This
          check is your independent way to ask the browser itself.
        </p>
        <p
          style={{
            marginBottom: "16px",
            color: "var(--teal)",
            letterSpacing: "1px",
          }}
        >
          For the strongest check: run this page once on your normal
          network, then run it again from a different network (mobile
          data, a friend’s machine, a Tor exit) and confirm both report
          the same gitSha and the same matches. See the rebuild recipe
          in <code>README-selfhost.md</code>.
        </p>

        <div style={subheadingStyle}>
          <span style={{ color: "var(--gold)" }}>▌</span> BUILD INFO
        </div>
        {buildError && (
          <p style={{ color: "var(--red)" }}>
            Could not fetch /api/proof/build: {buildError}
          </p>
        )}
        {buildInfo && (
          <pre
            data-testid="build-info-block"
            style={monoBoxStyle}
          >{`gitSha:     ${buildInfo.gitSha}
short:      ${buildInfo.gitShaShort}
builtAt:    ${buildInfo.builtAt}
releaseTag: ${buildInfo.releaseTag ?? "(none)"}
node:       ${buildInfo.nodeVersion}
files:      ${Object.keys(buildInfo.sha256sums).length} hashed`}</pre>
        )}
        {!buildInfo && !buildError && (
          <pre
            data-testid="build-info-loading"
            style={{ ...monoBoxStyle, color: "var(--fg-dim)" }}
          >{`gitSha:     loading…
builtAt:    loading…
files:      loading…`}</pre>
        )}

        {(() => {
          // Task #428: compare the running build's gitSha against the latest
          // published release tag's SHA and surface the result. Every branch
          // degrades gracefully — when the release check is disabled or
          // unavailable we say so plainly rather than implying "up to date".
          if (!buildInfo) return null;
          const runningSha = buildInfo.gitSha;
          const latest = latestRelease;

          let text: string;
          let color = "var(--fg-dim)";
          if (!latest || latest.source === "unavailable") {
            text =
              "release check: unavailable (offline or rate-limited) — could not compare against the latest published release.";
          } else if (latest.source === "disabled") {
            text =
              "release check: disabled on this server (TOR_ONLY or unconfigured) — no comparison performed.";
          } else if (
            !latest.latestSha ||
            !SHA_RE.test(latest.latestSha) ||
            !SHA_RE.test(runningSha)
          ) {
            text =
              "release check: latest release could not be resolved to a commit — no comparison performed.";
          } else if (
            runningSha.toLowerCase() === latest.latestSha.toLowerCase()
          ) {
            text = `up to date: this build matches the latest published release${
              latest.latestTag ? ` (${latest.latestTag})` : ""
            }.`;
            color = "var(--teal)";
          } else {
            text = `UPDATE AVAILABLE: this build differs from the latest published release${
              latest.latestTag ? ` (${latest.latestTag})` : ""
            }. Refresh, then reverify the new build.`;
            color = "var(--gold)";
          }

          // Task #942: when the release lookup resolved a release-page URL,
          // offer it as a link so the visitor can read what changed and
          // decide whether to refresh. Degrades cleanly: no link when htmlUrl
          // is absent or isn't a plain http(s) URL. color: inherit keeps the
          // status line's existing color so no new contrast pair is added.
          const notesUrl =
            latest && latest.htmlUrl && isSafeHttpUrl(latest.htmlUrl)
              ? latest.htmlUrl
              : null;

          return (
            <p
              data-testid="release-status"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "13px",
                color,
                letterSpacing: "1px",
                marginTop: "8px",
              }}
            >
              {text}
              {notesUrl && (
                <>
                  {" "}
                  <a
                    href={notesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="release-notes-link"
                    style={{ color: "inherit", textDecoration: "underline" }}
                  >
                    See what changed →
                  </a>
                </>
              )}
            </p>
          );
        })()}

        <div style={subheadingStyle}>
          <span style={{ color: "var(--gold)" }}>▌</span> POSTURE ATTESTATION
        </div>
        {(() => {
          // Task #1023: render the Tor-only / onion-ingress posture, bound to
          // the build identity. Every branch degrades honestly — when the
          // posture is NOT the onion-only one we say so plainly rather than
          // implying it is, and the caveat spells out what this can't prove.
          if (postureError) {
            return (
              <p
                data-testid="posture-status"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  color: "var(--fg-dim)",
                  letterSpacing: "1px",
                  marginTop: "8px",
                }}
              >
                posture attestation: unavailable (offline or rate-limited) —
                could not read the running deployment's posture.
              </p>
            );
          }
          if (!posture) {
            return (
              <pre style={{ ...monoBoxStyle, marginTop: "8px" }}>
                {`posture: loading…`}
              </pre>
            );
          }
          const fact = (ok: boolean) => (ok ? "yes" : "no");
          const onion = posture.onionIngress;
          const headline = posture.onionOnlyPostureActive
            ? "ONION-ONLY POSTURE ACTIVE: TOR_ONLY is in force, /api/ice-servers emits no STUN, and ingress is onion-fronted."
            : "ONION-ONLY POSTURE NOT ACTIVE: this server is NOT running the full Tor-only / onion-ingress posture. Treat the operator-correlation residuals as un-mitigated.";
          const headColor = posture.onionOnlyPostureActive
            ? "var(--teal)"
            : "var(--gold)";
          return (
            <>
              <p
                data-testid="posture-status"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  color: headColor,
                  letterSpacing: "1px",
                  marginTop: "8px",
                }}
              >
                {headline}
              </p>
              <pre style={{ ...monoBoxStyle, marginTop: "8px" }}>
                {`bound to:   ${posture.gitShaShort}${
                  posture.releaseTag ? ` (${posture.releaseTag})` : ""
                }
TOR_ONLY:   ${fact(posture.torOnly)}
STUN suppressed: ${fact(posture.iceStunSuppressed)}
onion ingress:   ${
                  onion.configured && onion.hostname
                    ? onion.hostname
                    : "not configured"
                }
read at:    ${posture.attestedAt}`}
              </pre>
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "var(--fg-dim)",
                  letterSpacing: "0.5px",
                  marginTop: "8px",
                }}
              >
                {posture.caveat}
              </p>
              {/* Task #1039: deep-link the attestation to the explainer
                  subsection that spells out the verify-don't-trust framing and
                  the same non-claims this caveat names. Wouter in-app routing,
                  not a full-page <a> — a hard nav to a constructed BASE_URL
                  strands the user on a blank page inside the proxied preview
                  iframe. --gold on --surface-dark is 8.60:1 (AA pass). */}
              <p style={{ marginTop: "12px" }}>
                <DocsAnchorLink
                  href="/docs/threat-model#verify-the-posture"
                  testId="posture-explainer-link"
                  style={{
                    color: "var(--gold)",
                    textDecoration: "underline",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    letterSpacing: "1px",
                  }}
                >
                  Verify the posture — don’t trust it →
                </DocsAnchorLink>
              </p>
            </>
          );
        })()}

        <div style={subheadingStyle}>
          <span style={{ color: "var(--gold)" }}>▌</span> HASH THIS SESSION
        </div>
        <button
          type="button"
          data-testid="run-hash-check"
          disabled={running || !buildInfo}
          onClick={runHashCheck}
          style={{
            background: running ? "var(--bg)" : "var(--gold)",
            color: running ? "var(--gold)" : "var(--bg)",
            border: "2px solid var(--gold)",
            padding: "10px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "2px",
            textTransform: "uppercase",
            cursor: running ? "wait" : "pointer",
            marginBottom: "16px",
          }}
        >
          {running ? "Hashing…" : "Run Hash Check"}
        </button>

        {rows.length > 0 && (
          <p
            data-testid="hash-check-summary"
            style={{
              marginBottom: "12px",
              color: mismatchCount > 0 ? "var(--red)" : "var(--teal)",
              letterSpacing: "1px",
            }}
          >
            {matchCount} match · {mismatchCount} mismatch · {missingCount}{" "}
            not in published list · {errorCount} fetch error
          </p>
        )}

        {rows.map((row) => {
          const color =
            row.state.status === "match"
              ? "var(--teal)"
              : row.state.status === "mismatch"
                ? "var(--red)"
                : row.state.status === "missing-published"
                  ? "var(--gold)"
                  : "var(--burnt)";
          const label =
            row.state.status === "match"
              ? "MATCH"
              : row.state.status === "mismatch"
                ? "MISMATCH"
                : row.state.status === "missing-published"
                  ? "NOT IN PUBLISHED LIST"
                  : "FETCH ERROR";
          return (
            <div
              key={row.url}
              data-testid={`hash-row-${row.state.status}`}
              style={{
                ...monoBoxStyle,
                marginBottom: "8px",
                borderLeft: `3px solid ${color}`,
              }}
            >
              <div style={{ color, fontWeight: 700, marginBottom: "4px" }}>
                [{label}] {row.shortName}
              </div>
              {row.state.status === "match" && (
                <div>sha256: {row.state.computed}</div>
              )}
              {row.state.status === "mismatch" && (
                <>
                  <div>published: {row.state.published}</div>
                  <div>computed:  {row.state.computed}</div>
                </>
              )}
              {row.state.status === "missing-published" && (
                <div>computed: {row.state.computed}</div>
              )}
              {row.state.status === "fetch-error" && (
                <div>error: {row.state.error}</div>
              )}
            </div>
          );
        })}

        <div style={subheadingStyle}>
          <span style={{ color: "var(--gold)" }}>▌</span> UPDATE CHECK
        </div>
        <p style={{ letterSpacing: "1px" }}>
          The BUILD INFO block above includes a release check: the server
          resolves the latest published release tag to its commit SHA and
          this page compares it against the running <code>gitSha</code>. When
          they differ you’ll see <strong>UPDATE AVAILABLE</strong> here and in
          the footer badge, so you know you’re looking at an older build. The
          lookup runs server-side (your browser never contacts GitHub), is
          cached, and degrades silently — if the server is offline,
          rate-limited, or running with <code>TOR_ONLY</code>, the check
          simply reports that no comparison was performed instead of failing.
        </p>
        <p style={{ letterSpacing: "1px" }}>
          Treat this as a convenience prompt, not proof. It is the server’s
          own claim about what the latest release is; a server willing to
          serve you a stale or bespoke bundle can equally claim you are
          current. The load-bearing check is still rebuilding from the
          cosign-signed <code>SHA256SUMS</code> for the release tag and
          cross-fetching <code>/proof/build</code> from a second network path.
        </p>

        <div style={subheadingStyle}>
          <span style={{ color: "var(--gold)" }}>▌</span> RELATED
        </div>
        <p>
          <Link
            href="/proof/server-state"
            style={{ color: "var(--gold)", textDecoration: "underline" }}
          >
            /proof/server-state
          </Link>{" "}
          — what the signaling server sees for a given room code.
        </p>
      </div>

      <PageFooter />
    </div>
  );
}
