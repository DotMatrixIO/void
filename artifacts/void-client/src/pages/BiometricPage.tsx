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

const modeStyle: React.CSSProperties = { margin: "0 0 14px" };

export default function BiometricPage() {
  return (
    <PageShell backHref="/" backLabel="← BACK">
      <div style={sectionStyle}>
        <div style={headingStyle}>BIOMETRIC MASKING</div>
        <div style={subheadStyle}>YOUR FACE IS A DATABASE ENTRY.</div>

        <p style={{ margin: "0 0 12px" }}>
          A woman named Patricia went to a protest in 2025. She wore
          sunglasses. She kept her head down. She was careful in the way
          that people are careful before they understand what careful
          means.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          Three weeks later she got a letter. The letter said that it
          knew who she was, and the letter was right.
        </p>
        <p style={{ margin: "0 0 0" }}>
          Patricia had not hidden her face. She had obscured it slightly.
          There is a difference.
        </p>

        <p style={sectionHeaderStyle}>
          WHAT YOU TRANSMIT ON A NORMAL VIDEO CALL
        </p>
        <p style={{ margin: "0 0 12px" }}>
          A face, in high definition, is a reusable identification
          package.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          The distance between your eyes. The shape of your jaw. The
          architecture of your nose. These can be extracted and matched
          against databases in a fraction of a second.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          Your voice is the same. The resonant frequencies of your throat
          are as specific to you as a fingerprint.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          Clean video and clean audio together are worth more than either
          alone. They are, in fact, the raw material of a deepfake.
        </p>
        <p style={{ margin: "0 0 0" }}>
          Most video tools transmit all of this by default. HD fidelity
          is the product. Surveillance is the byproduct, and nobody is
          particularly motivated to remove it.
        </p>

        <p style={sectionHeaderStyle}>WHAT VOID DOES INSTEAD</p>
        <p style={{ margin: "0 0 16px" }}>
          Your video is processed by your own computer, before a single
          frame leaves it. You can choose how much of your face to send.
        </p>
        <p style={modeStyle}>
          <span style={burntText}>CLEAR</span> sends your face as it is.
          For conversations with your lawyer, doctor, or kid.
        </p>
        <p style={modeStyle}>
          <span style={tealText}>GOLD</span> maps your face onto two
          colors — a deep warm black and a luminous amber. You become a
          person rendered in precious metal.
        </p>
        <p style={modeStyle}>
          <span style={tealText}>PIXEL</span> turns you into a grid of
          colored squares. A human sees a human. A machine sees colored
          rectangles.
        </p>
        <p style={modeStyle}>
          <span style={tealText}>CONTOUR</span> keeps the outline of
          your face and discards the inside. You become a sketch.
        </p>
        <p style={modeStyle}>
          <span style={tealText}>SILHOUETTE</span> keeps only your shape.
          You are a person-shaped area of light against dark.
        </p>
        <p style={modeStyle}>
          <span style={tealText}>ASCII</span> turns you into text on a
          screen. This one is our favorite. We are all such characters.
        </p>
        <p style={{ margin: "0 0 0" }}>
          The modes are not equivalent.{" "}
          <span style={tealText}>CONTOUR</span> and{" "}
          <span style={tealText}>ASCII</span> destroy the most biometric
          information. <span style={tealText}>GOLD</span>,{" "}
          <span style={tealText}>PIXEL</span>, and{" "}
          <span style={tealText}>SILHOUETTE</span> reduce it without
          erasing it. <span style={burntText}>CLEAR</span> transmits
          everything.
        </p>

        <p style={sectionHeaderStyle}>WHAT VOID DOES TO YOUR VOICE</p>
        <p style={modeStyle}>
          <span style={burntText}>CLEAR VOICE</span> transmits your
          voice as it is.
        </p>
        <p style={modeStyle}>
          <span style={tealText}>DEEP</span> shifts your voice downward
          and drifts the shift slowly, so it cannot become a fingerprint
          of its own.
        </p>
        <p style={modeStyle}>
          <span style={tealText}>FORMANT</span> is a strange one. Your
          voice becomes its own instrument, drifting through rhythms and
          pitches it didn’t start with.
        </p>
        <p style={modeStyle}>
          <span style={tealText}>SCRAMBLE</span> breaks your audio into
          small grains and shuffles them. Speech stays intelligible. The
          voiceprint does not survive.
        </p>
        <p style={{ margin: "0 0 0" }}>
          <span style={tealText}>COMBINED</span> does all of these at
          once. What comes out is recognizable as speech. But it is not
          recognizable as yours.
        </p>

        <p style={sectionHeaderStyle}>WHERE THE PROCESSING HAPPENS</p>
        <p style={{ margin: "0 0 12px" }}>
          The video mask runs on your GPU. The audio mask runs on a
          dedicated thread. Both run on your machine, before the stream
          leaves.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          The server never receives an unmasked frame. The server never
          receives an unmasked audio sample.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          There is no unmask button on our end. Not because we chose not
          to build one. Because we do not have the data such a button
          would require.
        </p>
        <p style={{ margin: "0 0 0" }}>
          <span style={tealText}>
            You cannot hand over what you do not have, and we do not have
            it.
          </span>
        </p>

        <p style={sectionHeaderStyle}>WHAT THIS DOES NOT DO</p>
        <p style={{ margin: "0 0 12px" }}>
          The masks are designed to defeat machines and databases. They
          are not designed to defeat your sister.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          If someone in your room points a second device at their screen,
          a recording exists. VOID cannot prevent that.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          If your device is already compromised, the malware sees what
          your camera sees before any mask is applied. The masks process
          what they receive. They cannot protect what they never see.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          The masks reduce your exposure substantially, but they do not
          reduce it to zero. Zero exposure is a phone call with no video,
          a text message, or silence.
        </p>
        <p style={{ margin: "0 0 0" }}>
          The goal is not zero.{" "}
          <span style={tealText}>The goal is reduced exposure.</span>
        </p>

        <p style={sectionHeaderStyle}>THE RIGHT FRAMING</p>
        <p style={{ margin: "0 0 12px" }}>Patricia was trying to hide.</p>
        <p style={{ margin: "0 0 12px" }}>
          Hiding is difficult because it requires perfection. One visible
          feature and the hiding can fail.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          Reduced exposure is different. Reduced exposure does not
          require perfection. Patricia never knew that her obscured
          appearance kept her presence from being entered into four other
          databases that day.
        </p>
        <p style={{ margin: "0 0 28px" }}>
          <span style={tealText}>
            The goal is not to hide. The goal is to be present with your
            people without becoming a permanent record.
          </span>
        </p>

        <ReadMoreButton href="/docs/biometric" />
      </div>
    </PageShell>
  );
}
