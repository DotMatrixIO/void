// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { registerSocketHandlers } from "./socketHandlers";
import { performShutdown, parseDrainMs } from "./shutdown";
import { loadPersistedRoomsFromDisk, installRoomsPersistence, cleanupPersistedRoomStateSync } from "./roomsPersistence";
import { rehydratePersistedRooms } from "./rooms";
import {
  assertTurnSecretNotPlaceholder,
  PlaceholderTurnSecretError,
} from "./lib/turnSecret";
import {
  cloudflareCredsConfigured,
  tokenIdSuffix,
} from "./lib/cloudflareTurn";
import {
  assertPaywallSecretNotPlaceholder,
  assertPaywallSecretConfiguredInProduction,
  PlaceholderPaywallSecretError,
  MissingPaywallSecretError,
} from "./lib/paywallSecret";
import {
  isTorOnly,
  torOnlyStartupBanner,
  torOnlyTurnWarning,
  torOnlyCloudflareWarning,
} from "./lib/torOnly";
import { evaluateLogRetention } from "./lib/logRetention";
import {
  buildEffectiveConfigSummary,
  buildCorsMisconfigWarning,
  buildPublicOriginRejectedWarning,
  buildOnionHostnameRejectedWarning,
  buildCloudflareTurnPartialWarning,
  buildNtfyPartialWarning,
  buildNtfyServerUrlWarning,
} from "./lib/effectiveConfig";
import { startPricingRefreshers } from "./services/pricing";
import { lightningFetchTimeoutStartupLine } from "./services/lightning";
import { resolveAllowedOrigins } from "./lib/corsOrigins";

// Refuse to start if the configured TURN shared secret is one of the known
// placeholder values shipped in the example config / docs. Running with the
// placeholder turns the operator's coturn into a publicly-usable open relay.
// This check fails closed BEFORE any port is bound, so a misconfigured deploy
// produces a loud crash rather than a silently-running open relay.
try {
  assertTurnSecretNotPlaceholder(process.env["TURN_SECRET"]);
} catch (err) {
  if (err instanceof PlaceholderTurnSecretError) {
    logger.fatal(
      "FATAL: TURN secret is set to a known placeholder value. " +
        "Generate a new secret with 'openssl rand -hex 32' and set " +
        "TURN_SECRET in your environment (and the matching " +
        "static-auth-secret in coturn/turnserver.conf).",
    );
    process.exit(1);
  }
  throw err;
}

// Same shape as the TURN guard, applied to PAYWALL_SECRET. PAYWALL_SECRET is
// the HMAC key that signs host-authorization JWTs; running with a known
// placeholder lets anyone mint paid-room JWTs against the operator's server.
// We deliberately do NOT reject the unset case — `routes/paywall.ts` falls
// back to a strong ephemeral secret in that scenario, which is documented as
// the single-instance default. Placeholder values are categorically worse
// (publicly guessable HMAC key) and so are enforced here regardless.
try {
  assertPaywallSecretNotPlaceholder(process.env["PAYWALL_SECRET"]);
} catch (err) {
  if (err instanceof PlaceholderPaywallSecretError) {
    logger.fatal(
      "FATAL: PAYWALL_SECRET is set to a known placeholder value. " +
        "Generate a new secret with 'openssl rand -hex 32' and set " +
        "PAYWALL_SECRET in your environment, or unset it to use the " +
        "ephemeral per-process default.",
    );
    process.exit(1);
  }
  throw err;
}

