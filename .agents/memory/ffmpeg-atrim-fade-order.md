---
name: ffmpeg atrim + afade ordering
description: Why a trimmed audio segment can render fully silent when fades are chained after atrim
---

# atrim then afade renders silence unless you asetpts first

When extracting a mid-stream segment with `atrim=START:END` and then applying
`afade`, the trimmed samples KEEP their original timestamps (e.g. a segment cut
from 15.55s still has PTS ~15.55+). `afade=t=out:st=0.57:d=0.08` is evaluated
against those original timestamps, so the entire segment falls after the
fade-out window and is muted to silence. A fade-IN at `st=0` similarly never
matches. The bug is silent (no error) — the file just has a dead region.

**Why:** afade/atrim operate on PTS, and atrim does not rebase PTS to 0.

**How to apply:** Always `asetpts=N/SR/TB` (or `asetpts=PTS-STARTPTS`)
*immediately after* atrim and *before* any afade, so fade offsets are relative
to the segment start. A segment cut from the start (atrim=0:X) works without
this only by luck (its PTS already starts at 0). Verify edits with
`ffmpeg -ss T -t D -i out.mp3 -af astats` (peak/RMS = -inf means a dead region).
