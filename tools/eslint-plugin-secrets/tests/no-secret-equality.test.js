// SPDX-License-Identifier: AGPL-3.0-or-later
// Automated regression tests for the custom rule
// `@workspace/secrets/no-secret-equality`. The rule was previously
// validated only by planting a violation in the tree by hand; these
// cases exercise the brand-walking logic (union, intersection,
// function-parameter flow) plus the `null` / `undefined` exemption
// so a future refactor of the rule (or a typescript-eslint upgrade)
// can't silently regress it.
//
// Run via: `pnpm --filter @workspace/eslint-plugin-secrets test`
// (also wired into the root `pnpm test:lint-rules` script).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import { RuleTester } from "@typescript-eslint/rule-tester";
import tseslint from "typescript-eslint";

import plugin from "../src/index.js";

const noSecretEquality = plugin.rules["no-secret-equality"];

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const fixtureFile = path.join(fixturesDir, "case.ts");

RuleTester.afterAll = after;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: {
        allowDefaultProject: ["case.ts"],
        defaultProject: "tsconfig.json",
      },
      tsconfigRootDir: fixturesDir,
    },
  },
});

const PRELUDE = `
import { type Secret } from "./brand";
declare const s: Secret<string>;
declare const t: string;
declare const sb: Secret<{ equals(other: unknown): boolean }>;
declare const ob: { equals(other: unknown): boolean };
declare const u: Secret<string> | string;
`;

function code(body) {
  return PRELUDE + body;
}

ruleTester.run("no-secret-equality", noSecretEquality, {
  valid: [
    // Plain non-secret comparisons are untouched.
    { code: code("const a = t === t;"), filename: fixtureFile },
    { code: code('const a = t === "x";'), filename: fixtureFile },
    { code: code("const a = ob.equals(ob);"), filename: fixtureFile },

    // Nullish exemption: presence/narrowing checks do not extract a
    // byte of the secret and must not trigger the rule.
    { code: code("const a = s === null;"), filename: fixtureFile },
    { code: code("const a = s !== null;"), filename: fixtureFile },
    { code: code("const a = s === undefined;"), filename: fixtureFile },
    { code: code("const a = s !== undefined;"), filename: fixtureFile },
    { code: code("const a = s == null;"), filename: fixtureFile },
    { code: code("const a = null === s;"), filename: fixtureFile },
    { code: code("const a = s === void 0;"), filename: fixtureFile },
  ],
  invalid: [
    // Branded-vs-string compare on either side.
    {
      code: code("const a = s === t;"),
      filename: fixtureFile,
      errors: [{ messageId: "secretEquality" }],
    },
    {
      code: code("const a = t === s;"),
      filename: fixtureFile,
      errors: [{ messageId: "secretEquality" }],
    },
    {
      code: code("const a = s == t;"),
      filename: fixtureFile,
      errors: [{ messageId: "secretEquality" }],
    },
    {
      code: code("const a = s !== t;"),
      filename: fixtureFile,
      errors: [{ messageId: "secretEquality" }],
    },

    // `Buffer.equals`-style call with a branded receiver or argument.
    {
      code: code("const a = sb.equals(ob);"),
      filename: fixtureFile,
      errors: [{ messageId: "bufferEqualsSecret" }],
    },
    {
      code: code("const a = ob.equals(sb);"),
      filename: fixtureFile,
      errors: [{ messageId: "bufferEqualsSecret" }],
    },

    // Brand reached through a union — the rule walks union
    // constituents, so `Secret<string> | string` still trips.
    {
      code: code("const a = u === t;"),
      filename: fixtureFile,
      errors: [{ messageId: "secretEquality" }],
    },

    // Brand reached through a function parameter — the rule follows
    // the type at the use site, not the declaration site.
    {
      code: code(
        "function f(x: Secret<string>): boolean { return x === t; }",
      ),
      filename: fixtureFile,
      errors: [{ messageId: "secretEquality" }],
    },
  ],
});
