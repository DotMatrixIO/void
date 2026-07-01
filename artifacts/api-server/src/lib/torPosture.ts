// SPDX-License-Identifier: AGPL-3.0-or-later
// Tor-only / onion-ingress posture ATTESTATION (task #1023).
//
// The §1.1/§1.2 operator-correlation residuals (docs/threat-model.md) are
// disclosed and *trusted*: the threat model says "use Tor to remove the IP
// from the operator's view", but a user has had no way to verify the operator
// actually runs onion-only ingress and TOR_ONLY — they trusted the disclosure.
//
// This module turns that one notch from "trust us" into "verify the published
// build's posture". It derives the posture facts from RUNTIME CONFIG and the
// reproducible BUILD IDENTITY (BUILD_INFO.json), never from a self-reported
// badge, and serves them at /api/proof/posture so a user / source-protection
// desk can check them against the build they are running.
//
// ── What it attests ───────────────────────────────────────────────────────
//   1. torOnly            — TOR_ONLY=1 is in force (lib/torOnly.ts isTorOnly).
//   2. iceStunSuppressed  — /api/ice-servers emits NO STUN in either branch
//                           (the same TOR_ONLY condition drives suppression in
//                           routes/ice-servers.ts), so no STUN binding request
//                           leaks a peer's public IP to a clearnet third party.
//   3. onionIngress       — ingress is fronted by a configured .onion host
//                           (ONION_HOSTNAME, the same value app.ts emits in
//                           the Onion-Location header).
//   onionOnlyPostureActive is true only when ALL THREE hold.
//
// ── What it explicitly does NOT prove (TOCTOU + trust limits) ──────────────
// The honest claim is "verify the PUBLISHED, reproducible build's posture at
// attestation time", NOT "the operator structurally cannot ever see an IP".
// It does NOT prove:
//   • the operator is running the un-modified, attested binary (a modified
//     binary can report whatever it likes — the load-bearing check is the
//     reproducible-build chain in README-selfhost.md §7a);
//   • that the config did not change AFTER this attestation was read (a
//     time-of-check/time-of-use window — posture is runtime config, so it can
//     be flipped a millisecond later);
//   • that no logging proxy sits in front of the attested process recording
//     IPs upstream of it.
// These non-claims travel in the response `caveat` so a raw `curl` reader sees
// them without finding the doc.

import { isTorOnly } from "./torOnly";

/**
 * True when `hostname` is a syntactically valid Tor `.onion` host as the
 * api-server accepts it: at least 16 base32 `[a-z2-7]` chars before `.onion`.
 *
 * This mirrors the rule in `app.ts` (Onion-Location emission) and is the
 * single source of truth for both — `app.ts` imports it — so the posture
 * attestation can never disagree with what the server actually fronts. The
 * client-side v3-strict rule (`onionHost.ts`, exactly 56 chars) is separate
 * and intentionally stricter; this is the looser server-side acceptance.
 */
export function isValidOnionHostname(hostname: string): boolean {
  return /^[a-z2-7]{16,}\.onion$/i.test(hostname);
}

export interface OnionIngress {
  configured: boolean;
  hostname: string | null;
}

/**
 * Resolve the onion-ingress posture from `ONION_HOSTNAME`. A blank or
 * malformed value reports `configured: false` with a null hostname — the same
 * fail-closed treatment app.ts gives an invalid value (no Onion-Location
 * header emitted). The hostname is PUBLIC (it ships in the Onion-Location
 * header and the page footer), so echoing it here discloses nothing new.
 */
export function getOnionIngress(env: NodeJS.ProcessEnv = process.env): OnionIngress {
  const raw = (env["ONION_HOSTNAME"] ?? "").trim();
  if (raw.length === 0 || !isValidOnionHostname(raw)) {
    return { configured: false, hostname: null };
  }
  return { configured: true, hostname: raw.toLowerCase() };
}

/** The reproducible-build identity the posture is bound to. */
export interface PostureBuildIdentity {
  gitSha: string;
  gitShaShort: string;
  releaseTag: string | null;
}

export interface PostureAttestation {
  schemaVersion: number;
  // ── Reproducible-build identity binding ──
  // The posture facts below are only meaningful for THIS build; a verifier
  // confirms gitSha/releaseTag against the cosign-signed SHA256SUMS and the
  // cross-network /proof/build ritual (README-selfhost.md §7a) before trusting
  // the facts. Without this binding the facts would be a free-floating badge.
  gitSha: string;
  gitShaShort: string;
  releaseTag: string | null;
  // ── Posture facts (runtime config-derived) ──
  torOnly: boolean;
  iceStunSuppressed: boolean;
  onionIngress: OnionIngress;
  // True only when torOnly && iceStunSuppressed && onionIngress.configured.
  onionOnlyPostureActive: boolean;
  attestedAt: string;
  caveat: string;
}

export const POSTURE_CAVEAT =
  "This attests the posture of the PUBLISHED, reproducible build at the moment " +
  "you read it — bind it to the build identity (gitSha / releaseTag) via the " +
  "cosign-signed SHA256SUMS and the cross-network /proof/build ritual in " +
  "README-selfhost.md §7a before trusting it. It does NOT prove the operator " +
  "is running the un-modified attested binary, that the config did not change " +
  "after this response was read (a time-of-check/time-of-use window), or that " +
  "no logging proxy sits in front of this process. The honest claim is " +
  "\"verify the published build's posture\", not \"the operator structurally " +
  "cannot ever see an IP\".";

/**
 * Build the posture attestation from the environment and the build identity.
 * Pure: takes both as arguments so it is trivially testable and never reaches
 * for a module-global. `attestedAt` is stamped at call time so a reader can
 * see how fresh the read is (the TOCTOU window the caveat names).
 */
export function buildPostureAttestation(
  build: PostureBuildIdentity,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): PostureAttestation {
  const torOnly = isTorOnly(env);
  // Under TOR_ONLY, routes/ice-servers.ts suppresses STUN in BOTH the
  // TURN-configured branch and the no-TURN fail-closed branch. The suppression
  // is gated on exactly this condition, so it is the faithful derivation — not
  // a separately-asserted flag that could drift from the route's behavior.
  const iceStunSuppressed = torOnly;
  const onionIngress = getOnionIngress(env);
  return {
    schemaVersion: 1,
    gitSha: build.gitSha,
    gitShaShort: build.gitShaShort,
    releaseTag: build.releaseTag,
    torOnly,
    iceStunSuppressed,
    onionIngress,
    onionOnlyPostureActive:
      torOnly && iceStunSuppressed && onionIngress.configured,
    attestedAt: now.toISOString(),
    caveat: POSTURE_CAVEAT,
  };
}
