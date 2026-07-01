// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties, ReactNode } from "react";
import { Link } from "wouter";

// In-app deep link to a specific subsection of a long-form docs page.
//
// Uses wouter routing (a soft `history.pushState`) rather than a full-page
// `<a>` navigation. A hard navigation to a constructed BASE_URL strands the
// user on a blank page inside Replit's proxied preview iframe; wouter keeps
// the SPA mounted. The target subsection's `#hash` rides along in the href so:
//   - cross-page: the destination page's mount effect reads the hash and
//     scrolls the section into view, and
//   - same-page (the link is already rendered on the destination page): the
//     onClick below scrolls, because a soft pushState fires neither a remount
//     nor a `hashchange` event.
export default function DocsAnchorLink({
  href,
  children,
  style,
  testId,
}: {
  href: string;
  children: ReactNode;
  style?: CSSProperties;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      style={style}
      data-testid={testId}
      onClick={() => {
        const hashIdx = href.indexOf("#");
        if (hashIdx === -1) return;
        const id = href.slice(hashIdx + 1);
        // Defer past wouter's URL update. If the target is on the current
        // page, scroll to it; if we navigated to a different page, the
        // element isn't mounted yet (getElementById is null) and the
        // destination page's own mount effect handles the scroll.
        requestAnimationFrame(() => {
          if (typeof document === "undefined") return;
          const el = document.getElementById(id);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }}
    >
      {children}
    </Link>
  );
}
