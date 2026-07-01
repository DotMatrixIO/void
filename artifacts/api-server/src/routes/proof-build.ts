// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Router, type IRouter, type Request } from "express";
import { isTorOnly } from "../lib/torOnly";
import { buildPostureAttestation } from "../lib/torPosture";

// /api/proof/build — reproducible-build verification surface (task #383).
//
// Reports what THIS server claims to be serving right now: the git SHA
// it was built from, when it was built, and the sha256 of every file
// in the void-client bundle the server is statically serving (under
// CLIENT_DIST, when SERVE_STATIC=1). A verifier can:
//
//   1. curl https://this-server/api/proof/build
//   2. curl the same path from a DIFFERENT network (mobile data, a
//      friend's machine, a Tor exit) and confirm the two responses
//      agree byte-for-byte. A targeted attacker controlling the edge
//      between the user and this server can rewrite both the bundle
//      AND this response together; the second-network-path check is
//      what actually defeats that threat.
//   3. Compare gitSha against the published, cosign-signed SHA256SUMS
//      asset on the GitHub release for the same release tag.
//
// The honesty caveat lives in the response body itself so an operator
// reading raw JSON in a terminal sees it without finding the doc.
//
// Rate-limit: shares the same per-IP bucket discipline as /ice-servers
// (10 req/IP/min) — this endpoint is meant for occasional verification,
// not as a heartbeat. The response is fully cacheable (Cache-Control
// public, max-age=300) so honest fetchers don't repeatedly thunder.
//
// The BUILD_INFO.json file is written by artifacts/api-server/build.mjs
// at build time and copied into the production image alongside dist/
// by the Dockerfile (task #383). At dev time (no BUILD_INFO.json
// present) the endpoint returns a placeholder so /proof/runtime in the
// client doesn't 500 on developers.

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

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
// Independent per-IP bucket for /proof/latest-release so a footer that
// fetches BOTH /proof/build and /proof/latest-release on every page load
// doesn't burn the build bucket twice as fast.
const releaseRateBuckets = new Map<
  string,
  { count: number; resetAt: number }
>();
// Independent per-IP bucket for /proof/posture so a verification page that
// fetches /proof/build AND /proof/posture together doesn't burn one bucket
// twice as fast.
const postureRateBuckets = new Map<
  string,
  { count: number; resetAt: number }
>();

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function checkRate(
  ip: string,
  buckets: Map<string, { count: number; resetAt: number }> = rateBuckets,
): boolean {
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    buckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_MAX;
}

// Resolve BUILD_INFO.json once at module load. Candidate paths cover
// both the production layout (`./BUILD_INFO.json` next to the running
// dist/ inside the container) and the local-dev layout (sibling of
// the api-server `dist/` directory before the file is copied into the
// image). Production wins when both exist.
function locateBuildInfo(): BuildInfo | null {
  const candidates = [
    path.resolve(process.cwd(), "BUILD_INFO.json"),
    path.resolve(process.cwd(), "dist", "BUILD_INFO.json"),
    path.resolve(
      process.cwd(),
      "artifacts",
      "api-server",
      "dist",
      "BUILD_INFO.json",
    ),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8")) as BuildInfo;
      } catch {
        // Malformed JSON on disk → fall through to the placeholder so
        // the endpoint never 500s and is loud about being a placeholder.
      }
    }
  }
  return null;
}

const buildInfo: BuildInfo = locateBuildInfo() ?? {
  schemaVersion: 1,
  gitSha: "unknown",
  gitShaShort: "unknown",
  builtAt: "unknown",
  releaseTag: null,
  nodeVersion: process.version,
  clientDist: null,
  sha256sums: {},
  caveat:
    "BUILD_INFO.json was not generated for this build (dev mode). " +
    "Production releases populate gitSha, builtAt, and sha256sums; " +
    "see .github/workflows/release.yml. Even with full provenance, an " +
    "edge attacker can rewrite both the bundle and this response on a " +
    "single network path — cross-verify by fetching from a second network path.",
};