// Production-posture refusal (Task #1143): an UNSET PAYWALL_SECRET makes
// `routes/paywall.ts` mint a fresh ephemeral secret each process start,
// which silently invalidates every outstanding host JWT and every 4-word
// recovery code on restart — paying hosts lose their rooms with no error.
// Fine for dev/preview; never an acceptable accidental default in
// production. Same fail-closed-before-bind shape as the TURN guard, with an
// explicit opt-out (PAYWALL_ALLOW_EPHEMERAL_SECRET=1) for the legitimate
// single-instance demo case.
try {
  assertPaywallSecretConfiguredInProduction(
    process.env["PAYWALL_SECRET"],
    process.env["NODE_ENV"],
    process.env["PAYWALL_ALLOW_EPHEMERAL_SECRET"],
  );
} catch (err) {
  if (err instanceof MissingPaywallSecretError) {
    logger.fatal(
      "FATAL: NODE_ENV is production but PAYWALL_SECRET is not set. " +
        "Without a stable secret, every restart invalidates all paid-room " +
        "tokens and recovery codes. Generate one with 'openssl rand -hex 32' " +
        "and set PAYWALL_SECRET, or set PAYWALL_ALLOW_EPHEMERAL_SECRET=1 to " +
        "explicitly accept ephemeral per-process secrets.",
    );
    process.exit(1);
  }
  throw err;
}

// Loud fail-closed banner when TURN_URL is not set. In this
// configuration `GET /api/ice-servers` returns either an empty list
// (no STUN either) or STUN-only, and clients negotiate with
// host/srflx candidates only — most cross-NAT calls will silently
// fail to connect. We refuse to fall back to public (Google) STUN
// because doing so would leak both peers' public IPs to a third
// party on every call.
//
// A single WARN line is easy to miss in a busy log; operators have
// reported "VOID is broken for some of my users" when the real cause
// is just an unconfigured TURN. The boxed multi-line banner below is
// deliberately hard to overlook, names the user-visible consequence
// in plain language, and points at the README section to fix it.
// The matching `no_turn_configured: true` field on `/api/ice-servers`
// surfaces the same condition to the running client app, so an
// operator who never reads logs still sees it in the room UI.
if (cloudflareCredsConfigured()) {
  const id = process.env["CLOUDFLARE_TURN_TOKEN_ID"] ?? "";
  logger.info(
    `ICE: Cloudflare TURN configured (token …${tokenIdSuffix(id)})`,
  );
} else if (!process.env["TURN_URL"]) {
  const stunSuffix = process.env["STUN_URL"]
    ? "STUN_URL is set, but without TURN, symmetric NAT and restrictive firewalls will not connect."
    : "Neither STUN_URL nor TURN_URL is set; ICE gathering will degrade to host candidates only.";
  const banner = [
    "",
    "==============================================================================",
    "  ICE / TURN MISCONFIGURED — cross-NAT calls will fail",
    "------------------------------------------------------------------------------",
    `  ${stunSuffix}`,
    "  VOID will NOT fall back to public (Google) STUN — that would leak peer",
    "  IPs to a third party on every call. /api/ice-servers therefore returns",
    "  no_turn_configured: true and the client surfaces an operator banner.",
    "  To fix: configure a TURN relay (Coturn). See README-selfhost.md §4a.",
    "==============================================================================",
    "",
  ].join("\n");
  logger.warn(banner);
}

// Tor-only posture (TOR_ONLY=1). Print the active-posture banner so the
// operator can confirm onion-only routing is in force from the logs, and
// warn if TURN_URL is configured but does not look like an over-Tor
// (turns:/.onion) relay. The matching STUN-fallback suppression lives in
// routes/ice-servers.ts; see lib/torOnly.ts for the rationale.
if (isTorOnly()) {
  logger.warn(torOnlyStartupBanner());
  const turnWarning = torOnlyTurnWarning(process.env["TURN_URL"]);
  if (turnWarning) {
    logger.warn(turnWarning);
  }
  // The Cloudflare-TURN branch takes precedence over TURN_URL, so it gets its
  // own warning: even with STUN suppressed, the Cloudflare relay terminates on
  // a clearnet edge and relayed call metadata still transits a third party
  // off-Tor. See lib/torOnly.ts (torOnlyCloudflareWarning) for the decision to
  // warn rather than hard-refuse.
  const cloudflareWarning = torOnlyCloudflareWarning(cloudflareCredsConfigured());
  if (cloudflareWarning) {
    logger.warn(cloudflareWarning);
  }
}

