<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Security policy

VOID is a privacy tool. A vulnerability here can deanonymize a call or expose
content that the whole design promises will never be stored. Please treat
reports accordingly.

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for a security
problem.** A public report is a disclosure, and disclosure before a fix puts
every running deployment at risk.

Please use a private channel:

- **Preferred:** GitHub's private vulnerability reporting — the "Report a
  vulnerability" button under this repository's **Security** tab. This opens a
  private advisory visible only to the maintainers and you.
- **Email:** `dot_matrix_apps@proton.me` — the dedicated DotMatrixIO security
  contact. Use this if you cannot or prefer not to use GitHub, or to make
  first contact before sharing details.

### Encrypting your report (optional but preferred)

Encryption is optional, but preferred for anything sensitive — a working
proof of concept, an exploit chain, or details that would harm users if they
leaked before a fix. Encrypt to the DotMatrixIO security contact key:

- **Fingerprint:** `836B F5D8 8581 B7F4 6F57  E38B 595B 3235 2423 2AD7`
- **User ID:** `dot_matrix_apps@proton.me`
- **Public key:** committed to this repository as
  [`security-contact.asc`](security-contact.asc). You can also fetch it from
  the keyserver:

  ```sh
  curl -s "https://api.protonmail.ch/pks/lookup?op=get&search=dot_matrix_apps@proton.me" | gpg --import
  ```

Always verify the fingerprint above against the key you import before
encrypting. If you cannot encrypt, send the report in the clear rather than
not reporting at all — make first contact and we can arrange a secure
channel.

When you report, please include:

- What the issue is and the impact you think it has (e.g. "the server can
  recover X", "peer A can deanonymize peer B").
- The steps to reproduce, or a proof of concept.
- The commit SHA or release tag you tested. The running build's SHA is shown at
  `/proof/runtime` and `/api/proof/build`.
- Whether you have disclosed it anywhere else.

## What to expect

This is a small project; please be patient.

- We aim to acknowledge a report within a few days.
- We will keep you updated as we work on a fix, and credit you when it ships
  unless you ask us not to.

## Scope

In scope: anything that breaks a property VOID claims — the server learning
call content, a peer deanonymizing another, persistence of something promised
ephemeral, the paywall or signaling being bypassable in a way that harms users,
or the reproducible-build / source-link claims (AGPLv3 §13) being false.

The threat models define the assumptions precisely:

- `docs/threat-model.md` — the server and signaling.
- `docs/client-threat-model.md` — the browser client.

Likely out of scope: issues that require a malicious operator on their own
self-hosted instance (the operator already controls that deployment), or
attacks that assume a property VOID never claimed. The feature policy
(`VOID-Feature-Policy.md`) and the threat models are the reference for what is
promised.

## Coordinated disclosure

We ask for coordinated disclosure: please give us a reasonable window to ship a
fix before going public. If we disagree about scope or severity, we will say so
plainly and explain.
