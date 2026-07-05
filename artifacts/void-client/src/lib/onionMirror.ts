// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared helper for resolving the canonical `.onion` mirror URL for
// the current deployment from the build-time `VITE_VOID_ONION_HOST`
// env var. Hostname-validated so a misconfigured value never renders
// a misleading clearnet "copy" affordance — the only thing this
// function ever returns is either `null` or an `http://<host>.onion/`
// URL. Centralised here so the start-screen helper (Task #292), the
// always-visible footer link (Task #384), and any future in-app
// surface all resolve the URL the same way and respect the same
// guards.

import { hostnameIsOnion } from "@/lib/origin";

/**
 * Return the canonical `.onion` mirror URL for this deployment, or
 * `null` if the env var is unset or the value's hostname is not a
 * `.onion`. The returned URL always uses `http://` (production
 * .onion services in our runbook run on plain HTTP — TLS terminates
 * inside the Tor network at the rendezvous point) and always ends
 * in `/`.
 */
export function getOnionMirrorUrl(): string | null {
  const raw = (import.meta.env.VITE_VOID_ONION_HOST as string | undefined)?.trim();
  if (!raw) return null;
  const stripped = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const host = stripped.split("/")[0];
  if (!hostnameIsOnion(host)) return null;
  return `http://${stripped}/`;
}
