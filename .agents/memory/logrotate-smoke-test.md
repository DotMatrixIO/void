---
name: logrotate real-rotation smoke test
description: Gotchas writing a test that runs the real logrotate binary against deploy/logrotate.d/void
---

# logrotate real-rotation smoke test

A smoke test runs the actual `logrotate` binary against the shipped
`deploy/logrotate.d/void` on a tmpdir to catch a silently-widened retention
ceiling (the application-layer string parser in `log-retention.test.ts` can't).

**How to apply / gotchas:**
- `maxage` cleanup is driven by file **mtime**, not the `dateext` date in the
  filename. Seed fake rotated files with `utimesSync` to old mtimes; naming them
  `app.log-YYYYMMDD` consistently just makes the fixture realistic.
- The shipped config has `su root root`; the test runs as non-root, so strip
  that line before running (analogous to how `security-headers-proxy.test.ts`
  rewrites the README's `proxy_pass`). Pass `-s <tmp statefile>` so it never
  touches `/var/lib/logrotate.status`, and `-f` to force rotation.
- **Substring guard pitfall:** rewriting the glob to `${logDir}/*.log` where
  `logDir` ends in `/var/log/void` means the string still *contains*
  `/var/log/void/*.log`. Don't guard with `conf.includes("/var/log/void/*.log")`
  — match a bare stanza at line start (`/^\/var\/log\/void\/\*\.log\s*\{/m`).
- logrotate is installed as a Nix system dep (`pkgs.logrotate` in replit.nix),
  so the test actually runs in CI rather than hitting the `describe.skipIf` path.
- Verified load-bearing: a widened config (`rotate 364`, `maxage 365`) leaves
  90/20/11-day files on disk → the mtime assertion fails as intended.
