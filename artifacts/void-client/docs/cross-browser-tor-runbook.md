# Cross-Browser & Tor Manual Test Runbook

> Task #664 companion to the automated Playwright cross-engine flow gate
> (`tests/playwright/cross-engine-flow.spec.ts`). The automated gate
> covers what is reachable headlessly — landing render, preview-gate
> render, the synthetic joined-call UI, and the WebRTC stack on
> Chromium/Firefox. **Everything in this document is human-only** and
> must be run on real devices and browsers. The headless suite cannot
> see a real camera, cannot judge masked output, cannot prove a packet
> never touched the clearnet, and cannot drive Tor Browser.

## Why this is manual

These checks depend on things a headless CI runner does not have:

- A **real camera and microphone** producing real frames, so the mask
  pipeline has something to process and a human can judge the result.
- A **real network path** (Wi‑Fi, cellular, Tor) so relay-only
  enforcement and clearnet-leak behaviour reflect production.
- **Human visual judgement** of the masked video output — whether a face
  is actually obscured is not a pixel-diff assertion.
- **Tor Browser**, which Playwright cannot drive, reaching the `.onion`
  mirror.

Do **not** fabricate results. A check is "pass" only after a human
observed it on the target platform. If you cannot run a platform, mark
its rows **N/T (not tested)** — never "pass".

## Roles: two-tester setup

Most rows need two participants in the **same room** at the same time.

- **Tester A (Host)** creates the session ("HOST A SESSION"), reads the
  six-word phrase, and shares it with Tester B out of band (in person,
  signal, etc. — never paste it into the same channel you are testing).
- **Tester B (Joiner)** opens the phrase (typed, scanned, or via the
  deep link `https://<host>/#word1-word2-word3-word4-word5-word6`) and
  steps through the preview gate.

Each tester runs the platform assigned to them. For a full matrix, swap
roles so each platform is exercised as **both** host and joiner. Record
who tested what, on which OS/browser build, and the date.

## What every session must verify (applies to all platforms)

For each platform pairing below, confirm all of the following. These are
the security-critical invariants — a failure on any is a **blocking
bug**, not a cosmetic one.

1. **SAS verification.** Both testers see a Short Authentication String
   (the verification words/emoji). Read them aloud over a *separate*
   trusted channel. They **must match** on both ends. A mismatch means a
   possible MITM — **abort and file a bug immediately**.
2. **Relay-only enforcement.** When relay-only is enabled (the host
   toggle in the preview gate), the call must still connect, and it must
   do so **without** a direct peer-to-peer path that would expose IPs.
   Confirm the call works relay-only; confirm the relay-only toggle
   state is honoured for the whole session.
3. **No clearnet leak (Tor / onion sessions).** When testing over Tor or
   the `.onion` mirror, no request may resolve to a clearnet host. See
   the Tor section for how to capture this.
4. **Masked output.** Each tester confirms the *other* participant's
   video is masked as expected — the mask is applied, stable, and does
   not flicker back to a raw frame on reconnect, orientation change, or
   backgrounding.
5. **Preview gate gating.** Camera/mic do not activate until the user
   passes the preview gate and grants permission. Denying permission
   shows a clear state, not a silent hang or a black call.

Pass/fail criteria per row: **PASS** = observed working on the target
platform with all five invariants intact. **FAIL** = any invariant
broken or the surface unusable. **N/T** = platform not available to a
tester this cycle.

---

## Platform 1 — iOS Safari (PWA install + call)

Target: a recent iPhone, iOS Safari. The headless flow gate skips real
WebRTC on WebKit (headless WebKit on Linux does not gather ICE
candidates). Safari's live WebRTC **transport** is now automated on a
real device cloud — `tests/playwright/safari-webrtc-devicecloud.spec.ts`
connects to genuine Safari (BrowserStack macOS by default) and asserts a
real peer-connection plus the masked joined-call surface. This manual row
still owns what automation cannot judge: **masked-output quality on a
real camera**, SAS matching, relay-only/no-leak on a real network, and
the iOS PWA lifecycle below.

1. Open the site in Safari. Confirm the landing page renders and the
   host/join controls are usable at phone width.
