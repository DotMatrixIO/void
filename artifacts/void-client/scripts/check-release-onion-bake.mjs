#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-release-onion-bake.mjs
 *
 * Fails (exit 1) if any production build of the void-client in the release
 * pipeline forgets to bake in the canonical `.onion` address.
 *
 * Why this guard exists
 * ---------------------
 * The signed release only stays reproducible AND Tor-reachable if the SAME
 * canonical `.onion` address (`VITE_VOID_ONION_HOST`) is injected into EVERY
 * production build site in `.github/workflows/release.yml`:
 *
 *   1. the pnpm void-client build            (job: build-and-sign)
 *   2. the Docker image build's frontend stage (job: build-and-sign)
 *   3. the clean-room reproducibility rebuild  (job: reproducibility-check)
 *   4. the arm64 rebuild                        (job: reproducibility-check-arm64)
 *
 * Under NODE_ENV=production the void-client build turns ON the fail-closed
 * onion-bake guard (artifacts/void-client/vite.config.ts -> assertOnionBake).
 * These four build sites are kept in lockstep BY HAND today. If a future edit
 * drops the variable from one of them, either:
 *
 *   - the release fails closed (missing onion — annoying but safe), or
 *   - WORSE, the reproducibility diff fails for the WRONG reason: one build
 *     baked the onion and another did not, so the byte-for-byte diff diverges
 *     and reads as "the verifiable-build claim is broken" when it is not.
 *
 * Nothing else catches this. This guard parses release.yml, finds every step
 * that builds the void-client at NODE_ENV=production, and asserts each one
 * injects `VITE_VOID_ONION_HOST` (as an `env:` value for the pnpm builds, or a
 * Docker `build-args` entry for the image build) and that every one references
 * the IDENTICAL source: the `${{ vars.VITE_VOID_ONION_HOST }}` repo variable.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:release-onion-bake
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

const RELEASE_YML = ".github/workflows/release.yml";
const DOCKERFILE = "Dockerfile";

// The known number of production void-client build sites kept in lockstep.
// This is a drift tripwire: if the detector suddenly matches FEWER than this,
// it usually means a build step was renamed/refactored so the detector no
// longer recognises it (a silent vacuous pass), not that the invariant is
// actually satisfied. If you intentionally add or remove a production build
// site, update this constant in the same change.
const EXPECTED_BUILD_SITES = 4;

// The one canonical source every production build must reference. Whitespace
// inside the `${{ ... }}` is normalised before comparison.
const CANONICAL_SOURCE = "${{ vars.VITE_VOID_ONION_HOST }}";

// Marker that identifies a void-client production build command.
const VOID_CLIENT_BUILD = "@workspace/void-client run build";

const errors = [];

function readOrDie(relPath) {
  const abs = resolve(REPO_ROOT, relPath);
  if (!existsSync(abs)) {
    console.error(
      `Release onion-bake check FAILED.\n\n` +
        `Required file is missing: ${relPath}\n` +
        `  fix: restore ${relPath}, or update ` +
        `artifacts/void-client/scripts/check-release-onion-bake.mjs if it moved.`,
    );
    process.exit(1);
  }
  return readFileSync(abs, "utf8");
}

/**
 * Split a GitHub Actions workflow into step blocks. Every step in
 * release.yml begins with a `- name:` list item at 6-space indentation; the
 * block runs until the next such line (or EOF). Deeper-indented content
 * (env:, run: heredocs, build-args, etc.) stays inside its step.
 */
