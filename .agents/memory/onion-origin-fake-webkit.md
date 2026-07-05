---
name: Fake .onion origin across engines (no host-resolver-rules)
description: How to make any Playwright engine (incl. WebKit) believe it's served from a non-resolvable host, replacing Chromium's --host-resolver-rules.
---

# Faking a non-resolvable origin in WebKit too

Chromium's `--host-resolver-rules=MAP <host> 127.0.0.1` is Chromium-only;
WebKit/Firefox have no equivalent launch flag. To exercise origin-dependent
UI (e.g. `isOnionOrigin()` reading `window.location.hostname`) under WebKit,
use **Playwright request interception** instead:

```ts
await page.route(
  (url) => url.hostname === ONION_HOST && url.port === String(ONION_PORT),
  async (route) => {
    const local = new URL(route.request().url());
    local.hostname = "127.0.0.1";
    const response = await route.fetch({ url: local.toString() });
    await route.fulfill({ response });
  },
);
await page.goto(`http://${ONION_HOST}:${ONION_PORT}/...`);
```

**Why it works:** Playwright pauses each request *before* the browser does
DNS, so the non-resolvable host never hits the network, yet the document is
loaded under that URL — so `window.location.hostname` is the fake host.
Works identically in Chromium and WebKit. Vite dev needs `allowedHosts: true`
(already set) since `route.fetch` forwards the original Host header.

**How to apply:** Scope the matcher to the asset/nav port so Vite's HMR is the
only thing that fails (its WebSocket isn't intercepted — benign console noise,
does not throw / does not trip the runtime-error overlay). Any same-origin
sub-fetch the page makes on a *different* port (e.g. a reachability probe on
:80) is intentionally left to fail, matching the Chromium baseline.

**Caveat — clipboard:** `navigator.clipboard` read/write needs the
`clipboard-read`/`clipboard-write` context permissions, which are
**Chromium-only** in Playwright (passing them to a WebKit context throws).
Gate clipboard round-trip assertions to `browserName === "chromium"`; assert
render/visibility on both engines.