// ── /api/proof/latest-release (task #428) ────────────────────────────
//
// Turns the passive build-provenance footer (task #386) into an active
// "UPDATE AVAILABLE" prompt. This endpoint resolves the latest PUBLISHED
// release of the canonical repository to a commit SHA, so the client can
// compare it against the running build's gitSha (from /proof/build) and
// warn a visitor when they're looking at a stale build.
//
// Privacy / posture notes:
//   - The lookup is performed SERVER-SIDE so the visitor's browser never
//     talks to api.github.com directly (no third-party IP disclosure on a
//     privacy-focused page). The result is cached process-wide so the
//     upstream is hit at most ~once per TTL regardless of how many
//     visitors load the footer.
//   - Under TOR_ONLY=1 the check is SUPPRESSED: an outbound clearnet call
//     to api.github.com from an onion-only deployment would defeat the
//     operator's posture. The endpoint then reports source:"disabled".
//   - The repository is configurable via RELEASE_CHECK_REPO ("owner/repo",
//     default "DotMatrixIO/void", matching void-client/src/lib/repo.ts). Set
//     it to the empty string to disable the check entirely.
//   - Every failure mode (offline, GitHub rate-limited, malformed JSON,
//     unconfigured) degrades SILENTLY to nulls — the client renders no
//     warning rather than a broken state.
//
// Honesty caveat: this is the SERVER telling you what the latest release
// is. A server willing to ship you a stale/bespoke bundle is equally
// willing to claim "you're current". The "UPDATE AVAILABLE" hint is a
// convenience prompt, not a security guarantee — the load-bearing check
// remains rebuilding from the cosign-signed SHA256SUMS and cross-fetching
// /proof/build from a second network path (see the caveat below).

interface LatestRelease {
  schemaVersion: number;
  // Tag name of the latest published release (e.g. "v0.5.0"), or null.
  latestTag: string | null;
  // Full 40-hex commit SHA the latest release tag resolves to, or null.
  latestSha: string | null;
  // Link to the release page so a visitor can read the changelog, or null.
  htmlUrl: string | null;
  // ISO timestamp the server last resolved (or attempted to resolve) this.
  checkedAt: string;
  // "github"   — resolved from the GitHub releases API
  // "disabled" — check intentionally off (TOR_ONLY=1 or repo unconfigured)
  // "unavailable" — upstream unreachable / rate-limited / malformed
  source: "github" | "disabled" | "unavailable";
  caveat: string;
}

const RELEASE_CAVEAT =
  "This is the SERVER's claim about the latest published release; a server " +
  "willing to serve you a stale or bespoke bundle can equally claim you are " +
  "current. Treat UPDATE AVAILABLE as a prompt to reverify, not proof: rebuild " +
  "from the cosign-signed SHA256SUMS for the release tag and cross-fetch " +
  "/api/proof/build from a second network path.";

const RELEASE_CACHE_TTL_MS = 30 * 60_000; // positive cache: 30 minutes
const RELEASE_NEG_CACHE_TTL_MS = 5 * 60_000; // negative cache: 5 minutes
const RELEASE_FETCH_TIMEOUT_MS = 5_000;

let releaseCache: { value: LatestRelease; expiresAt: number } | null = null;
// Indirection so tests can inject a fetch stub instead of hitting GitHub.
let releaseFetchImpl: typeof fetch = (...args) => fetch(...args);

function releaseRepo(): string | null {
  const raw = (process.env.RELEASE_CHECK_REPO ?? "DotMatrixIO/void").trim();
  if (!raw) return null;
  // Conservative "owner/repo" shape — refuse anything that could smuggle a
  // path traversal or a different host into the constructed API URL.
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) return null;
  return raw;
}

