<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Contributing to VOID

VOID is a room, not a building. It is small on purpose, and it stays small on
purpose. Most "wouldn't it be great if" features are out of scope by design —
read `VOID-Feature-Policy.md` before you write code. If your idea adds
recording, transcription, file transfer, accounts, or anything that outlives
the call, the answer is almost certainly no, and the policy explains why.

This is privacy software. A change that is "nice" but quietly weakens a privacy
property is a regression, even if every test passes.

## Before you start

- Read `VOID-Feature-Policy.md`. It says what VOID is and what it refuses to
  become. This is the most common reason a PR gets closed.
- Read the relevant threat model: `docs/threat-model.md` (server) and
  `docs/client-threat-model.md` (client). If your change touches signaling,
  crypto, or what the server can see, say in your PR which threat-model
  assumption you are upholding or changing.
- Open an issue first for anything beyond a bug fix or a typo. A rejected PR
  costs more than a rejected paragraph.

## Setup

Prerequisites: Node 22 (see `.nvmrc` and `engines` in `package.json`),
pnpm 10.

```sh
pnpm install
pnpm run typecheck
pnpm run lint
```

This is a pnpm monorepo. `README.md` has the layout and the per-package dev
scripts.

## The rules that CI enforces (so check them locally first)

These are not style preferences. They are gates. CI will fail on them, so run
them before you push:

- **Typecheck and lint.** `pnpm run typecheck` and `pnpm run lint`.
- **Tests for what you touched.** e.g.
  `pnpm --filter @workspace/void-client run test`,
  `pnpm --filter @workspace/api-server run test`.
- **Generated code is generated, not hand-edited.** The OpenAPI spec is the
  source of truth; the Zod schemas and the React Query client are generated
  from it. If you change the API, change the spec and regenerate — do not edit
  the generated files. The spec-drift checks will catch a mismatch.
- **Marketing/voice copy.** User-facing and operator-facing copy (client
  pages, OG metadata, `index.html`, `manifest.yaml`, `umbrel-app.yml`,
  `README-selfhost.md`) is checked for banned marketing words and required
  phrases. See "Voice" below. Run
  `pnpm --filter @workspace/void-client run check:phrases`.
- **No secrets.** A history secret scan runs before release. Never commit a
  real key, a `turnserver.conf`
  with a real static-auth-secret, or a filled-in `.env`. Copy the `.example`
  file and fill in your own copy, which stays untracked.

## Voice

VOID's copy is plain and concrete. It admits limits instead of hiding them. The
reference line is "the room burns down": short, true, no adjectives doing the
work that facts should do.

Banned words on user-facing copy (enforced):
"powerful", "seamless", "robust", "sovereignty-first", "best-in-class",
"next-generation", "world-class", "we're committed to", and Tor-reachability
overclaims ("Tor-by-default", "Tor-routed" — VOID's signaling can be fronted by
a hidden service, but WebRTC media still gathers ICE on the user's network, so
do not claim end-to-end Tor). The canonical list lives in
`banned-phrases.mjs`.

If you must use a banned word for a legitimate technical reason (e.g. quoting
the list), add a `banned-phrase-allow:` marker with a reason on that line.

## Pull requests

- One change per PR. A bug fix and a refactor in the same PR get reviewed at
  the speed of the slower half.
- Say what threat-model or feature-policy assumption your change rests on.
- Keep the diff honest: no drive-by reformatting of files you did not
  otherwise touch.
- New first-party source files carry the SPDX header
  `SPDX-License-Identifier: AGPL-3.0-or-later`.

## License of contributions

VOID is licensed under AGPL-3.0-or-later. By contributing, you agree your
contribution is licensed under the same terms. There is no CLA.

## Security issues

Do not open a public issue for a vulnerability. See `SECURITY.md`.
