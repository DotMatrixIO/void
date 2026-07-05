// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect } from "react";

// Tombstone for the retired /docs/why route. The long-form WHY content
// moved to /docs/how-it-works; this component preserves any inbound
// bookmark or deep link (including #anchors that match the new page's
// IDs) by client-side replacing the URL on mount.
export default function DocsWhyRedirect() {
  useEffect(() => {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const hash = window.location.hash || "";
    window.location.replace(`${base}/docs/how-it-works${hash}`);
  }, []);
  return null;
}
