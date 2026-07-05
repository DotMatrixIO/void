// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, type CSSProperties } from "react";
import {
  getUiSoundsEnabled,
  setUiSoundsEnabled,
  uiClick,
} from "@/lib/uiSounds";

// Task #417: the SOUNDS toggle originally only lived in the in-room
// header (task #407). UI bleeps/clicks also fire on StartScreen,
// PreviewGate, and PhraseShareModal — users who want to enable sounds
// BEFORE entering a room had no surface to do so. This component is
// the shared toggle so the on/off semantics, label, title copy, and
// "persist-before-click" ordering stay identical across every place
// it is rendered. The RoomPage instance is intentionally left inline
// (it lives in a header packed with other in-room controls and has
// its own visual treatment) — duplicating the persist+uiClick contract
// in two places is fine; what matters is that they agree.

interface Props {
  style?: CSSProperties;
  className?: string;
  /** When this toggle is rendered inside a `role="menu"` container (the
   *  in-call overflow menu), pass `role="menuitem"` so the menu satisfies
   *  the ARIA required-children contract. Omitted everywhere else. */
  role?: string;
}

export default function UiSoundsToggle({ style, className, role }: Props) {
  const [on, setOn] = useState<boolean>(() => getUiSoundsEnabled());
  return (
    <button
      type="button"
      role={role}
      data-testid="ui-sounds-toggle"
      className={className ?? `void-btn${on ? " void-btn--gold active" : ""}`}
      onClick={() => {
        const next = !on;
        // Persist FIRST so the very click that flips ON is heard;
        // uiClick() reads the localStorage flag synchronously. Mirrors
        // the in-room toggle's ordering (RoomPage, task #407).
        setUiSoundsEnabled(next);
        setOn(next);
        uiClick();
      }}
      title={
        on
          ? "Sound FX are on. Click to silence every UI bleep, click, and slide. Off by default so VOID is silent on a fresh install."
          : "Sound FX are off (the default). Click to enable the retro bleep and click sounds for peer-joined, BURN confirmation, and other UI events."
      }
      style={style}
    >
      {on ? "SOUND FX ON" : "SOUND FX OFF"}
    </button>
  );
}
