// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect } from "react";
import { Link } from "wouter";
import OpenBetaCaption from "@/components/OpenBetaCaption";
import PageShell from "@/components/PageShell";
import { sectionStyle, headingStyle } from "@/components/longFormStyles";
import ReadMoreButton from "@/components/short-form/ReadMoreButton";
import { whyAnchorRedirectTarget } from "@/components/short-form/anchorRedirects";
import { getOnionMirrorUrl } from "@/lib/onionMirror";

// /why is the short-form WHY page — the actual "why this project
// exists" prose, not a summary of the wonkish stuff. The wonkish
// content (Promise vs Proof, Encryption, Filters, Voice Masks,
// Stateless Architecture, What We Log) lives at /docs/how-it-works.
//
// The body is a first-person "founder's note": why this project
// exists (the watched-by-default web, the room with nothing in it to
// take, the structural proof that breaks on purpose) and the Gameboy
// origin of the 4-color look as "an act of refusal in 2026". The
// bottom-of-page CTA points BACK TO HOME rather than at the long form —
// HOW IT WORKS is now reachable from the global hamburger menu, so /why
// doesn't need to carry the deep link to it at the bottom of the page.

export default function WhyPage() {
  // Pre-existing /why#<anchor> deep links (#encryption, #philosophy,
  // #the-void-phrase, #video-filters, #voice-masks) now belong on the
  // wonkish page at /docs/how-it-works. The redirect target is owned
  // by anchorRedirects.ts so the test and the runtime agree.
  useEffect(() => {
    const target = whyAnchorRedirectTarget(
      window.location.hash,
      import.meta.env.BASE_URL,
    );
    if (target) {
      window.location.replace(target);
    }
  }, []);

  // Task #792 — the .onion-specific Tor remedy is only honest when this
  // build actually bakes a `.onion` mirror: an onion ORIGIN is what
  // triggers the unconditional relay-only ICE pin (lib/origin.ts), and
  // telling a worried reader to "reach us at our .onion" when no such
  // address exists for this instance would be a false safety promise.
  // Gated on the same signal as the footer OnionMirrorLink.
  const onionUrl = getOnionMirrorUrl();
  const torLinkStyle = {
    color: "var(--fg)",
    textDecoration: "underline",
    textDecorationColor: "var(--teal)",
    textUnderlineOffset: "2px",
  } as const;

  return (
    <PageShell backHref="/" backLabel="← BACK">
      {/* v0.6 / open beta acknowledgement — sits under the hamburger
          in the normal scrollable flow (not sticky). Pinned by
          __tests__/v05OpenBetaLabel.test.tsx. */}
      <OpenBetaCaption data-testid="why-v05-acknowledgement" />

      <div style={sectionStyle}>
        <div style={headingStyle}>WHY, a founder's note</div>

        <p style={{ margin: "0 0 20px" }}>
          Everything we say and do online is watched. We all know this. The
          watching is constant, and it feels exactly as creepy as it is.
          Worse, the records of our behavior can be subpoenaed, and they sit
          on servers — often unencrypted, always hackable — long after we’ve
          forgotten the conversation that made them. This is unacceptable,
          but somehow we’ve agreed to call it normal.
        </p>
        <p style={{ margin: "0 0 20px" }}>
          With that in mind, a little more privacy and a little more
          anonymity in our digital lives strikes me as downright wholesome.
        </p>
        <p style={{ margin: "0 0 28px" }}>
          This project wants a different default. One where a conversation
          can happen and then simply be over. Where a room can just be a
          room, and not an entry in a database. I am not trying to help
          anyone hide wrongdoing. I’m trying to restore something ordinary —
          the privacy of a private conversation. Government whistleblowers
          and survivors of domestic violence need to reach journalists and
          safe houses without leaving a trail. That’s not an edge case;
          that’s the point. If the goal sounds modest, it’s because it is.
        </p>
        <p style={{ margin: "0 0 28px" }}>
          And here is the part I’m proudest of:{" "}
          the room can’t betray you, because there is nothing in it to take.
          Your video never touches the server — it travels straight from you
          to the people you’re talking to. There’s no recording. No
          transcript. No list of who was there. No chat feature with a log. I
          didn’t build the things that could be turned against you,{" "}
          so I can’t hand over what I didn’t build.
        </p>
        <p style={{ margin: "0 0 28px" }}>
          I also don’t ask you to trust me on this. I’m a stranger on the
          internet, and you shouldn’t trust strangers on the internet. So
          the proof is written into the machine itself. If anyone tries to
          route your data out the back, the whole thing breaks on purpose.
          And you can easily see the break.
        </p>
        <p style={{ margin: "0 0 28px" }}>
          One honest caveat: the room will hide what you say, but not the
          bare fact that you connected. A server, like any server, will see
          an IP address.
          {!onionUrl && (
            <>
              {" "}If you need that hidden too, see{" "}
              <Link href="/tor" style={torLinkStyle}>
                how Tor helps →
              </Link>{" "}
              and the{" "}
              <Link href="/docs/threat-model" style={torLinkStyle}>
                threat model →
              </Link>
              .
            </>
          )}
        </p>
        {onionUrl && (
          <p style={{ margin: "0 0 28px" }}>
            If a network observer is part of what you’re worried about,{" "}
            reach VOID at its .onion address in Tor Browser. That hides from
            our server which network you connected from — the strongest
            IP-level protection we offer. It is not a cloak: the call’s media
            still travels over a relay that sees an address, and Tor does
            nothing about the other people in the room, your own device, or
            anyone who can see your screen. For the full picture of what this
            does and doesn’t protect, read{" "}
            <Link href="/tor" style={torLinkStyle}>
              how Tor helps →
            </Link>{" "}
            and the{" "}
            <Link href="/docs/threat-model" style={torLinkStyle}>
              threat model →
            </Link>
            .
          </p>
        )}

        <p
          style={{
            margin: "0 0 20px",
            color: "var(--gold)",
            letterSpacing: "2px",
            textTransform: "uppercase",
            fontSize: "13px",
          }}
        >
          ▌ Also, there was a Gameboy.
        </p>
        <p style={{ margin: "0 0 20px" }}>
          A while back I built a coding project that imagined what Zoom might
          have looked like if it had been born in the 1990s and lived on a
          classic Gameboy. The tiny screen and four colors led to some
          not-so-flattering distortions — and they were fun. I started
          wondering what those pixelated displays might actually be good for
          now, beyond nostalgia.
        </p>
        <p style={{ margin: "0 0 20px" }}>
          A 4-color, low-resolution version of you is still unmistakably you
          to a friend on the other end. The timing is right. The expressions
          land. But it cannot be fed into a face-recognition model. It cannot
          be used to train a deepfake of you. The texture that felt charming
          on a Gameboy in 1992 turns out to be something like{" "}
          an act of refusal in 2026.
        </p>
        <p style={{ margin: "0 0 28px" }}>
          That’s the thread the rest of this project pulls on.{" "}
          Enough presence to trust. Not enough to surveil. A room that ends
          when you leave it. A conversation that belongs, for a while, only
          to the people having it.
        </p>

        <ReadMoreButton href="/" label="← BACK TO HOME" />
      </div>
    </PageShell>
  );
}
