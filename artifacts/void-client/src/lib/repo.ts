// SPDX-License-Identifier: AGPL-3.0-or-later

// Sentinel value REPO_URL carries until the public source repository is
// published. Kept as a named export so the placeholder-vs-real decision
// has exactly one definition that every consumer (PageFooter, the
// production build guard in scripts/check-repo-url.mjs) agrees on.
export const REPO_URL_PLACEHOLDER = "[[TO BE ADDED]]";

// Repo-root URL of the public source repository. AGPLv3 §13 requires the
// running service to offer Corresponding Source to network users; the
// footer renders this as the SOURCE / SELF-HOST link. This can be any
// public host (Codeberg, sourcehut, self-hosted Gitea, a mirror) — not
// GitHub specifically. It must point at the repo ROOT, not a specific
// commit: the exact running build's gitSha is surfaced separately via
// /proof/runtime and /api/proof/build (the deliberate Option A split).
//
// The public source repository is published at this repo-root URL. While
// it was the placeholder, PageFooter hid the source line and the
// production build refused to ship (scripts/check-repo-url.mjs); now that
// a real URL is set, the footer renders the SOURCE / SELF-HOST link and
// the build guard passes.
// Typed as string (not the literal) so hasPublicRepo()'s comparison isn't
// statically narrowed to a constant.
export const REPO_URL: string = "https://github.com/DotMatrixIO/void";

// Positive predicate: true once REPO_URL is a real published URL. Branch
// on this single check at call sites (`{hasPublicRepo() && <SourceLink/>}`)
// rather than string-matching the sentinel across consumers.
export function hasPublicRepo(): boolean {
  return REPO_URL !== REPO_URL_PLACEHOLDER && REPO_URL.trim().length > 0;
}
