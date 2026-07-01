// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { assertOnionBake } from "./src/lib/onionHost";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || process.env.BASE_URL;

if (!basePath) {
  throw new Error(
    "BASE_PATH (or BASE_URL) environment variable is required but was not provided.",
  );
}

const API_PORT = 8080;

// Cache-buster for the AudioWorklet module URL. We hash the worklet file's
// bytes so that:
//   1. The injected version changes when (and only when) the worklet source
//      changes — preserving the original cache-bust intent.
//   2. Two builds of the same source tree produce byte-identical output, so
//      the SRI integrity baseline emitted by `scripts/add-sri.mjs` is stable
//      across builds. Using `Date.now()` here previously made every build
//      non-reproducible — see task #248 and
//      docs/security-audit-public-2026-04.md §11 limitation 10.
const voiceMaskVersion = createHash("sha256")
  .update(
    readFileSync(
      path.resolve(import.meta.dirname, "public", "voice-mask-processor.js"),
    ),
  )
  .digest("hex")
  .slice(0, 12);

// Onion-bake inertness guard. When a build is expected to bake in the Tor
// `.onion` mirror affordance, a missing or malformed VITE_VOID_ONION_HOST
// would make the affordance resolve to null and render nothing — silently
// shipping a "Tor-reachable" bundle whose onion link is inert. We fail the
// build closed in that case. The requirement is ON UNCONDITIONALLY for the
// canonical / production build path (NODE_ENV==="production"), and opt-in for
// dev via VOID_REQUIRE_ONION=1; ordinary dev builds stay permissive. Gated
// on `command === "build"` so `vite` dev (serve) never trips it. The actual
// v3 validation is the same source of truth the runtime uses (onionHost.ts).
export default defineConfig(async ({ command }) => {
  const requireOnionBake =
    process.env.NODE_ENV === "production" ||
    process.env.VOID_REQUIRE_ONION === "1";
  if (command === "build" && requireOnionBake) {
    assertOnionBake(process.env.VITE_VOID_ONION_HOST);
  }

  return {
    base: basePath,
    define: {
      __VOICE_MASK_VERSION__: JSON.stringify(voiceMaskVersion),
    },
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@docs": path.resolve(import.meta.dirname, "..", "..", "docs"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      // Emit Vite's build manifest so the post-build SRI step can walk the
      // dynamic-import closure and inject <link rel="modulepreload"
      // integrity="…"> tags for every reachable lazy chunk. See
      // scripts/add-modulepreload-sri.mjs and task #258.
      manifest: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      headers: {
        "Permissions-Policy": "camera=*, microphone=*, display-capture=*",
      },
      fs: {
        strict: true,
        deny: ["**/.*"],
        allow: [
          path.resolve(import.meta.dirname),
          path.resolve(import.meta.dirname, "..", "..", "docs"),
        ],
      },
      proxy: {
        "/api/socket.io": {
          target: `http://localhost:${API_PORT}`,
          ws: true,
          changeOrigin: true,
        },
        "/api": {
          target: `http://localhost:${API_PORT}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
    };
  });
