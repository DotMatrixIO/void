---
name: smoke-serve-static load flake
description: When smoke-serve-static reports "Server exited before listening (code=0)", suspect concurrent-restart load, not a code defect.
---

# smoke-serve-static "Server exited before listening (code=0 signal=null)"

This api-server workflow can FAIL with `[smoke-serve-static] FAIL: Server exited before listening (code=0 signal=null)` when it runs as part of a mass restart of all ~25 workflows at once (heavy concurrent load on the container).

**It is not a code defect.** The production serve-static path is fine. Verified three independent ways:
- Running the built `dist/index.mjs` standalone with `NODE_ENV=production SERVE_STATIC=1 CLIENT_DIST=<tmp>` prints `"Server listening"` and serves `/`, deep, and nested SPA paths.
- Running `node ./scripts/smoke-serve-static.mjs` directly (in isolation) PASSES repeatably.
- The api-server vitest suite (incl. SERVE_STATIC=1 security-headers tests) passes.

**Why:** the harness's `waitForListening` rejects on the child `exit` event; under load the spawned server process can exit before its `httpServer.listen` callback fires. The clean `code=0` (not a crash) plus the fact that it never reproduces in isolation points at environment/scheduling, not the server.

**How to apply:** if only smoke-serve-static is red and the api-server build + tests are green, re-run it in isolation before touching code. Do not chase it as a serve-static regression. The header comment in the script (guarding the Express 5 / path-to-regexp `app.get("*")` crash) describes a real code-level regression class — that one would exit non-zero, not 0.
