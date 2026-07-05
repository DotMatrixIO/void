// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";

// /api/provenance.json — build provenance surface (task #491 / M-6).
//
// Reports the build-time provenance for the bundle this server is
// currently serving: the commit it was built from, when it was built,
// who built it, and the SHA-384 SRI digest of every asset under
// /assets/ in the void-client bundle (the same digests stamped into
// the served `index.html` by add-sri.mjs at build time).
//
// Pairs with /api/proof/build (sha256 across the whole bundle, served
// at max-age=300). This endpoint is the *SRI-vs-served-HTML* cross-
// check: a verifier can fetch `index.html`, extract every
// `integrity="sha384-..."` attribute, fetch this endpoint, and
// confirm the two sets agree — and that both agree with the SRI
// digests in `provenance.json` published as a release asset for the
// same `commit`. A CDN MITM that swapped both `index.html` and the
// referenced assets without also rewriting this response would be
// detectable.
//
// Cache-Control matches `/api/openapi.yaml` (public, max-age=3600)
// per the task spec — provenance for a given commit is immutable.
//
// The file is written by `artifacts/api-server/build.mjs` at build
// time and copied alongside dist/ by the Dockerfile, same lookup
// strategy as BUILD_INFO.json. Dev builds produce a placeholder so
// the route never 500s.

interface Provenance {
  schemaVersion: number;
  commit: string;
  builtAt: string;
  builder: string;
  sriDigests: Record<string, string>;
  releaseTag: string | null;
  caveat: string;
}

function locateProvenance(): Provenance | null {
  const candidates = [
    path.resolve(process.cwd(), "provenance.json"),
    path.resolve(process.cwd(), "dist", "provenance.json"),
    path.resolve(
      process.cwd(),
      "artifacts",
      "api-server",
      "dist",
      "provenance.json",
    ),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8")) as Provenance;
      } catch {
        // Malformed JSON on disk → placeholder so the endpoint never 500s.
      }
    }
  }
  return null;
}

const provenance: Provenance = locateProvenance() ?? {
  schemaVersion: 1,
  commit: "unknown",
  builtAt: "unknown",
  builder: "local-dev",
  sriDigests: {},
  releaseTag: null,
  caveat:
    "provenance.json was not generated for this build (dev mode). " +
    "Production releases populate commit, builtAt, builder, and sriDigests; " +
    "see .github/workflows/release.yml. Even with full provenance, an edge " +
    "attacker can rewrite both the bundle and this response on a single " +
    "network path — cross-verify by fetching from a second network path and " +
    "by comparing against the cosign-signed provenance.json release asset.",
};

const router: IRouter = Router();

router.get("/provenance.json", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(provenance);
});

export default router;
export { provenance as _provenanceForTest };
