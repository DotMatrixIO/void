// SPDX-License-Identifier: AGPL-3.0-or-later
import { type CSSProperties } from "react";

// Task #571: header-bar toggle that hides the local user's own video
// tile from their own screen. Controlled component — the parent
// (RoomPage) owns the boolean so it can also drive the grid filter
// and the solo placeholder. The localStorage persistence lives in
// `@/lib/selfView`; the parent reads it on mount and writes through
// here on every flip.
//
// This is NOT a privacy feature. The outgoing camera stream is
// unchanged. The tooltip says that out loud so a user reading the
// title doesn't believe SELF OFF stops what peers see.

interface Props {
  value: boolean;
  onChange: (next: boolean) => void;
  style?: CSSProperties;
  className?: string;
}

export default function SelfViewToggle({ value, onChange, style, className }: Props) {
  return (
    <button
      type="button"
      data-testid="self-view-toggle"
      aria-pressed={value}
      aria-label={`Self view ${value ? "on" : "off"}`}
      className={className ?? `void-btn${value ? " void-btn--gold active" : ""}`}
      onClick={() => onChange(!value)}
      title={
        value
          ? "Your own video tile is visible to you. Click to hide it from your screen only. Peers still see your camera — this is a comfort setting, not a privacy feature."
          : "Your own video tile is hidden from your screen. Peers still see your camera unchanged. Click to show it again."
      }
      style={style}
    >
      {value ? "SELF ON" : "SELF OFF"}
    </button>
  );
}
