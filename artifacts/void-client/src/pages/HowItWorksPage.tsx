// SPDX-License-Identifier: AGPL-3.0-or-later
import PageShell from "@/components/PageShell";
import {
  sectionStyle,
  headingStyle,
  leadStyle as subheadStyle,
  tealText,
  burntText,
} from "@/components/longFormStyles";
import ReadMoreButton from "@/components/short-form/ReadMoreButton";

const sectionHeaderStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  fontSize: "16px",
  letterSpacing: "3px",
  textTransform: "uppercase",
  color: "var(--burnt)",
  marginTop: "28px",
  marginBottom: "16px",
};

export default function HowItWorksPage() {
  return (
    <PageShell backHref="/" backLabel="← BACK">
      <div style={sectionStyle}>
        <div style={headingStyle}>HOW IT WORKS</div>
        <div style={subheadStyle}>THE SHORT VERSION.</div>

        <p style={{ margin: "0 0 0" }}>
          Jeff Swanson distinguishes between promises and proofs. A promise
          is something a corporation makes in a document nobody reads. A
          proof is more like math. Math does not have a legal team.
        </p>

        <p style={sectionHeaderStyle}>WHAT VOID IS</p>
        <p style={{ margin: "0 0 12px" }}>
          VOID is a stateless, encrypted, peer-to-peer way for a few
          people to talk.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          No accounts. No recording. No transcript. No record of what was
          said by whom.
        </p>
        <p style={{ margin: "0 0 0" }}>
          Not because we are trustworthy. Because the architecture makes
          retention impossible. There is a difference.
        </p>

        <p style={sectionHeaderStyle}>THINGS THAT AREN’T HERE</p>
        <p style={{ margin: "0 0 12px" }}>
          There is no chat. There is no messenger.
        </p>
        <p style={{ margin: "0 0 0" }}>
          Instead there is DROP — a single shared field with no history.
          Anyone in the room can overwrite it. It exists so a URL or a
          room code can be passed from one person to the next. Nothing in
          it can be saved for later or searched next week.
        </p>

        <p style={sectionHeaderStyle}>THE SERVER</p>
        <p style={{ margin: "0 0 12px" }}>
          The server is a relay.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          A small <span style={tealText}>Lightning</span> payment opens
          the room. After that, while a room is live, the relay sees what
          relays must see — IP addresses, room codes, the times people
          joined and left.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          When the room closes, the relay forgets.{" "}
          <span style={tealText}>The server has the memory of a
          goldfish.</span>
        </p>
        <p style={{ margin: "0 0 0" }}>
          The server does not see your video. It does not hear your audio.
          It does not hold your keys. It cannot decrypt your signaling.
          The compromise of one session does not unlock any other session.
          These are not promises. They are architectural constraints.
        </p>

        <p style={sectionHeaderStyle}>THE SIX WORDS</p>
        <p style={{ margin: "0 0 12px" }}>
          Every session begins with a six-word phrase.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          No usernames. No passwords. No security questions about the
          names of pets.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          The words come from a list called{" "}
          <span style={tealText}>BIP-39</span>, and there are so many
          possible combinations that guessing one by brute force is not
          a real plan.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          The phrase never reaches the server.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          Feel free to share the phrase in an old way: say it aloud or
          write it on paper. Mostly, send it through some channel you
          already trust.
        </p>
        <p style={{ margin: "0 0 0" }}>
          Anyone with the phrase can enter the room. Anyone without it
          cannot. This is how things used to work, I am told, when people
          held the keys to their own doors.
        </p>

        <p style={sectionHeaderStyle}>WHAT THE ENCRYPTION DOES</p>
        <p style={{ margin: "0 0 12px" }}>
          Every call generates fresh keys. When the call ends, the keys
          are destroyed.
        </p>
        <p style={{ margin: "0 0 0" }}>
          A recording of your encrypted session captured from the wire
          today cannot be decrypted tomorrow, even if someone obtains the
          phrase a year from now.{" "}
          <span style={tealText}>The past is sealed against the
          future.</span> The future cannot access the past. We find this
          civilized.
        </p>

        <p style={sectionHeaderStyle}>YOUR FACE</p>
        <p style={{ margin: "0 0 12px" }}>
          A face is not neutral information.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          It carries geography and age and the specific geometry of bone
          that lets a machine find you in a database of ten million
          strangers in about four seconds. This capability exists right
          now and will not stop existing anytime soon.
        </p>
        <p style={{ margin: "0 0 0" }}>
          VOID processes your video on your own computer, before a single
          frame leaves it. You can show your face as it is, or you can
          choose a mode that makes you a pattern of gold, a grid of
          pixels, an outline, a silhouette, or a wall of text. Each mode
          removes a different amount of what a surveillance system would
          like to have. The strongest modes remove most of it. The weakest
          mode — <span style={burntText}>CLEAR</span> — removes none. The
          choice is yours.
        </p>

        <p style={sectionHeaderStyle}>YOUR VOICE</p>
        <p style={{ margin: "0 0 12px" }}>
          Your voice is as specific as your face.
        </p>
        <p style={{ margin: "0 0 0" }}>
          VOID can shift it, bend it, scramble it, or stack all three.
          You can also leave it alone. What you mean gets through. Who
          you are does not, unless you want it to.
        </p>

        <p style={sectionHeaderStyle}>WHAT WE LOG</p>
        <p style={{ margin: "0 0 12px" }}>
          The relay keeps the bare minimum it takes to run a public
          service, and forgets it within five days.
        </p>
        <p style={{ margin: "0 0 0" }}>
          It keeps timestamps, IP addresses, request paths, and
          connection events. It never keeps the six-word phrase. It never
          keeps your encrypted signaling content. It never keeps the room
          code on a successful request. Five days is a ceiling, not an
          aspiration. The production box enforces it with log rotation.
          It is a setting, not a promise.
        </p>

        <p style={sectionHeaderStyle}>THE PHILOSOPHY</p>
        <p style={{ margin: "0 0 12px" }}>
          Do not turn a room into a building.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          VOID is a room, a small place where a few people meet for a
          short time and then leave. A building has hallways and storage
          closets and a basement with boxes full of records. We have
          written down what we will and won’t add, so we don’t
          accidentally build a basement.
        </p>
        <p style={{ margin: "0 0 20px" }}>
          <a
            href={import.meta.env.BASE_URL + "VOID-Feature-Policy.md"}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--teal)", textDecoration: "underline" }}
          >
            Read the Feature Policy →
          </a>
        </p>
        <blockquote
          style={{
            borderLeft: "2px solid var(--burnt)",
            paddingLeft: "16px",
            margin: "0 0 28px",
            fontStyle: "italic",
          }}
        >
          <p style={{ margin: "0 0 8px" }}>
            “Privacy is not about something to hide. Privacy is about
            something to protect.”
          </p>
          <footer
            style={{
              fontStyle: "normal",
              fontSize: "11px",
              letterSpacing: "2px",
              color: "var(--burnt)",
            }}
          >
            — EDWARD SNOWDEN
          </footer>
        </blockquote>

        <ReadMoreButton href="/docs/how-it-works" />
      </div>
    </PageShell>
  );
}
