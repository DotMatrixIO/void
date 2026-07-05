---
name: void-client RTL autofocus focus-steal race
description: Why click+keyboard edits in StartScreen tests flake under parallel load, and the deterministic fix.
---
Entering join mode in `StartScreen` arms a ~50ms `setTimeout` autofocus that focuses
the first BIP39 grid slot (effect in `Bip39PhraseGrid`, deps `[autoFocus]`). It fires
once, but it is a macrotask.

**Symptom:** RTL tests that do `user.click(field)` then `user.keyboard("…")` pass in
isolation but flake under full-suite parallel load. Under CPU contention the 50ms
autofocus macrotask can fire *between* the click and the keystroke, stealing focus to
a grid slot so the keystroke lands on the wrong element and the field's `onChange`
never runs (e.g. the overflow hint never clears → assertion times out).

**Fix:** For focus-sensitive edits, drive the change directly at the target with
`fireEvent.change(el, { target: { value: "…" } })` instead of `click` + `keyboard`.
It dispatches `onChange` on the intended element regardless of focus, and flushes
synchronously (so `waitForElementToBeRemoved` may throw "already removed" — assert via
a tolerant `vi.waitFor(() => queryByText(...).not.toBeInTheDocument())` instead).

**Same race for paste:** `user.click(field)` + `user.paste("…")` flakes the same way —
`user.paste` targets `document.activeElement`, so if the autofocus fires between the
click and the paste, the paste lands on the grid slot (firing the grid's paste path,
not the bulk field's). Fix: dispatch directly on the target with
`fireEvent.paste(el, { clipboardData: { getData: () => "…" } })`. The bulk-field
`onPaste` reads `e.clipboardData.getData("text")`, so a stub object with `getData` is
enough; no focus dependency. The sibling grid-slot paste tests don't flake because
they click slot 0 and the autofocus also targets slot 0 — focus never moves.

**Why:** This is a test-timing/isolation issue, not a product bug — the production
autofocus is correct. Keep the fix in the test; no component change.
