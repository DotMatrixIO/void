// SPDX-License-Identifier: AGPL-3.0-or-later
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { BIP39_WORDLIST } from "@/lib/voidPhrase";

const MAX_SUGGESTIONS = 6;
const MAX_FUZZY_DISTANCE = 2;
const WORD_SET = new Set<string>(BIP39_WORDLIST);

// Separator class used to split a pasted/typed multi-word phrase into
// individual word tokens. Exported so the "paste the whole phrase" shortcut
// on the join screen splits on the exact same characters as the per-slot
// distribute-on-paste logic below.
export const PHRASE_SEPARATOR_RE = /[\s\-_\u2014\u2013]+/;

// Normalize a single token the same way the per-slot input does: lowercase,
// then strip anything that isn't an a-z letter. Exported so the bulk-paste
// shortcut produces the exact same tokens the grid would have produced.
export function sanitizePhraseToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]/g, "");
}

// Split a free-form phrase string into sanitized tokens, dropping empties.
export function splitPhraseTokens(raw: string): string[] {
  return raw
    .split(PHRASE_SEPARATOR_RE)
    .map(sanitizePhraseToken)
    .filter(Boolean);
}

export function findSuggestions(prefix: string, max = MAX_SUGGESTIONS): string[] {
  if (!prefix) return [];
  let lo = 0;
  let hi: number = BIP39_WORDLIST.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (BIP39_WORDLIST[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  const out: string[] = [];
  for (let i = lo; i < BIP39_WORDLIST.length && out.length < max; i++) {
    const w = BIP39_WORDLIST[i];
    if (w.startsWith(prefix)) out.push(w);
    else break;
  }
  return out;
}

function boundedEditDistance(a: string, b: string, max: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bl];
}

export function findFuzzyMatches(
  word: string,
  max = MAX_SUGGESTIONS,
  maxDistance = MAX_FUZZY_DISTANCE,
): string[] {
  if (!word || word.length < 2) return [];
  const scored: Array<{ word: string; distance: number }> = [];
  for (const candidate of BIP39_WORDLIST) {
    if (Math.abs(candidate.length - word.length) > maxDistance) continue;
    const d = boundedEditDistance(word, candidate, maxDistance);
    if (d > 0 && d <= maxDistance) {
      scored.push({ word: candidate, distance: d });
    }
  }
  scored.sort(
    (a, b) => a.distance - b.distance || a.word.localeCompare(b.word),
  );
  return scored.slice(0, max).map((s) => s.word);
}

export function isBip39Word(w: string): boolean {
  return WORD_SET.has(w);
}

export function emptyPhraseSlots(count: number): string[] {
  return Array(count).fill("");
}

export function unknownSlotIndices(words: string[]): number[] {
  return words
    .map((w, i) => ({ w: w.trim(), i }))
    .filter(({ w }) => w.length > 0 && !WORD_SET.has(w))
    .map(({ i }) => i);
}

interface Props {
  words: string[];
  onChange: (next: string[]) => void;
  onSubmit?: () => void;
  slotCount?: number;
  autoFocus?: boolean;
  ariaLabelPrefix?: string;
  highlightSlot?: (idx: number) => "match" | "mismatch" | null;
  columns?: number;
  // Fires only when the user pastes content that gets distributed across
  // slots (i.e. a real multi-word phrase paste). Single-character / single-
  // word pastes do not fire it. Used by the join screen to surface a one-
  // time clipboard-readability warning the first time a phrase is pasted.
  onPasteDistributed?: () => void;
}

export default function Bip39PhraseGrid({
  words,
  onChange,
  onSubmit,
  slotCount = 6,
  autoFocus = false,
  ariaLabelPrefix = "word",
  highlightSlot,
  columns = 3,
  onPasteDistributed,
}: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const inputsRef = useRef<Array<HTMLInputElement | null>>(
    Array(slotCount).fill(null),
  );
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputsRef.current[0]?.focus(), 50);
    return () => clearTimeout(t);
  }, [autoFocus]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
    };
  }, []);

  type Suggestion = { word: string; kind: "prefix" | "fuzzy" };

  const noSuggestionSlots = useMemo<Set<number>>(() => {
    const bad = new Set<number>();
    words.forEach((w, i) => {
      const trimmed = w.trim();
      if (trimmed.length === 0 || WORD_SET.has(trimmed)) return;
      if (findSuggestions(trimmed).length > 0) return;
      if (findFuzzyMatches(trimmed).length > 0) return;
      bad.add(i);
    });
    return bad;
  }, [words]);

  const activeSuggestions = useMemo<Suggestion[]>(() => {
    if (activeIndex === null) return [];
    const current = words[activeIndex] ?? "";
    if (!current) return [];
    if (WORD_SET.has(current)) {
      const more = findSuggestions(current).filter((w) => w !== current);
      if (more.length === 0) return [];
      const ranked: Suggestion[] = [
        { word: current, kind: "prefix" },
        ...more.map((w) => ({ word: w, kind: "prefix" as const })),
      ];
      return ranked.slice(0, MAX_SUGGESTIONS);
    }
    const prefixMatches = findSuggestions(current);
    if (prefixMatches.length > 0) {
      return prefixMatches.map((w) => ({ word: w, kind: "prefix" as const }));
    }
    const fuzzy = findFuzzyMatches(current, MAX_SUGGESTIONS);
    return fuzzy.map((w) => ({ word: w, kind: "fuzzy" as const }));
  }, [activeIndex, words]);

  function padded(next: string[]): string[] {
    const out = [...next];
    while (out.length < slotCount) out.push("");
    return out.slice(0, slotCount);
  }

  function focusSlot(idx: number) {
    const target = Math.max(0, Math.min(slotCount - 1, idx));
    const el = inputsRef.current[target];
    if (el) {
      el.focus();
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch { /* ignore */ }
    }
  }

  function setSlot(idx: number, value: string) {
    const lower = value.toLowerCase();
    if (/[\s\-_\u2014\u2013]/.test(lower)) {
      const parts = lower
        .split(/[\s\-_\u2014\u2013]+/)
        .map((p) => p.replace(/[^a-z]/g, ""))
        .filter(Boolean);
      if (parts.length === 0) {
        if (idx < slotCount - 1) {
          setActiveIndex(idx + 1);
          setHighlightIndex(0);
          setSuggestionsOpen(true);
          setTimeout(() => focusSlot(idx + 1), 0);
        }
        return;
      }
      const next = padded([...words]);
      for (let i = 0; i < parts.length && idx + i < slotCount; i++) {
        next[idx + i] = parts[i];
      }
      onChange(next);
      setHighlightIndex(0);
      setSuggestionsOpen(true);
      const lastFilled = Math.min(slotCount - 1, idx + parts.length - 1);
      const focusTarget = Math.min(slotCount - 1, lastFilled + 1);
      setActiveIndex(focusTarget);
      setTimeout(() => focusSlot(focusTarget), 0);
      return;
    }
    const cleaned = lower.replace(/[^a-z]/g, "");
    const next = padded([...words]);
    next[idx] = cleaned;
    onChange(next);
    setHighlightIndex(0);
    setSuggestionsOpen(true);
  }

  function acceptSuggestion(idx: number, word: string) {
    const next = padded([...words]);
    next[idx] = word;
    onChange(next);
    setHighlightIndex(0);
    if (idx < slotCount - 1) {
      setActiveIndex(idx + 1);
      setSuggestionsOpen(true);
      setTimeout(() => focusSlot(idx + 1), 0);
    } else {
      setSuggestionsOpen(false);
    }
  }

  function distributePaste(text: string, startIndex: number): boolean {
    const parts = text
      .toLowerCase()
      .split(/[\s\-_\u2014\u2013]+/)
      .map((p) => p.replace(/[^a-z]/g, ""))
      .filter(Boolean);
    if (parts.length < 2) return false;
    const start = parts.length >= slotCount ? 0 : startIndex;
    const next = parts.length >= slotCount
      ? Array(slotCount).fill("")
      : padded([...words]);
    for (let i = 0; i < parts.length && start + i < slotCount; i++) {
      next[start + i] = parts[i];
    }
    onChange(next);
    const lastFilled = Math.min(slotCount - 1, start + parts.length - 1);
    const focusTarget = Math.min(slotCount - 1, lastFilled + 1);
    setActiveIndex(focusTarget);
    setHighlightIndex(0);
    setSuggestionsOpen(true);
    setTimeout(() => focusSlot(focusTarget), 0);
    return true;
  }

  function handleKeyDown(
    idx: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) {
    const list = activeSuggestions;
    const open = suggestionsOpen && list.length > 0;
    if (e.key === "ArrowDown") {
      if (open) {
        e.preventDefault();
        setHighlightIndex((h) => (h + 1) % list.length);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (open) {
        e.preventDefault();
        setHighlightIndex((h) => (h - 1 + list.length) % list.length);
      }
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setSuggestionsOpen(false);
      }
      return;
    }
    if (e.key === "Tab") {
      if (open && !e.shiftKey) {
        e.preventDefault();
        acceptSuggestion(idx, (list[highlightIndex] ?? list[0]).word);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open) {
        acceptSuggestion(idx, (list[highlightIndex] ?? list[0]).word);
        return;
      }
      if (idx < slotCount - 1) {
        focusSlot(idx + 1);
      } else {
        onSubmit?.();
      }
      return;
    }
    if (
      e.key === " " ||
      e.key === "-" ||
      e.key === "_" ||
      e.key === "\u2014" ||
      e.key === "\u2013"
    ) {
      e.preventDefault();
      const current = words[idx] ?? "";
      if (open) {
        acceptSuggestion(idx, (list[highlightIndex] ?? list[0]).word);
      } else if (current && idx < slotCount - 1) {
        focusSlot(idx + 1);
      }
      return;
    }
    if (e.key === "Backspace") {
      const current = words[idx] ?? "";
      if (current === "" && idx > 0) {
        e.preventDefault();
        focusSlot(idx - 1);
      }
      return;
    }
  }

  function handlePaste(
    idx: number,
    e: React.ClipboardEvent<HTMLInputElement>,
  ) {
    const text = e.clipboardData.getData("text") ?? "";
    if (!/[\s\-_\u2014\u2013]/.test(text.trim())) return;
    const parts = text
      .toLowerCase()
      .split(/[\s\-_\u2014\u2013]+/)
      .filter(Boolean);
    if (parts.length < 2) return;
    e.preventDefault();
    distributePaste(text, idx);
    onPasteDistributed?.();
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: "8px",
        width: "100%",
        maxWidth: "360px",
      }}
    >
      {Array.from({ length: slotCount }).map((_, idx) => {
        const value = words[idx] ?? "";
        const trimmed = value.trim();
        const isUnknown = trimmed.length > 0 && !WORD_SET.has(trimmed);
        const isActive = activeIndex === idx;
        const showSuggestions =
          isActive && suggestionsOpen && activeSuggestions.length > 0;
        const compareState = highlightSlot ? highlightSlot(idx) : null;
        let borderColor: string;
        if (isUnknown || compareState === "mismatch") {
          borderColor = "var(--red)";
        } else if (compareState === "match") {
          borderColor = "var(--teal)";
        } else if (isActive) {
          borderColor = "var(--gold)";
        } else {
          borderColor = "var(--teal)";
        }
        const textColor = isUnknown || compareState === "mismatch"
          ? "var(--red)"
          : "var(--fg)";
        return (
          <div key={idx} style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                top: "-12px",
                left: "2px",
                fontSize: "12px",
                color: "var(--fg-dim)",
                letterSpacing: "1px",
              }}
            >
              {idx + 1}
            </div>
            <input
              ref={(el) => { inputsRef.current[idx] = el; }}
              type="text"
              inputMode="text"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setSlot(idx, e.target.value)}
              onFocus={() => {
                setActiveIndex(idx);
                setHighlightIndex(0);
                setSuggestionsOpen(true);
              }}
              onBlur={() => {
                if (blurTimerRef.current !== null) {
                  clearTimeout(blurTimerRef.current);
                }
                blurTimerRef.current = setTimeout(() => {
                  blurTimerRef.current = null;
                  setActiveIndex((curr) => (curr === idx ? null : curr));
                }, 120);
              }}
              onKeyDown={(e) => handleKeyDown(idx, e)}
              onPaste={(e) => handlePaste(idx, e)}
              aria-label={`${ariaLabelPrefix} ${idx + 1}`}
              aria-invalid={isUnknown || compareState === "mismatch"}
              style={{
                background: "var(--surface)",
                border: `2px solid ${borderColor}`,
                color: textColor,
                fontFamily: "var(--font-mono)",
                fontSize: "16px",
                fontWeight: 700,
                letterSpacing: "1px",
                textAlign: "center",
                padding: "12px 6px",
                width: "100%",
                outline: "none",
                textTransform: "lowercase",
                boxSizing: "border-box",
                textDecoration: isUnknown
                  ? "underline wavy var(--red)"
                  : "none",
              }}
            />
            {noSuggestionSlots.has(idx) && !showSuggestions && (
              <div
                role="alert"
                aria-live="polite"
                style={{
                  fontSize: "10px",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.5px",
                  /* contrast-exception: this grid only ever renders inside a
                     #14110D card (StartScreen and PreviewGate both wrap it in
                     a dark concrete-textured section). --red on #14110D is
                     3.40:1 — below body AA but redundant with the input's
                     wavy red underline, the red border around the slot, and
                     the aria-invalid="true" / role="alert" semantics that
                     screen readers announce. The text is a supplementary
                     spelling hint, not the sole indicator of the error. */
                  color: "var(--red)",
                  textAlign: "center",
                  padding: "2px 4px 0",
                  userSelect: "none",
                }}
              >
                not a recovery word — check spelling
              </div>
            )}
            {showSuggestions && (
              <div
                role="listbox"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: "2px",
                  background: "var(--surface-dark)",
                  border: "2px solid var(--gold)",
                  zIndex: 60,
                  maxHeight: "180px",
                  overflowY: "auto",
                }}
              >
                {activeSuggestions.map((sug, sIdx) => {
                  const highlighted = sIdx === highlightIndex;
                  const showFuzzyHeader =
                    sug.kind === "fuzzy" &&
                    (sIdx === 0 ||
                      activeSuggestions[sIdx - 1].kind !== "fuzzy");
                  return (
                    <Fragment key={sug.word}>
                      {showFuzzyHeader && (
                        <div
                          role="presentation"
                          style={{
                            padding: "6px 10px 2px",
                            fontFamily: "var(--font-mono)",
                            fontSize: "12px",
                            letterSpacing: "1.5px",
                            color: "var(--fg-dim)",
                            textTransform: "uppercase",
                            userSelect: "none",
                          }}
                        >
                          did you mean…?
                        </div>
                      )}
                      <div
                        role="option"
                        aria-selected={highlighted}
                        data-suggestion-kind={sug.kind}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          acceptSuggestion(idx, sug.word);
                        }}
                        onMouseEnter={() => setHighlightIndex(sIdx)}
                        style={{
                          padding: "8px 10px",
                          fontFamily: "var(--font-mono)",
                          fontSize: "13px",
                          letterSpacing: "1px",
                          color: highlighted ? "var(--surface-dark)" : "var(--gold)",
                          background: highlighted
                            ? "var(--gold)"
                            : "transparent",
                          cursor: "pointer",
                          textTransform: "lowercase",
                          userSelect: "none",
                        }}
                      >
                        {sug.word}
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
