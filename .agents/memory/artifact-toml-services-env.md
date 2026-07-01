---
name: artifact.toml service env must use a table header
description: Why void-client BASE_PATH silently fails to inject when the env keys are placed wrong in artifact.toml.
---

# Service env vars (BASE_PATH) need an explicit `[services.env]` table

In an artifact's `.replit-artifact/artifact.toml`, runtime env vars for the dev/serve
command must live under a `[services.env]` table, e.g.:

```toml
[services.env]
PORT = "24363"
BASE_PATH = "/"
```

**The trap:** if those bare `PORT`/`BASE_PATH` keys are appended at the END of the
file — after the `[[services.production.rewrites]]` array-of-tables — TOML binds them
to the *last rewrite table element*, not the top level. They become inert as service
env and are never injected. The file still parses, so nothing errors at load time.

**Symptom seen:** void-client's vite.config.ts throws
`BASE_PATH (or BASE_URL) environment variable is required` at dev-server start, while
`PORT` works fine. That asymmetry is the tell: the platform auto-injects `PORT` from
the service's `localPort`, so only `BASE_PATH` (which has no auto-injection) breaks.
Compare against a working artifact (biometric-demo-video) — it has the proper
`[services.env]` header.

**Fix:** move the keys under a real `[services.env]` table. Never hand-edit
`artifact.toml`; write a sibling `artifact.edit.toml` and apply via
`verifyAndReplaceArtifactToml` (artifacts skill). On success the temp file is consumed;
on failure it is left for inspection.

**Why it matters:** a misplaced env key produces a silent, valid-TOML regression that
only surfaces when the dev server boots — easy to misattribute to vite or a merge.
