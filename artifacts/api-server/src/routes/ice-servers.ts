// SPDX-License-Identifier: AGPL-3.0-or-later
import crypto from "node:crypto";
import { Router, type Request } from "express";
import { unwrapSecret, type Secret } from "@workspace/wire-core";
import { brandTurnSecret } from "../lib/turnSecret";
import {
  cloudflareCredsConfigured,
  getCloudflareIceServers,
} from "../lib/cloudflareTurn";
import { isTorOnly, stripStunIceServers } from "../lib/torOnly";

interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

const router = Router();

const MIN_TTL = 300;
const MAX_TTL = 86400;
const ROOM_TTL_SECONDS = 65 * 60;
const TTL_SAFETY_BUFFER = 10 * 60;
const DEFAULT_TTL = ROOM_TTL_SECONDS + TTL_SAFETY_BUFFER;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request): string {
  // Use req.ip, which reflects the Express `trust proxy` setting (configured
  // in app.ts). The leftmost X-Forwarded-For token is attacker-controlled
  // and would let a single source rotate spoofed values to bypass the
  // per-IP rate limit; req.ip with trust=1 returns the rightmost entry
  // (added by the trusted reverse proxy) instead.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function checkIpRate(ip: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_MAX;
}

router.get("/ice-servers", async (req, res) => {
  const clientIp = getClientIp(req);
  if (!checkIpRate(clientIp)) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }

  // Cloudflare-TURN branch (testing-only — see lib/cloudflareTurn.ts).
  // Takes precedence over the coturn `TURN_URL`/`TURN_SECRET` branch so
  // an operator who set Cloudflare creds gets a Cloudflare response,
  // not a half-configured coturn one. Production self-hosters should
  // leave the Cloudflare env vars unset and continue to use the coturn
  // path below — see README-selfhost.md §4 for the framing.
  if (cloudflareCredsConfigured()) {
    let ttl = parseInt(
      process.env["TURN_CREDENTIAL_TTL"] ?? String(DEFAULT_TTL),
      10,
    );
    if (isNaN(ttl) || ttl < MIN_TTL) ttl = MIN_TTL;
    if (ttl > MAX_TTL) ttl = MAX_TTL;

    const result = await getCloudflareIceServers(ttl);
    if (result.ok) {
      // Under TOR_ONLY, strip any STUN entry from the Cloudflare-minted
      // payload. Cloudflare's credentials API routinely returns a clearnet
      // `stun:` server alongside the TURN relay; advertising it would let a
      // STUN binding request reveal each peer's public IP to a clearnet third
      // party during ICE gathering — the same disclosure the coturn and
      // no-TURN branches already suppress under TOR_ONLY. Filtering at
      // response time keeps the raw upstream payload in the cache untouched.
      // This also keeps /api/proof/posture's `iceStunSuppressed` claim honest
      // for this branch. See lib/torOnly.ts.
      const iceServers = isTorOnly()
        ? stripStunIceServers(result.iceServers)
        : result.iceServers;
      res.json({
        iceServers,
        ttl: result.ttl,
        expiresAt: result.expiresAt,
      });
    } else {
      // Fail closed identically to the "no TURN configured" shape so
      // the client surfaces the same operator banner instead of
      // reading a misleading partial config as success.
      res
        .status(result.status)
        .json({ iceServers: [], no_turn_configured: true });
    }
    return;
  }

  const turnUrl = process.env["TURN_URL"];
  const rawTurnSecret = process.env["TURN_SECRET"];
  // Brand at the declaration site so the value carries `Secret<string>`
  // through the HMAC-SHA1 credential mint below. The custom ESLint rule
  // `no-secret-equality` follows the brand to flag any equality compare.
  const turnSecret: Secret<string> | undefined = rawTurnSecret
    ? brandTurnSecret(rawTurnSecret)
    : undefined;

  if (turnUrl && turnSecret) {
    let ttl = parseInt(process.env["TURN_CREDENTIAL_TTL"] ?? String(DEFAULT_TTL), 10);
    if (isNaN(ttl) || ttl < MIN_TTL) ttl = MIN_TTL;
    if (ttl > MAX_TTL) ttl = MAX_TTL;

    const now = Math.floor(Date.now() / 1000);
    const expiry = now + ttl;
    const randomId = crypto.randomBytes(4).toString("hex");
    const username = `${expiry}:${randomId}`;
    // Strip the brand only at the third-party `crypto.createHmac`
    // boundary; the credential output is sent inline in the response and
    // never re-compared on the server.
    const credential = crypto
      .createHmac("sha1", unwrapSecret(turnSecret))
      .update(username)
      .digest("base64");

    const iceServers: IceServer[] = [
      {
        urls: turnUrl,
        username,
        credential,
      },
    ];

    // Under TOR_ONLY, never advertise STUN: a STUN binding request would
    // reveal each peer's public IP to a clearnet third party during ICE
    // gathering, defeating onion-only routing. The TURN relay is still
    // offered (it should be an over-Tor turns:/.onion endpoint — index.ts
    // warns at startup if it is not). See lib/torOnly.ts.
    const stunUrl = process.env["STUN_URL"];
    if (stunUrl && !isTorOnly()) {
      iceServers.unshift({ urls: stunUrl });
    }

    res.json({ iceServers, ttl, expiresAt: expiry });
  } else {
    // Fail-closed when no TURN is configured: return the configured
    // STUN_URL if present, otherwise an empty list. We deliberately do
    // NOT fall back to Google public STUN — every such call would leak
    // both peers' public IPs to a third party during ICE gathering.
    // An empty list means clients negotiate with host candidates only;
    // most cross-NAT calls will fail to connect, which is the correct
    // signal to operators that they need to configure STUN_URL and/or
    // TURN_URL. A startup banner in `index.ts` surfaces the same
    // condition for operators who never scrape logs. The structured
    // `no_turn_configured: true` field below is the primary wire-level
    // signal: clients read it and render an in-app operator banner so
    // the misconfiguration is discoverable from the running app
    // itself, not just from server logs. The empty-or-STUN-only
    // `iceServers` array remains a load-bearing fail-closed signal
    // (see #372 invariant test) but is no longer the only one.
    //
    // Under TOR_ONLY the STUN_URL is also suppressed: a STUN binding
    // request leaks each peer's public IP to a clearnet third party during
    // ICE gathering, which defeats onion-only routing just as a Google
    // fallback would. See lib/torOnly.ts.
    const stunUrl = process.env["STUN_URL"];
    const iceServers: IceServer[] =
      stunUrl && !isTorOnly() ? [{ urls: stunUrl }] : [];
    res.json({ iceServers, no_turn_configured: true });
  }
});

export default router;
