// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";

// Wraps a wide table (or any wide block) in a horizontally scrollable
// container that grows an edge cue when there is more content off-screen.
// On phones the comparison tables overflow 375px; without a cue the VOID
// column gets pushed off the right edge with no affordance. The right-edge
// gradient + arrow tells the reader to swipe; the left-edge gradient
// confirms there is content behind them once they have scrolled. The
// container is keyboard-focusable and labelled so it is reachable without
// a pointer.

interface ScrollableTableProps {
  children: React.ReactNode;
  "data-testid"?: string;
  ariaLabel?: string;
}

// Fades toward the card background (concrete-on-#14110D). A flat dark
// rgba is close enough to read as "the content continues under here".
const cardBg = "rgba(20,17,13,1)";
const cardBgTransparent = "rgba(20,17,13,0)";

const fadeBase: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  width: "32px",
  pointerEvents: "none",
  transition: "opacity 150ms ease",
  zIndex: 1,
};

export default function ScrollableTable({
  children,
  "data-testid": testId,
  ariaLabel,
}: ScrollableTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(max <= 1 || el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    update();
    const el = scrollRef.current;
    if (!el) return;
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);

  const showLeft = !atStart;
  const showRight = !atEnd;

  return (
    <div style={{ position: "relative", margin: "0 -4px" }} data-testid={testId}>
      <div
        ref={scrollRef}
        onScroll={update}
        tabIndex={0}
        role="region"
        aria-label={ariaLabel}
        style={{
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          padding: "0 4px",
        }}
      >
        {children}
      </div>

      <div
        aria-hidden="true"
        style={{
          ...fadeBase,
          left: 0,
          opacity: showLeft ? 1 : 0,
          background: `linear-gradient(to right, ${cardBg}, ${cardBgTransparent})`,
        }}
      />

      <div
        aria-hidden="true"
        style={{
          ...fadeBase,
          right: 0,
          opacity: showRight ? 1 : 0,
          background: `linear-gradient(to left, ${cardBg}, ${cardBgTransparent})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <span
          style={{
            color: "var(--gold)",
            fontFamily: "var(--font-mono)",
            fontSize: "16px",
            lineHeight: 1,
            paddingRight: "2px",
          }}
        >
          →
        </span>
      </div>
    </div>
  );
}