function makeRelease(
  partial: Partial<LatestRelease> & Pick<LatestRelease, "source">,
): LatestRelease {
  return {
    schemaVersion: 1,
    latestTag: partial.latestTag ?? null,
    latestSha: partial.latestSha ?? null,
    htmlUrl: partial.htmlUrl ?? null,
    checkedAt: partial.checkedAt ?? new Date().toISOString(),
    source: partial.source,
    caveat: RELEASE_CAVEAT,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await releaseFetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Resolve the latest published release of `repo` to { tag, sha, htmlUrl }
// using the GitHub REST API, or null on any failure. Two calls:
//   1. releases/latest        → tag_name + html_url
//   2. commits/{tag} (.sha)   → the commit SHA the tag dereferences to
// The commits API resolves a tag ref to its commit and transparently
// dereferences annotated tags, so this is correct for both lightweight
// and annotated release tags (target_commitish on the release is often a
// branch name and cannot be trusted as the tag's SHA).
async function fetchLatestReleaseFromGitHub(
  repo: string,
): Promise<{ tag: string; sha: string; htmlUrl: string | null } | null> {
  const baseHeaders = {
    "User-Agent": "void-proof-build-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const relRes = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/releases/latest`,
    { headers: { ...baseHeaders, Accept: "application/vnd.github+json" } },
    RELEASE_FETCH_TIMEOUT_MS,
  );
  if (!relRes.ok) return null;
  const rel = (await relRes.json()) as {
    tag_name?: unknown;
    html_url?: unknown;
  };
  const tag = typeof rel.tag_name === "string" ? rel.tag_name : null;
  if (!tag) return null;
  const htmlUrl = typeof rel.html_url === "string" ? rel.html_url : null;

  const shaRes = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(tag)}`,
    { headers: { ...baseHeaders, Accept: "application/vnd.github.sha" } },
    RELEASE_FETCH_TIMEOUT_MS,
  );
  if (!shaRes.ok) return null;
  const sha = (await shaRes.text()).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;

  return { tag, sha, htmlUrl };
}

async function getLatestRelease(): Promise<LatestRelease> {
  const now = Date.now();
  if (releaseCache && now < releaseCache.expiresAt) return releaseCache.value;

  // Onion-only deployments must not make outbound clearnet calls.
  if (isTorOnly()) {
    const value = makeRelease({ source: "disabled" });
    releaseCache = { value, expiresAt: now + RELEASE_CACHE_TTL_MS };
    return value;
  }

  const repo = releaseRepo();
  if (!repo) {
    const value = makeRelease({ source: "disabled" });
    releaseCache = { value, expiresAt: now + RELEASE_CACHE_TTL_MS };
    return value;
  }

  try {
    const resolved = await fetchLatestReleaseFromGitHub(repo);
    if (!resolved) throw new Error("could not resolve latest release");
    const value = makeRelease({
      source: "github",
      latestTag: resolved.tag,
      latestSha: resolved.sha,
      htmlUrl: resolved.htmlUrl,
    });
    releaseCache = { value, expiresAt: now + RELEASE_CACHE_TTL_MS };
    return value;
  } catch {
    // Offline / rate-limited / malformed → degrade silently. Negative-cache
    // for a shorter window so a transient outage recovers without hammering.
    const value = makeRelease({ source: "unavailable" });
    releaseCache = { value, expiresAt: now + RELEASE_NEG_CACHE_TTL_MS };
    return value;
  }
}

const router: IRouter = Router();

router.get("/proof/build", (req, res) => {
  if (!checkRate(clientIp(req))) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(buildInfo);
});

router.get("/proof/latest-release", async (req, res) => {
  if (!checkRate(clientIp(req), releaseRateBuckets)) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  const value = await getLatestRelease();
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(value);
});

// ── /api/proof/posture (task #1023) ──────────────────────────────────────
//
// Attests the Tor-only / onion-ingress POSTURE of the running deployment,
// bound to the reproducible-build identity (gitSha / releaseTag from
// BUILD_INFO.json). Lets a user / source-protection desk verify the §1.1/§1.2
// operator-correlation residuals are actually mitigated — TOR_ONLY active, no
// STUN branches in /api/ice-servers, onion-fronted ingress — instead of
// trusting the disclosure. The posture facts and their precise NON-claims are
// derived in lib/torPosture.ts; the caveat (what this can and cannot prove)
// travels in the response body so a raw curl reader sees it.
//
// Cache-Control: NO-STORE. Unlike /proof/build (immutable per commit), the
// posture reflects current runtime config, which can change. Caching it would
// widen the time-of-check/time-of-use window the caveat already names, and let
// a stale "posture active" linger after the operator flipped it off.
router.get("/proof/posture", (req, res) => {
  if (!checkRate(clientIp(req), postureRateBuckets)) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  const attestation = buildPostureAttestation({
    gitSha: buildInfo.gitSha,
    gitShaShort: buildInfo.gitShaShort,
    releaseTag: buildInfo.releaseTag,
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(attestation);
});

export default router;
export { buildInfo as _buildInfoForTest };
// Test-only hooks: inject a fetch stub and clear the process-wide cache so
// the network-dependent path can be exercised hermetically.
export function __setReleaseFetchForTest(fn: typeof fetch | null): void {
  releaseFetchImpl = fn ?? ((...args) => fetch(...args));
}
export function __resetReleaseCacheForTest(): void {
  releaseCache = null;
}