2. **Install as PWA:** Share → "Add to Home Screen". Launch from the
   home-screen icon (standalone, no Safari chrome).
3. From the PWA, create or join a room. Grant camera + microphone when
   the preview gate requests them.
4. Run all five invariants above with a second tester.
5. iOS-specific checks:
   - Rotate the device (portrait ↔ landscape) mid-call — video grid and
     control bar reflow without losing the mask or the stream.
   - Background the PWA (home button / app switcher) and return — the
     call recovers and the mask is reapplied.
   - Confirm audio routes correctly (speaker / Bluetooth) without
     exposing a raw/unmasked frame on resume.

## Platform 2 — Android Chrome

Target: a recent Android phone, Chrome.

1. Open the site in Chrome. Confirm landing render and controls.
2. Optionally install the PWA (Add to Home Screen) and repeat from the
   installed app.
3. Create or join a room; grant camera + mic at the preview gate.
4. Run all five invariants with a second tester.
5. Android-specific checks:
   - Switch front/rear camera if the UI exposes it — mask stays applied.
   - Rotate device — reflow holds, mask holds.
   - Lock/unlock the screen mid-call — call recovers, no unmasked frame.

## Platform 3 — Desktop Firefox

Target: latest desktop Firefox (the engine the automated flow gate now
also runs headlessly — this manual row confirms the live camera + masked
output path the headless run cannot see).

1. Open the site. Confirm landing render and controls at desktop width.
2. Join/create a room; grant camera + mic at the preview gate. Confirm
   Firefox's permission prompt is handled and the preview starts.
3. Run all five invariants with a second tester.
4. Firefox-specific checks:
   - `about:webrtc` shows the expected connection (use it to sanity-check
     relay-only: with relay-only on, the selected candidate pair should
     be relayed, not host/srflx direct).
   - Resize the window across breakpoints — layout holds, mask holds.

## Platform 4 — Tor Browser over the .onion mirror

Target: Tor Browser (desktop) reaching the `.onion` mirror address (the
host/join screen exposes the onion mirror address; copy it from there).
This is the strictest privacy path and **cannot be automated**.

### Prerequisite — a real deployed `.onion` (fail-fast)

This section **requires a real, deployed `.onion` mirror endpoint**. The
dev environment does not serve one. **Before testing:**

- Confirm a deployed `.onion` mirror address actually exists and resolves
  in Tor Browser. The address is surfaced on the host/join screen of the
  **deployed** site — not the dev preview.
- **If no deployed `.onion` endpoint is available, STOP.** Mark the
  entire Tor section **BLOCKED / N-T** in the matrix and record "no
  deployed .onion" as the reason. A human must provision/deploy the
  onion mirror before this section can be claimed as covered. Do **not**
  substitute the clearnet URL and call it a Tor pass.

### Required setup — two Tor Browser instances (Tor ↔ Tor)

The **primary** Tor pass must be **Tor Browser ↔ Tor Browser**: both the
host and the joiner run Tor Browser reaching the `.onion` mirror. This is
the only configuration that exercises the full onion-to-onion privacy
path.

- Run the two Tor Browser instances on **different machines and,
  ideally, different networks/locations** (e.g. two testers in two
  places). This is what proves the no-clearnet-leak guarantee across a
  real circuit rather than a loopback shortcut.
- **Same-machine fallback** (two Tor Browser profiles on one host) is
  permitted **only as a preliminary smoke check** — mark any
  same-machine result as **preliminary**, not a full PASS. It does not
  satisfy the Tor↔Tor coverage requirement on its own.
- A Tor-host paired with a non-Tor joiner (or vice-versa) is a useful
  *additional* row, but it does **not** count as the required Tor↔Tor
  pass. Record it separately and label the pairing.

### Steps

1. On **both** Tor Browser instances, open the `.onion` mirror URL.
   Confirm the landing page renders over Tor on each.
2. Note Tor Browser's default **"Safest"** security level may disable
   features; record which level each instance tested at and whether the
   call works at "Safer"/"Safest" vs "Standard".
3. Host (Tor) creates a room; joiner (Tor) joins via the phrase. Grant
   camera + mic at the preview gate on both (Tor Browser will prompt —
   this is expected).
