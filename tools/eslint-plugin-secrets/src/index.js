// SPDX-License-Identifier: AGPL-3.0-or-later
// @workspace/eslint-plugin-secrets
//
// Custom ESLint plugin that flags equality comparisons against any value
// statically inferred to carry the `Brand<"Secret">` tag from
// `@workspace/wire-core`. Replaces the narrower grep guard
// from #257 (which only matched values imported from a conventional
// `lib/secrets/` path) — this rule follows the brand through function
// parameters, destructuring, and utility wrappers wherever the
// TypeScript program can resolve the type.
//
// Scope:
//   - Flags `===`, `!==`, `==`, `!=` when either operand resolves to a
//     type that includes `{ readonly __brand: "Secret" }`.
//   - Flags `Buffer.equals(...)` calls when either argument resolves to
//     such a type.
//
// Exempt by construction (passes the rule because no Secret operand is
// involved): `crypto.timingSafeEqual(...)`, the shared
// `timingSafeStringCompare(...)` helper, structural equality on
// non-secret fields (e.g. `decoded.tier === "day"`).

import { ESLintUtils } from "@typescript-eslint/utils";

const SECRET_BRAND_NAME = "Secret";

function isNullishLiteral(node) {
  if (!node) return false;
  if (node.type === "Literal" && node.value === null) return true;
  if (node.type === "Identifier" && node.name === "undefined") return true;
  if (
    node.type === "UnaryExpression" &&
    node.operator === "void" &&
    node.argument.type === "Literal"
  ) {
    return true;
  }
  return false;
}

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://internal/eslint-plugin-secrets/${name}.md`,
);

/** Walk a TS Type and return true iff any constituent is intersected
 *  with a `Brand<"Secret">`-shaped object (a property `__brand` whose
 *  literal type is `"Secret"`). */
function typeIsSecret(checker, type) {
  if (!type) return false;
  // Apparent type unwraps things like `Secret<string> | undefined`
  // where the union has the brand on one side.
  const seen = new Set();
  function walk(t) {
    if (!t || seen.has(t)) return false;
    seen.add(t);
    // Union / intersection — recurse into constituents.
    if (t.isUnion && t.isUnion()) {
      return t.types.some(walk);
    }
    if (t.isIntersection && t.isIntersection()) {
      return t.types.some(walk);
    }
    const brandSym = t.getProperty?.("__brand");
    if (brandSym) {
      const brandType = checker.getTypeOfSymbolAtLocation(
        brandSym,
        brandSym.valueDeclaration ?? brandSym.declarations?.[0],
      );
      if (brandType?.isStringLiteral?.() && brandType.value === SECRET_BRAND_NAME) {
        return true;
      }
      // Sometimes the brand type is itself a union of literals.
      if (brandType?.isUnion?.()) {
        return brandType.types.some(
          (sub) => sub.isStringLiteral?.() && sub.value === SECRET_BRAND_NAME,
        );
      }
    }
    return false;
  }
  return walk(type);
}

function nodeTypeIsSecret(context, node) {
  const services = ESLintUtils.getParserServices(context, /* allowWithoutFullTypeInformation */ true);
  if (!services.program) return false;
  const checker = services.program.getTypeChecker();
  const tsNode = services.esTreeNodeToTSNodeMap.get(node);
  if (!tsNode) return false;
  const type = checker.getTypeAtLocation(tsNode);
  return typeIsSecret(checker, type);
}

const noSecretEquality = createRule({
  name: "no-secret-equality",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `===` / `==` / `Buffer.equals` against values branded `Secret<T>`. Use `crypto.timingSafeEqual` (or `timingSafeStringCompare` from `@workspace/wire-core`) instead.",
      recommended: "error",
      requiresTypeChecking: true,
    },
    schema: [],
    messages: {
      secretEquality:
        "Equality comparison against a `Secret<T>`-branded value is forbidden. " +
        "Use `crypto.timingSafeEqual` (or the `timingSafeStringCompare` helper " +
        "from `@workspace/wire-core`) so the compare is constant-time and " +
        "the secret never short-circuits on the first non-matching byte.",
      bufferEqualsSecret:
        "`Buffer.equals(...)` against a `Secret<T>`-branded value is forbidden. " +
        "Use `crypto.timingSafeEqual` directly so the compare is constant-time.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      BinaryExpression(node) {
        if (
          node.operator !== "===" &&
          node.operator !== "!==" &&
          node.operator !== "==" &&
          node.operator !== "!="
        ) {
          return;
        }
        // Presence checks against the literals `null` / `undefined` (and
        // the `undefined` identifier in lexical scope) cannot extract a
        // byte of the secret — there is no per-byte short-circuit on a
        // literal-null compare. A Secret value will be a non-null
        // string/Buffer/CryptoKey by construction; the JS engine
        // resolves these compares as identity, not byte equality. Skip
        // them so narrowing patterns like `if (secret !== undefined)`
        // and `secret == null` don't trigger the rule.
        if (isNullishLiteral(node.left) || isNullishLiteral(node.right)) {
          return;
        }
        if (
          nodeTypeIsSecret(context, node.left) ||
          nodeTypeIsSecret(context, node.right)
        ) {
          context.report({ node, messageId: "secretEquality" });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "equals"
        ) {
          return;
        }
        // Receiver or any argument branded -> flag.
        const receiverIsSecret = nodeTypeIsSecret(context, callee.object);
        const argIsSecret = node.arguments.some(
          (arg) => arg.type !== "SpreadElement" && nodeTypeIsSecret(context, arg),
        );
        if (receiverIsSecret || argIsSecret) {
          context.report({ node, messageId: "bufferEqualsSecret" });
        }
      },
    };
  },
});

const plugin = {
  meta: { name: "@workspace/eslint-plugin-secrets", version: "0.0.0" },
  rules: {
    "no-secret-equality": noSecretEquality,
  },
};

export default plugin;
export { noSecretEquality };
