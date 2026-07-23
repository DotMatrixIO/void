---
name: Real-backend playwright config pattern
description: How to isolate playwright specs that require a live api-server from the main suite.
---

Some playwright specs (e.g. paywall-resume-flow) need the real api-server running rather than intercepted routes. The main playwright.config.ts does not start an api-server (other specs intercept /api/* routes and would conflict with a live server).

**Pattern:** Create a separate `playwright.<name>.config.ts` alongside the main config.

**webServer array for the resume spec:**
```typescript
webServer: [
  {
    command: `PORT=${PORT} BASE_PATH=${BASE_PATH} pnpm run dev`,  // vite
    url: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  {
    command: `LIGHTNING_BACKEND=mock PAYWALL_JITTER_DISABLE=1 NODE_ENV=development PAYWALL_ALLOW_EPHEMERAL_SECRET=1 PORT=${API_PORT} pnpm --filter @workspace/api-server run dev`,
    url: `http://127.0.0.1:${API_PORT}/api/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,  // api-server dev = build (esbuild) + start
  },
]
```

**Key facts:**
- API_PORT = 8080 (hardcoded in vite.config.ts, line 33: `const API_PORT = 8080`)
- api-server health check is at `/api/healthz` (router mounted at `/api` in app.ts line 312)
- PAYWALL_JITTER_DISABLE=1 prevents 10-60s M-04 jitter delay in status polling
- PAYWALL_ALLOW_EPHEMERAL_SECRET=1 skips the production-secret guard
- The `dev` script does `build && start`; esbuild finishes in ~2.5s
- Spec must be in `testIgnore` of all layout projects in the main config

**Add script to package.json:**
```json
"test:playwright:resume": "PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 PORT=${PORT:-5173} BASE_PATH=${BASE_PATH:-/} playwright test --config playwright.resume.config.ts"
```
