// SPDX-License-Identifier: AGPL-3.0-or-later
// Flat ESLint config for the workspace monorepo.
//
// The single load-bearing rule here is
// `@workspace/secrets/no-secret-equality`, which uses TypeScript program
// type information to flag `===` / `==` / `Buffer.equals` against any
// value branded `Secret<T>` from `@workspace/wire-core`. The rule
// replaces the narrower grep guard that #257 contemplated (and which is
// not present in the tree, retired by this PR — see
// `docs/security-audit-public-2026-04.md` §R-9.12).
//
// Scope covers every secret-handling tree: api-server,
// void-client/lib, mockup-sandbox, and scripts. Tests in surfaces that
// don't typecheck against their package tsconfig (scripts) are linted
// via the shared `tsconfig.eslint.json` default project.
// Void-client tests/pages and api-server __tests__ remain ignored:
// the former pulls in vitest/jsx tooling not configured here, and the
// latter trips on rules unrelated to secret branding.
//
// To run locally:
//   pnpm lint

import secretsPlugin from "@workspace/eslint-plugin-secrets";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.vite/**",
      "**/coverage/**",
      "**/*.d.ts",
      "**/.generated/**",
      "**/generated/**",
      // Test surfaces not (yet) configured for the no-secret-equality
      // lint anchor. The rest are linted through the files patterns
      // below.
      "artifacts/void-client/src/**/*.test.ts",
      "artifacts/void-client/src/**/*.test.tsx",
      "artifacts/void-client/src/test/**",
      "artifacts/void-client/src/__tests__/**",
      "artifacts/api-server/src/__tests__/**",
      "tools/eslint-plugin-secrets/**",
    ],
  },
  {
    files: [
      "artifacts/api-server/src/**/*.ts",
      "artifacts/mockup-sandbox/src/**/*.ts",
      "artifacts/mockup-sandbox/src/**/*.tsx",
      "artifacts/void-client/src/lib/**/*.ts",
      "scripts/src/**/*.ts",
      "scripts/**/*.mjs",
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // Files in package tsconfig.includes use the type-aware project
        // service. Files outside any package include (demos, loose
        // tests, scripts) fall back to the shared tsconfig.eslint.json.
        projectService: {
          allowDefaultProject: [
            "scripts/*.mjs",
            "scripts/lib/*.mjs",
            "scripts/audit/*.mjs",
          ],
          defaultProject: "tsconfig.eslint.json",
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 100,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@workspace/secrets": secretsPlugin,
    },
    rules: {
      "@workspace/secrets/no-secret-equality": "error",
    },
  },
];