4. **No-clearnet-leak check (critical), on each instance:**
   - Confirm every connection stays within Tor — there must be no DNS
     resolution or TCP connection to a clearnet host outside the Tor
     circuit. Verify via Tor Browser's network behaviour and, where
     available, an external network monitor on each host machine showing
     **no** non-Tor traffic from the browser during the call.
   - Confirm relay-only is effectively enforced — a direct P2P candidate
     to a clearnet IP would both break Tor anonymity and is a blocking
     bug.
5. Run the remaining invariants (SAS match, masked output, preview gate)
   across the two Tor instances. Record the pairing and both testers.
6. If the call cannot establish over Tor at a given security level,
   record it as a finding (expected-limitation vs bug) — do not silently
   pass.

---

## Results matrix (fill in per cycle — do not pre-fill)

Record one block per platform pairing. Use PASS / FAIL / N/T.

```
Cycle date: __________   Build/commit: __________

Platform            | Role   | Tester | SAS | Relay-only | No-leak | Mask | Gate | Notes
--------------------|--------|--------|-----|------------|---------|------|------|------
iOS Safari (PWA)    | host   |        |     |            |  n/a    |      |      |
iOS Safari (PWA)    | joiner |        |     |            |  n/a    |      |      |
Android Chrome      | host   |        |     |            |  n/a    |      |      |
Android Chrome      | joiner |        |     |            |  n/a    |      |      |
Desktop Firefox     | host   |        |     |            |  n/a    |      |      |
Desktop Firefox     | joiner |        |     |            |  n/a    |      |      |
Tor / .onion        | host   |        |     |            |         |      |      |
Tor / .onion        | joiner |        |     |            |         |      |      |
```

(The "No-leak" column is the Tor-specific clearnet check; mark `n/a` for
non-Tor rows, but still confirm relay-only there.)

## Cycle log

Append one block per cycle below. Fill cells **only** after a human
observes the result on the target platform. Leave a cell blank until it
is observed; never write PASS for something not run (use N/T instead).

### Cycle: 2026-06-02 (build ref 18c6689)

> Status: **COMPLETE** — 2026-06-04. Three human testers, real devices,
> three live sessions. All 5 invariants PASS on all 6 clearnet rows; Tor
> block BLOCKED (no deployed .onion). 9 findings logged (3 blocking:
> F1, F5, F6) → follow-on bugs filed.
>
> Testers (record name/handle, OS + browser build, network):
> - Tester A: John — iPhone X, iOS, Safari, home Wi-Fi
> - Tester B: John2 — Pixel (GrapheneOS), Chrome, home Wi-Fi
> - Tester C: John3 — Lenovo ThinkPad, Windows 11 Pro, Firefox, home Wi-Fi
>
> Notes / environment:
> - Deployed `.onion` mirror available? **No.** The entire Tor / .onion
>   block is **BLOCKED → N/T**, reason "no deployed .onion" (see
>   Platform 4 prerequisite). Not substituted with clearnet.
> - Android Chrome row is exercised on a Pixel running **GrapheneOS**
>   (recorded for honesty about the OS under test).

```
Platform            | Role   | Tester | SAS | Relay-only | No-leak | Mask  | Gate | Notes
--------------------|--------|--------|-----|------------|---------|-------|------|------
iOS Safari (PWA)    | host   | John   | PASS| PASS       |  n/a    | PASS  | PASS | S1. 5 invariants OK; but blocking bugs F1,F5,F6 found. Also F3,F4,F8
iOS Safari (PWA)    | joiner | John   | PASS| PASS       |  n/a    | PASS  | PASS | S3. Mask held on rotate + background/return; call recovered. See F1
Android Chrome      | host   | John2  | PASS| PASS       |  n/a    | PASS  | PASS | S2. relay-only OK. See F1,F7
Android Chrome      | joiner | John2  | PASS| PASS       |  n/a    | PASS  | PASS | S1. Landscape controls hidden (F2). See F1,F5,F6,F3,F4
Desktop Firefox     | host   | John3  | PASS| PASS       |  n/a    | PASS  | PASS | S3. Host-initiated burn DID destroy the room (contrast F6). See F1
Desktop Firefox     | joiner | John3  | PASS| PASS       |  n/a    | PASS  | PASS | S2. relay verified via about:webrtc. F1 also here. F7,F9
Tor / .onion        | host   | —      | N/T | N/T        | N/T     | N/T   | N/T  | BLOCKED: no deployed .onion (Platform 4 prereq)
Tor / .onion        | joiner | —      | N/T | N/T        | N/T     | N/T   | N/T  | BLOCKED: no deployed .onion
```