function splitIntoSteps(yml) {
  const lines = yml.split("\n");
  const stepStart = /^ {6}- name: (.+)$/;
  const steps = [];
  let current = null;
  for (const line of lines) {
    const m = stepStart.exec(line);
    if (m) {
      if (current) steps.push(current);
      current = { name: m[1].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) steps.push(current);
  return steps.map((s) => ({ name: s.name, text: s.lines.join("\n") }));
}

/** Normalise `${{  vars.X  }}` whitespace so comparison is robust. */
function normalizeExpr(value) {
  return value.replace(/\$\{\{\s*/g, "${{ ").replace(/\s*\}\}/g, " }}").trim();
}

/**
 * Extract the RHS of a `KEY: value` env line or a `KEY=value` build-arg line
 * for the onion var, if present in the step text. Returns the raw value
 * string, or null if the var does not appear at all.
 */
function extractOnionValue(stepText) {
  // env form:        VITE_VOID_ONION_HOST: ${{ vars.VITE_VOID_ONION_HOST }}
  const envMatch = stepText.match(/^\s*VITE_VOID_ONION_HOST:\s*(.+?)\s*$/m);
  if (envMatch) return { form: "env", value: envMatch[1] };
  // build-arg form:  VITE_VOID_ONION_HOST=${{ vars.VITE_VOID_ONION_HOST }}
  const argMatch = stepText.match(/^\s*VITE_VOID_ONION_HOST=(.+?)\s*$/m);
  if (argMatch) return { form: "build-arg", value: argMatch[1] };
  return null;
}

/** Does this step set NODE_ENV to a value other than production? */
function nodeEnvIsNonProduction(stepText) {
  // env form (pnpm builds): NODE_ENV: development
  const envMatch = stepText.match(/^\s*NODE_ENV:\s*(.+?)\s*$/m);
  if (envMatch) return envMatch[1].trim() !== "production";
  // build-arg form (docker): NODE_ENV=development
  const argMatch = stepText.match(/^\s*NODE_ENV=(.+?)\s*$/m);
  if (argMatch) return argMatch[1].trim() !== "production";
  return false; // absent -> production (explicit env line or Dockerfile default)
}

function assertOnionInjected(step, siteLabel) {
  const found = extractOnionValue(step.text);
  if (!found) {
    errors.push(
      `Production build site is MISSING the onion bake: "${step.name}"\n` +
        `  site: ${siteLabel}\n` +
        `  This step builds the void-client at NODE_ENV=production but does not\n` +
        `  set VITE_VOID_ONION_HOST. The build will fail closed (missing onion)\n` +
        `  or — worse — bake a DIFFERENT bundle than the other build sites, which\n` +
        `  makes the reproducibility diff fail for the wrong reason.\n` +
        `  fix: add VITE_VOID_ONION_HOST=${CANONICAL_SOURCE} (build-arg) or\n` +
        `       VITE_VOID_ONION_HOST: ${CANONICAL_SOURCE} (env) to this step.`,
    );
    return;
  }
  if (normalizeExpr(found.value) !== normalizeExpr(CANONICAL_SOURCE)) {
    errors.push(
      `Production build site references the WRONG onion source: "${step.name}"\n` +
        `  site: ${siteLabel}\n` +
        `  found (${found.form}): VITE_VOID_ONION_HOST -> ${found.value}\n` +
        `  All production build sites must reference the SAME canonical source,\n` +
        `  ${CANONICAL_SOURCE}, or the bundles diverge and the reproducibility\n` +
        `  diff breaks for the wrong reason.\n` +
        `  fix: change the value to ${CANONICAL_SOURCE}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Confirm the guard's premise about the Dockerfile still holds: the image
//    build compiles the void-client in its frontend stage, defaults NODE_ENV
//    to production, and consumes VITE_VOID_ONION_HOST as a build-arg. If any
//    of these change, the "the Docker build is a production void-client build"
//    assumption below is no longer safe and a human must revisit this guard.
// ---------------------------------------------------------------------------
const dockerfile = readOrDie(DOCKERFILE);
const dockerPremises = [
  {
    ok: /ARG NODE_ENV=production/.test(dockerfile),
    msg: "Dockerfile no longer defaults `ARG NODE_ENV=production`",
  },
  {
    ok: /ARG VITE_VOID_ONION_HOST/.test(dockerfile),
    msg: "Dockerfile no longer declares `ARG VITE_VOID_ONION_HOST`",
  },
  {
    ok: dockerfile.includes(VOID_CLIENT_BUILD),
    msg: `Dockerfile frontend stage no longer runs \`${VOID_CLIENT_BUILD}\``,
  },
];
for (const p of dockerPremises) {
  if (!p.ok) {
    errors.push(
      `Dockerfile premise broken: ${p.msg}\n` +
        `  This guard assumes the Docker image build compiles the void-client at\n` +
        `  NODE_ENV=production (so it must receive VITE_VOID_ONION_HOST). That\n` +
        `  assumption no longer holds. Revisit\n` +
        `  artifacts/void-client/scripts/check-release-onion-bake.mjs before\n` +
        `  changing the Dockerfile's build shape.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Walk every step in release.yml and enforce the onion bake on each
//    production void-client build site (pnpm build or Docker image build).
// ---------------------------------------------------------------------------
const releaseYml = readOrDie(RELEASE_YML);
const steps = splitIntoSteps(releaseYml);

let buildSites = 0;
for (const step of steps) {
  const buildsVoidClient = step.text.includes(VOID_CLIENT_BUILD);
  const isDockerBuild = /uses:\s*docker\/build-push-action/.test(step.text);

  // A production build site is either a step that directly runs the
  // void-client build, or the Docker image build (whose frontend stage runs
  // it). Either way we skip it when NODE_ENV is explicitly non-production
  // (the onion guard relaxes there, e.g. a clearnet-only dev image).
  if (!buildsVoidClient && !isDockerBuild) continue;
  if (nodeEnvIsNonProduction(step.text)) continue;

  const siteLabel = isDockerBuild
    ? "Docker image build (frontend stage rebuilds void-client at production)"
    : "pnpm void-client production build";

  assertOnionInjected(step, siteLabel);
  buildSites += 1;
}

// ---------------------------------------------------------------------------
// 3. Tripwire: if the detector recognised fewer sites than we know exist, the
//    heuristic has probably gone stale (a build step was renamed so it no
//    longer matches), which would let a real gap slip through as a vacuous
//    pass. Fail loudly and ask a human to reconcile.
// ---------------------------------------------------------------------------
if (buildSites < EXPECTED_BUILD_SITES) {
  errors.push(
    `Detected only ${buildSites} production void-client build site(s) in ` +
      `${RELEASE_YML}, expected at least ${EXPECTED_BUILD_SITES}.\n` +
      `  This usually means a build step was renamed or refactored so this\n` +
      `  guard no longer recognises it — which would let a missing onion bake\n` +
      `  pass silently. Reconcile the detector (or the EXPECTED_BUILD_SITES\n` +
      `  constant) in artifacts/void-client/scripts/check-release-onion-bake.mjs.`,
  );
}

// ---------------------------------------------------------------------------
if (errors.length === 0) {
  console.log(
    `Release onion-bake check passed: ${buildSites} production void-client ` +
      `build site(s) in ${RELEASE_YML} all inject VITE_VOID_ONION_HOST from ` +
      `${CANONICAL_SOURCE}.`,
  );
  process.exit(0);
}

console.error("Release onion-bake check FAILED.\n");
for (const err of errors) {
  console.error(err);
  console.error("");
}
console.error(
  `${errors.length} issue(s) detected. Every production build of the ` +
    `void-client in ${relative(REPO_ROOT, resolve(REPO_ROOT, RELEASE_YML))} ` +
    `must bake in ${CANONICAL_SOURCE}. See the release.yml header comment for ` +
    `the rationale (Onion bake — Option A).`,
);
process.exit(1);
