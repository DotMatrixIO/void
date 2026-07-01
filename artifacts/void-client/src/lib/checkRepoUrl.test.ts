// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The production-build guard scripts/check-repo-url.mjs is the hard safety
// net that refuses to ship a production build while REPO_URL is still the
// placeholder — without it the footer's SOURCE / SELF-HOST link is hidden
// and the running service violates AGPLv3 §13 (offer of Corresponding
// Source). These tests exercise the REAL script: they copy it into a
// throwaway directory tree next to a synthetic src/lib/repo.ts (the script
// resolves repo.ts relative to its own location), so any future edit that
// weakens the guard is caught here.

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..", "..");
const REAL_SCRIPT = resolve(CLIENT_ROOT, "scripts", "check-repo-url.mjs");
const PLACEHOLDER = "[[TO BE ADDED]]";

let workDir: string;

/**
 * Stand up a throwaway <tmp>/scripts/check-repo-url.mjs + <tmp>/src/lib/repo.ts
 * tree (mirroring the layout the real script expects), write `repoTs` as the
 * repo.ts contents, run the copied guard with `env`, and return its exit code
 * plus captured output.
 */
function runGuard(
  repoTs: string,
  env: NodeJS.ProcessEnv = {},
): { status: number | null; stdout: string; stderr: string } {
  const sandbox = mkdtempSync(resolve(workDir, "case-"));
  mkdirSync(resolve(sandbox, "scripts"), { recursive: true });
  mkdirSync(resolve(sandbox, "src", "lib"), { recursive: true });
  copyFileSync(REAL_SCRIPT, resolve(sandbox, "scripts", "check-repo-url.mjs"));
  writeFileSync(resolve(sandbox, "src", "lib", "repo.ts"), repoTs, "utf8");

  const result = spawnSync(
    process.execPath,
    [resolve(sandbox, "scripts", "check-repo-url.mjs")],
    {
      encoding: "utf8",
      // Start from a clean env so the host's NODE_ENV / REPO_URL_STRICT
      // can't leak in and flip strict mode unexpectedly.
      env: { PATH: process.env.PATH, ...env },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function repoTsWith(repoUrlRhs: string): string {
  return [
    `export const REPO_URL_PLACEHOLDER = "${PLACEHOLDER}";`,
    `export const REPO_URL: string = ${repoUrlRhs};`,
    "",
  ].join("\n");
}

describe("check-repo-url.mjs production build guard", () => {
  beforeAll(() => {
    workDir = mkdtempSync(resolve(tmpdir(), "check-repo-url-"));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("references the real guard script that runs in the build", () => {
    // Sanity: the script we copy is the one actually invoked first in the
    // void-client `build` script. If it gets renamed/moved this test (and
    // the build) must be updated in lockstep.
    const pkg = JSON.parse(
      readFileSync(resolve(CLIENT_ROOT, "package.json"), "utf8"),
    );
    expect(pkg.scripts.build).toContain("scripts/check-repo-url.mjs");
  });

  it("FAILS the build (non-zero) when REPO_URL is the placeholder in strict mode", () => {
    const result = runGuard(repoTsWith(`"${PLACEHOLDER}"`), {
      REPO_URL_STRICT: "1",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("FATAL");
  });

  it("FAILS the build (non-zero) when REPO_URL is assigned by reference to the placeholder const in strict mode", () => {
    const result = runGuard(repoTsWith("REPO_URL_PLACEHOLDER"), {
      NODE_ENV: "production",
    });
    expect(result.status).not.toBe(0);
  });

  it("FAILS the build (non-zero) when REPO_URL is empty in strict mode", () => {
    const result = runGuard(repoTsWith(`""`), { REPO_URL_STRICT: "1" });
    expect(result.status).not.toBe(0);
  });

  it("PASSES (exit zero) when REPO_URL holds a real repo-root URL", () => {
    const result = runGuard(
      repoTsWith(`"https://github.com/DotMatrixIO/void"`),
      { REPO_URL_STRICT: "1" },
    );
    expect(result.status).toBe(0);
  });

  it("PASSES (exit zero) with the placeholder outside strict mode (dev/staging)", () => {
    const result = runGuard(repoTsWith(`"${PLACEHOLDER}"`), {});
    expect(result.status).toBe(0);
  });

  it("FATAL-fails (non-zero) when REPO_URL_PLACEHOLDER is missing from repo.ts", () => {
    // If a refactor drops the placeholder const, the guard must fail loudly
    // rather than silently pass — it can no longer tell placeholder from real.
    const result = runGuard(
      `export const REPO_URL: string = "${PLACEHOLDER}";\n`,
      { REPO_URL_STRICT: "1" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("FATAL");
  });

  it("FATAL-fails (non-zero) when the REPO_URL export is missing from repo.ts", () => {
    const result = runGuard(
      `export const REPO_URL_PLACEHOLDER = "${PLACEHOLDER}";\n`,
      { REPO_URL_STRICT: "1" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("FATAL");
  });
});