**Findings (across Sessions 1–2):**

_Security / privacy — blocking:_

- **F1 [BLOCKING — privacy]: "MIC OFF" does not actually mute the
  microphone.** The button flips to "MIC OFF" and shows the muted-mic
  (slash) icon, but audio keeps transmitting to the peer. CAM OFF
  correctly stops the camera. **Confirmed on all three engines — iOS
  Safari, Android Chrome, and desktop Firefox** (global, not
  platform-specific). A mute control that does not mute is a privacy
  failure. (Cosmetic aside: MIC OFF renders gold, CAM OFF red.)
- **F6 [BLOCKING — security]: a JOINER's "Burn" does not actually destroy
  the room.** In Session 1 the Pixel (joiner) burned the room (overlay:
  "session burned, all keys destroyed"), yet the same phrase still
  re-entered the room (Pixel alone) and the iPhone then joined the
  supposedly-burned room. **Contrast Session 3**, where a HOST-initiated
  burn (Firefox) correctly ended the call and blocked re-joining with the
  same phrase. So burn is reliable host-side, but a joiner's burn leaves
  the room/phrase usable — the "all keys destroyed" claim is false for
  that path.
- **F5 [BLOCKING — functional]: With "knock" enabled, an admitted joiner
  gets no video and no audio.** Host enabled knock; the Pixel knocked and
  was admitted, but no camera feed appeared and there was no sound.

_Correctness / UX:_

- **F7 [UX/correctness]: Misleading "room destroyed" error when joining
  before the host is present.** Firefox joined before the Pixel host and
  saw "room destroyed - this url is gone. if you refresh, it should stay
  gone." The room was not destroyed — once the host joined, it worked.
- **F8 [UI/mobile]: Burn overlay is a dead end on phones.** It says "press
  ESC to close," but a phone has no ESC/back/home affordance; the tester
  was stuck ~1 minute before being returned to the preview screen.
- **F2 [UI]: Android landscape hides the bottom control bar.** On the
  Pixel/GrapheneOS/Chrome joiner in landscape, the browser address bar
  occupies the header and the controls fall off the bottom of the screen.
- **F3 [resilience]: Backgrounding drops to the preview gate.** On both
  phones (including the iOS PWA), backgrounding kicks the user to the
  preview screen; they must re-enter to rejoin — not recover-in-place.
- **F4 [resilience]: Host locking the phone locks the joiner out.** When
  the host iPhone was locked, the joiner (Pixel) was dropped from the call.
- **F9 [minor UI]: Firefox layout/mask only breaks at very small window
  sizes** — holds across normal breakpoints.

_Confirmed working:_ SAS match, relay-only enforcement (incl. Firefox
`about:webrtc` showing a relayed candidate pair), masked output both
directions, and preview-gate gating (camera/mic stay off until the gate is
passed + permission granted; denial shows a clear error) — PASS on every
tested pairing.

When the cycle is finished, flip Status to **COMPLETE**, fill the build
ref to the exact commit tested, and file a follow-on bug for every FAIL
(security-critical → blocking) per the section below.

## Filing follow-on bugs

This runbook **finds** problems; it does not fix them. For every FAIL:

1. File a follow-on bug task with: platform + OS/browser build, role
   (host/joiner), which invariant broke, exact repro steps, and what you
   expected vs observed.
2. Tag security-critical failures (SAS mismatch, clearnet leak,
   relay-only bypass, unmasked frame) as **blocking** — these are not
   cosmetic.
3. Link the bug back to the cycle date/commit in the matrix so the next
   tester knows it is known.

Do not attempt to "make the matrix green" by retrying until a flake
passes or by downgrading a security failure to cosmetic. An honest
N/T or FAIL is more valuable than a fabricated PASS.
