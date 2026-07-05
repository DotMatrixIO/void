# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **Relicensed the entire monorepo to AGPL-3.0-or-later.** The repository
  previously carried conflicting signals — the UI footer and product framing
  pointed at the GNU AGPL, while the root `package.json` and `manifest.yaml`
  declared MIT and no `LICENSE` file existed. AGPLv3 is now the single
  authoritative license:
  - Added a root `LICENSE` file with the verbatim GNU Affero General Public
    License v3.0 text.
  - Set `license` to `AGPL-3.0-or-later` in the root `package.json` and in
    `manifest.yaml`.
  - Applied `SPDX-License-Identifier: AGPL-3.0-or-later` headers to first-party
    source files across `artifacts/`, `lib/`, `scripts/`, and `tools/`.
    Generated/codegen output and vendored files are excluded; the
    `artifacts/biometric-demo-video` scene sources are also excluded because a
    comment-only edit there would spuriously trip the byte-exact
    biometric-video drift guard without changing the rendered video.
  - Updated the README license section and added an AGPL §13 (network use)
    note in the client footer alongside the existing source / self-host link
    and build-provenance affordance.

  The project is solo-authored, so the relicense applies cleanly with no
  third-party copyright to reconcile. `umbrel-app.yml` is left unchanged — the
  Umbrel app manifest schema (manifestVersion 1) defines no `license` field, so
  adding one risks store validation failure; the AGPLv3 grant is carried by the
  root `LICENSE`, `package.json`, and `manifest.yaml`.
