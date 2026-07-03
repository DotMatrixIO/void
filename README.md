# VOID

Ephemeral, privacy-first peer-to-peer video conferencing.

VOID rooms hold up to 4 humans on real-time WebRTC, with no accounts, no
database rows, and no persistent user content on the server.

## Repository Layout

This is a pnpm monorepo.

```
artifacts/
  void-client/        # The PWA users open in the browser (React + Vite)
  api-server/         # Signaling, paywall, and room lifecycle API
  mockup-sandbox/     # Component preview server used during design work
lib/
  api-spec/           # OpenAPI spec for the signaling API
  api-zod/            # Zod schemas generated from the spec
  api-client-react/   # React Query client generated from the spec
  signaling-types/    # Shared signaling event types
coturn/               # Coturn config for self-hosted TURN
scripts/, tools/      # Dev/release tooling
docs/                 # Detailed engineering and security documentation
```

## Quick Start (Development)

Prerequisites: Node 22 (see `.nvmrc` and `engines` in `package.json`), pnpm 10.

```sh
pnpm install
pnpm run typecheck
```

Each artifact has its own workflow / dev script. The most common ones:

```sh
pnpm --filter @workspace/api-server run dev      # signaling + paywall API
pnpm --filter @workspace/void-client run dev     # the browser client
```

On Replit, these run as named workflows (`artifacts/api-server: API Server`,
`artifacts/void-client: web`, etc.) and bind to the per-artifact `PORT`
provided by the environment.

## Common Scripts

| Script                                              | Purpose                                  |
| --------------------------------------------------- | ---------------------------------------- |
| `pnpm run build`                                    | Typecheck the whole repo, then build every package with a `build` script |
| `pnpm run typecheck`                                | Library typecheck (project references) + per-artifact typecheck |
| `pnpm run lint`                                     | ESLint over the workspace                |
| `pnpm --filter @workspace/api-server run test`      | API server unit & integration tests      |
| `pnpm --filter @workspace/void-client run test`     | Client unit tests (Vitest)               |

## Documentation

- [`README-selfhost.md`](README-selfhost.md) — full self-hosting guide (HTTPS,
  Coturn, paywall, environment variables).
- [`VOID_TECHNICAL_OVERVIEW.md`](VOID_TECHNICAL_OVERVIEW.md) — architecture
  reference for the client, API, and transport.
- [`VOID-Feature-Policy.md`](VOID-Feature-Policy.md) — what's in scope and
  what's deliberately out of scope.
- [`docs/discipline-timeline.md`](docs/discipline-timeline.md) — a dated,
  chronological record of every structural CI gate, proving the project's
  engineering discipline was enforced longitudinally rather than bolted on at
  the end.
- [`docs/`](docs/) — deeper engineering notes (security audits, protocol
  design, operational runbooks).

## Configuration

A development checkout runs with no external accounts. Two defaults matter:

- **The paywall is mocked by default.** `LIGHTNING_BACKEND` defaults to `mock`,
  so the API server starts and rooms work without a real Lightning node or any
  payment credentials. Point it at a real backend only when you are running a
  production instance that charges for rooms.
- **Never commit `turnserver.conf`.** Self-hosting TURN means copying
  `coturn/turnserver.conf.example` to `coturn/turnserver.conf` and filling in
  your own `static-auth-secret`. That file is gitignored and the API server
  refuses to start with the example placeholder — keep your real secret out of
  version control. The same rule applies to any `.env`: copy the example, fill
  in your own copy, leave it untracked.

The full environment-variable list, HTTPS/Coturn/paywall setup, and the
production checklist are in [`README-selfhost.md`](README-selfhost.md).

## Status & versioning

VOID is pre-1.0. The current target is an open beta (`v0.6`).
The package manifest (`manifest.yaml`) carries its own package version, which
moves on its own schedule and is not the product version.

The exact commit a running instance is built from is shown at `/proof/runtime`
and `/api/proof/build` — that SHA, not a version string, is the precise answer
to "what is this instance running." AGPLv3 §13 requires a running service to
offer its corresponding source; the client footer links to the source
repository — <https://github.com/DotMatrixIO/void> — for that reason.

### Public history starts at the v0.x baseline

This public repository begins from a single squashed baseline commit rather
than the project's full pre-release development history. That is deliberate,
not a mistake: a pre-launch full-history secret scan found a real credential
committed to a Replit-platform config file, so the project published from a
clean baseline that never contained it rather
than rewriting history in place (cached host commit indexes can keep scrubbed
values reachable). The omitted history is internal development scratch; every
load-bearing claim VOID makes — the threat model, the reproducible build, the
signaling-envelope audit, the runtime posture attestation at
`/api/proof/posture` — is fully checkable against the published tree.

## Development & AI assistance

VOID was developed with substantial AI assistance under the maintainer's
architectural direction. The maintainer (DotMatrixIO) owns the design, the
threat model, the security decisions, and the final form of every line that
ships; AI coding tools were used heavily to draft, refactor, and document
under that direction. We disclose this plainly because honesty about how a
privacy tool is built is part of being trustworthy — and because it is a
publication requirement of the project's funders. Nothing in the security
posture rests on trusting that disclosure: every load-bearing claim is
checkable against the published tree (the threat model, the reproducible
build, the signaling-envelope audit, the `/api/proof/posture` attestation),
which is the point.

Security disclosures and contact: see [`SECURITY.md`](SECURITY.md).

## License

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later) — see
[`LICENSE`](LICENSE).

VOID is a privacy tool. The AGPL is a deliberate choice: its network-use
copyleft (§13) means anyone who runs a modified copy as a service must offer
that service's users the corresponding source. A permissive license would let
the privacy properties be quietly stripped and re-shipped as a closed SaaS;
the AGPL keeps every deployed fork honest and inspectable.
