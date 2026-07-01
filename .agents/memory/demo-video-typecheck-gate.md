---
name: demo-video typecheck gates
description: Demo-video artifacts have their own typecheck validations; missing DOM lib was the root cause of their type errors
---

The `biometric-demo-video` and `coordination-demo-video` artifacts each have a
typecheck validation workflow (`<name>-typecheck`) running
`pnpm --filter @workspace/<name> run typecheck`, mirroring `void-client-typecheck`
/ `sdk-typecheck`. Their `typecheck` script is plain `tsc -p tsconfig.json --noEmit`
(unlike void-client's `tsc -b`) because these artifacts have no composite project
references.

**Non-obvious root cause:** the demo-video tsconfigs were missing `dom`/`dom.iterable`
from `lib` (base tsconfig sets only `es2022`). That produced the obvious
`Cannot find name 'window'/'document'` errors, BUT it ALSO caused the
framer-motion `Variants` errors (TS2322 "transition incompatible with index
signature / StyleKeyframesDefinition"). framer-motion's variant/keyframe types
resolve against DOM CSS types; without the DOM lib they fall back to a shape that
rejects nested `transition`. Adding `lib: ["esnext","dom","dom.iterable"]` fixed
BOTH classes — no per-variant `as`/cast was needed.

**How to apply:** if a framer-motion `Variants` value reports a bogus
StyleKeyframesDefinition mismatch, check the tsconfig has the DOM lib before
casting anything.
