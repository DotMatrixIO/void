// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@docs": path.resolve(import.meta.dirname, "..", "..", "docs"),
    },
  },
  server: {
    fs: {
      allow: [
        path.resolve(import.meta.dirname),
        path.resolve(import.meta.dirname, "..", "..", "docs"),
      ],
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // The default 5s per-test timeout is too tight for the heavier
    // RoomPage render tests when many test files run in parallel and
    // contend for CPU — they pass in isolation but creep up to ~5s
    // under the full suite, tipping into spurious timeout failures.
    // Give every test more headroom so the suite stays a reliable
    // release gate (truly hung tests still fail, just later).
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