// Verify the operator's effective log-retention ceiling against the value
// VOID publishes to users ("What we log" on /why names ≤5 days). The check
// is opt-in: it does nothing unless the operator set LOG_RETENTION_MAX_DAYS
// or LOGROTATE_CONFIG_PATH. When they have, a retention longer than the
// published ceiling — a box that silently keeps logs for a year still
// serving the "≤5 days" claim on its own /why page — fires a loud WARN.
// See lib/logRetention.ts and README-selfhost.md §8.
{
  const logRetention = evaluateLogRetention();
  if (logRetention.warning) {
    logger.warn(logRetention.warning);
  }
}

// Confirm the effective Lightning backend fetch timeout from the logs on
// every boot. LIGHTNING_FETCH_TIMEOUT_MS (Task #276) is clamped to
// [1000, 30000] ms with a fallback-to-default on invalid input, and those
// adjustments otherwise happen silently except for a one-line warn on bad
// input. Printing the resolved value here — and noting when it was clamped
// or fell back — lets a self-hoster verify their override took effect, the
// same way the ICE/TURN and TOR_ONLY lines confirm their posture. See
// services/lightning.ts and README-selfhost.md §4b.
logger.info(lightningFetchTimeoutStartupLine());

// Consolidated "effective configuration" summary (Task #944). The individual
// lines above stay — they are intentionally loud about specific
// misconfigurations — but operators previously had to scrape several of them
// to confirm a whole deploy. This single boxed banner reports the effective,
// post-clamp/post-fallback values for the main operator knobs (mode, TOR_ONLY,
// ICE/TURN posture, Lightning backend + timeout, log retention, and the
// presence — never the value — of the TURN/paywall secrets) so a self-hoster
// can verify the running configuration in one glance. See lib/effectiveConfig.ts
// and README-selfhost.md §4f.
logger.info(buildEffectiveConfigSummary());

// Split-origin misconfiguration guard (Task: warn when the fail-closed CORS
// allowlist is empty while SERVE_STATIC is unset). In that posture the client
// must live on another origin, and with no allowlist entries every one of its
// requests is silently blocked by the browser. The effective-config summary
// above already prints the resolved allowlist; this banner makes the likely
// misconfiguration impossible to miss. See lib/effectiveConfig.ts and
// README-selfhost.md §5 (PUBLIC_ORIGIN).
{
  const corsWarning = buildCorsMisconfigWarning();
  if (corsWarning) {
    logger.warn(corsWarning);
  }
}

// PUBLIC_ORIGIN rejection guard (Task: tell self-hosters when PUBLIC_ORIGIN
// is malformed instead of silently ignoring it). resolveAllowedOrigins()
// drops a malformed or non-http(s) PUBLIC_ORIGIN rather than widening the
// allowlist; without this banner the only symptom is the generic
// empty-allowlist warning above, which does not say WHY. This one names the
// rejected value and the expected shape (https://host). See
// lib/effectiveConfig.ts and README-selfhost.md §5.
{
  const publicOriginWarning = buildPublicOriginRejectedWarning();
  if (publicOriginWarning) {
    logger.warn(publicOriginWarning);
  }
}

// ONION_HOSTNAME rejection guard (Task #1128: tell self-hosters when their
// onion address is invalid instead of silently ignoring it). Same failure
// mode as PUBLIC_ORIGIN above: resolveAllowedOrigins() drops a value that
// fails isValidOnionHostname(), and app.ts stops emitting the Onion-Location
// header — the operator believes the Tor mirror is wired up while it is
// invisible everywhere. This banner names the rejected value and the
// expected v3 shape (56 base32 chars + .onion). See lib/effectiveConfig.ts.
{
  const onionWarning = buildOnionHostnameRejectedWarning();
  if (onionWarning) {
    logger.warn(onionWarning);
  }
}

// Half-configured Cloudflare TURN guard: with only one of
// CLOUDFLARE_TURN_TOKEN_ID / CLOUDFLARE_TURN_API_TOKEN set, the pair is
// silently treated as unconfigured and the server falls back to the next ICE
// branch. Names the missing variable — never any value.
{
  const cloudflareWarning = buildCloudflareTurnPartialWarning();
  if (cloudflareWarning) {
    logger.warn(cloudflareWarning);
  }
}

// Half-configured ntfy alerting guard: NTFY_SERVER and/or NTFY_TOKEN set
// while NTFY_TOPIC is not means publishNtfy() is a silent no-op — the
// operator believes alerting is on while every alert is dropped. Names only
// variable NAMES (topic and token are secrets).
{
  const ntfyWarning = buildNtfyPartialWarning();
  if (ntfyWarning) {
    logger.warn(ntfyWarning);
  }
}

// Malformed NTFY_SERVER guard: publishNtfy() swallows fetch errors by design,
// so a server URL that cannot work (missing scheme, wrong scheme) fails
// silently at alert time. The server URL is not a secret and is echoed;
// topic/token are never echoed.
{
  const ntfyServerWarning = buildNtfyServerUrlWarning();
  if (ntfyServerWarning) {
    logger.warn(ntfyServerWarning);
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

const ALLOWED_ORIGINS = resolveAllowedOrigins();

// CodeQL #11: same fail-closed rule as the Express cors middleware in
// app.ts — never reflect arbitrary origins; same-origin Socket.io
// connections (the default self-host layout) are not CORS requests.
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : false,
    methods: ["GET", "POST"],
  },
  path: "/api/socket.io",
  maxHttpBufferSize: 10_000,
});

registerSocketHandlers(io);

// Task #310: rehydrate any persisted rooms BEFORE starting to accept
// socket connections. A late joiner who reaches the server during the
// first second after restart will then find the room already in
// memory and can join without the host having to re-pay. The persist
// hook installed below then keeps the on-disk file in sync with any
// new mutations.
try {
  const persisted = loadPersistedRoomsFromDisk();
  const rehydrated = rehydratePersistedRooms(persisted);
  if (rehydrated > 0) {
    logger.warn({ rehydrated }, "Rehydrated persisted rooms after restart");
  }
  // Task #339: rewrite (or delete) the on-disk snapshot so it reflects
  // only the rooms actually rehydrated. After an outage longer than the
  // longest TTL every persisted record is already expired; rehydrate
  // drops them from memory but never rewrites the file, so without this
  // the stale (and potentially large) snapshot would sit on disk until
  // the next live mutation.
  cleanupPersistedRoomStateSync();
} catch (err) {
  logger.warn({ err }, "Failed to rehydrate persisted rooms; starting empty");
}
const persistence = installRoomsPersistence();

// Begin the background CPI / BTC-USD refresh loop. The resolver is sync
// and reads the last-known-good cached values, so invoice requests never
// block on the network even on a cold cache (they fall back to the
// per-tier defaults defined in services/pricing.ts).
startPricingRefreshers();

httpServer.listen(port, () => {
  logger.warn({ port }, "Server listening");
});

// Graceful shutdown — see shutdown.ts for the full sequence
// and rationale. Kept as a thin wrapper so the helper itself can be
// unit-tested without importing this module (which would call
// process.exit at module load time).
const SHUTDOWN_DRAIN_MS = parseDrainMs(process.env["SHUTDOWN_DRAIN_MS"]);

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  void performShutdown({
    io,
    httpServer,
    drainMs: SHUTDOWN_DRAIN_MS,
    signal,
    onBeforeClearTimers: () => persistence.flushSync(),
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
