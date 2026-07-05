// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import DemoVideoEmbed from "@/components/DemoVideoEmbed";
import {
  sectionStyle,
  headingStyle,
  sectionHeadingStyle as subheadingStyle,
  dividerStyle,
  goldText,
  tealText,
  burntText,
} from "@/components/longFormStyles";

const modeNameStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "3px",
  textTransform: "uppercase",
  color: "var(--teal)",
  marginBottom: "4px",
  marginTop: "24px",
};

const modeSubStyle: React.CSSProperties = {
  color: "#9C8E7A",
  marginBottom: "12px",
};

const preservesStyle: React.CSSProperties = {
  marginBottom: "4px",
  marginTop: "12px",
};

const destroysStyle: React.CSSProperties = {
  marginBottom: "0",
};

export default function BiometricPage() {
  return (
    <PageShell backHref="/biometric-masking" backLabel="← BACK TO SHORT VERSION" footerPaddingTop="8px">
      {/* ── Opening ── */}
      <div style={sectionStyle}>
        <div style={headingStyle}>BIOMETRIC MASKING EXPLAINED</div>
        <div
          style={{
            ...headingStyle,
            color: "var(--teal)",
            fontSize: "clamp(14px, 3vw, 18px)",
            fontFamily: "var(--font-mono)",
            fontWeight: 400,
            marginBottom: "28px",
          }}
        >
          Your face is a database entry.
        </div>

        <p style={{ marginBottom: "16px" }}>
          A woman named Patricia attended a protest in 2019. She wore
          sunglasses. She kept her head down. She was careful. She was
          careful in the way that people are careful when they do not yet
          understand what careful means.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Three weeks later she received a letter. The letter was from an
          organization that had identified her from a photograph taken at
          approximately forty meters, cross-referenced against a database she
          had never consented to be in, derived from photographs she had
          posted publicly over eleven years because she thought she was
          sharing them with friends.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Patricia had not hidden her face. She had obscured it slightly.
        </p>
        <p style={{ marginBottom: "16px" }}>
          There is a difference between obscuring a face and making it useless
          as data.
        </p>
        <p style={{ marginBottom: "16px" }}>
          VOID is trying to do the second thing.
        </p>
        <p style={{ marginBottom: "24px" }}>
          We want to be precise about what that means, and honest about what it
          doesn’t.
        </p>

        <DemoVideoEmbed
          label="Demo / Biometric split-screen"
          src="biometric-demo.mp4"
          poster="biometric-demo-poster.jpg"
          ariaLabel="Split-screen demo: a normal webcam call on the left, what VOID transmits on the right"
          caption="Enough presence to trust. Not enough to surveil."
        />
      </div>

      <div style={dividerStyle} />

      {/* ── What a Biometric Asset Is ── */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHAT A BIOMETRIC ASSET IS
        </div>

        <p style={{ marginBottom: "16px" }}>
          When you join a video call on a normal platform, you transmit a
          biometric asset.
        </p>
        <p style={{ marginBottom: "16px" }}>
          This is not a metaphor. High-definition video of your face,
          transmitted cleanly over a network, is a reusable identification
          package. The geometry of your features — the distance between your
          eyes, the shape of your jaw, the particular architecture of your
          nose — can be extracted from a single frame and compared against
          databases containing hundreds of millions of entries in a fraction of
          a second.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Your voice is the same. The specific resonant frequencies of your
          throat, the pattern of your breath, the tonal signature that is yours
          and nobody else’s — these can be recorded, stored, and matched.
          Voiceprint technology is not science fiction. It is used in call
          centers, border control systems, and law enforcement databases
          around the world.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Clean audio and clean video together are worth more than either alone.
          They are the raw material of a deepfake. A few minutes of your face
          and voice, captured in high definition, is enough for a competent
          system to generate new video of you saying things you never said.
          This is not a warning about the future. It is a description of the
          present.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Most video conferencing tools transmit all of this by default, because
          transmitting your face faithfully is what video conferencing is
          designed to do. Fidelity is the product. The surveillance potential is
          a byproduct that nobody originally planned for and that nobody is now
          particularly motivated to remove.
        </p>
        <p style={{ marginBottom: "16px" }}>
          VOID does not transmit your face faithfully.
        </p>
        <p style={{ marginBottom: "16px" }}>
          VOID transmits something that proves you are present and human and
          engaged, without providing the raw material that makes you findable
          and matchable.
        </p>
        <p style={{ marginBottom: "16px" }}>
          We call this <span style={tealText}>reduced exposure</span>. Not
          anonymity.
        </p>
        <p style={{ marginBottom: "0" }}>
          The difference matters and we will explain it{" "}
          <a href="#reduced-exposure" style={{ color: "var(--teal)" }}>at the end</a>.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* ── The Six Video Modes ── */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> THE SIX VIDEO MODES
        </div>

        <p style={{ marginBottom: "16px" }}>
          All video processing happens on your device, in your GPU, before a
          single frame leaves your machine. The shader runs locally. The
          original image never travels anywhere. What the network sees is the
          output, not the source.
        </p>
        <p style={{ marginBottom: "12px" }}>
          Here is what each mode does.
        </p>
        <p style={{ marginBottom: "0", color: "#9C8E7A", fontStyle: "italic" }}>
          The six modes are not equivalent.{" "}
          <span style={tealText}>CONTOUR</span> and{" "}
          <span style={tealText}>ASCII</span> strip the most biometric
          utility. <span style={goldText}>GOLD</span>,{" "}
          <span style={goldText}>PIXEL</span>, and{" "}
          <span style={goldText}>SILHOUETTE</span> reduce that utility without
          erasing it. <span style={burntText}>CLEAR</span> transmits your
          face. Pick the strongest mode the conversation tolerates.
        </p>

        {/* CLEAR */}
        <div style={modeNameStyle}>CLEAR</div>
        <p style={modeSubStyle}>
          Full exposure. Your face. Your choice.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Clear mode transmits your unmodified camera feed. No processing. No
          shader. Just you, at 320×240 pixels, 15 frames per second — well
          below the resolution of a typical webcam, but still enough to see a
          face clearly.
        </p>
        <p style={{ marginBottom: "16px" }}>
          We include Clear mode because we are not in the business of making
          decisions for you. Some conversations call for it. Talking to your
          lawyer, perhaps, or a doctor, or someone who needs to see your face
          to understand what you are going through. Some human moments require
          full presence. We are not going to stand in the way of those moments.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> Everything.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> Nothing.
        </p>
        <p style={{ marginTop: "12px", marginBottom: "0", color: "#9C8E7A" }}>
          Use it when full presence is the point.
        </p>

        {/* GOLD */}
        <div style={modeNameStyle}>GOLD</div>
        <p style={modeSubStyle}>
          Duotone luminance mapping. The signature look.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Gold mode takes the light and dark values of your face and maps them
          onto two colors: a deep warm black and a luminous amber gold. The
          result is something between a photograph and a woodcut. You look like
          a person rendered in precious metal.
        </p>
        <p style={{ marginBottom: "16px" }}>
          More importantly, it is useful. The duotone mapping eliminates the
          color gradients that allow software to identify things like the
          specific spectrum of your home’s LED lighting, which can be used to
          place you in a geographic region, or to match you against other
          footage shot in the same room at a different time. These are
          documented techniques.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Layered on top of the duotone is a spatial softening. The center of
          the frame — where, by the convention of a centered camera, a face
          usually sits — is pixelated and blurred more heavily than the
          perimeter, with the strength fading smoothly outward. This is not
          face tracking. It does not follow your eyes. It is a screen-anchored
          vignette that leans on the geometry of how people aim their webcams
          to add an extra layer of obscurity in the place features are most
          likely to be.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> Motion, gesture,
          timing, body language, liveness, emotional expression.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> Facial geometry
          detail, skin texture, color information, lighting fingerprint.
        </p>

        {/* PIXEL */}
        <div style={modeNameStyle}>PIXEL</div>
        <p style={modeSubStyle}>
          40×30 grid pixelation. Presence without detail.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Pixel mode divides your image into a grid of large colored
          squares — forty columns, thirty rows. Each square takes the average
          color of the pixels inside it. What remains is a blocky,
          impressionistic rendering that communicates roughly where your face is
          and what general shape your expressions are taking.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A human being looking at Pixel mode sees another human being. A
          facial recognition system looking at Pixel mode sees nothing it can
          use. The geometry is gone. The landmarks — the precise location of
          eyes, nose, mouth, jaw — are averaged into colored rectangles.
        </p>
        <p style={{ marginBottom: "16px" }}>
          You are a person in a room. That is all anyone needs to know.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> Large gestures, head
          position, general emotional state, liveness.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> Facial landmarks,
          feature geometry, skin detail, identifiable features.
        </p>

        {/* CONTOUR */}
        <div style={modeNameStyle}>CONTOUR</div>
        <p style={modeSubStyle}>
          Sobel edge detection. The outline of a human being.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Contour mode runs a mathematical operation called Sobel edge detection
          across your image. It finds the boundaries between light and dark —
          the edges of your face, the outline of your hair, the line of your
          jaw — and renders them as white lines against a black background.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The result is a drawing. A sketch. The kind of thing a courtroom
          artist might produce if they were very fast and very precise and
          working in a medium of pure mathematics.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A facial recognition system needs texture and geometry to work. It
          needs the surface of a face. Contour mode gives it only the
          perimeter. The inside — the features, the details, the data — is
          gone.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> Head shape, major
          facial structure, movement, gesture, expression through outline.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> Surface texture,
          color, interior facial geometry, skin detail.
        </p>

        {/* SILHOUETTE */}
        <div style={modeNameStyle}>SILHOUETTE</div>
        <p style={modeSubStyle}>
          Luma threshold masking. Shape only.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Silhouette mode goes further than Contour. It applies a luminance
          threshold — a brightness cutoff — and renders everything above it as
          gold and everything below it as near-black. What remains is a shape.
          A form. A person-shaped area of light against dark.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Features do not survive this. Eyes, nose, mouth — they become part of
          the shape rather than landmarks within it. You are present in the most
          fundamental sense: there is a human being in this room, occupying
          this space, moving in this way. That is the entire message.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> Presence,
          silhouette, major movement, rough head position.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> All facial features,
          all surface detail, all geometry. Everything except shape.
        </p>

        {/* ASCII */}
        <div style={modeNameStyle}>ASCII</div>
        <p style={modeSubStyle}>
          Character rendering. You become text.
        </p>
        <p style={{ marginBottom: "16px" }}>
          ASCII mode is our favorite. We have said this before on other pages.
          We will keep saying it.
        </p>
        <p style={{ marginBottom: "16px" }}>
          ASCII mode divides your image into small cells and replaces each one
          with a character from a sixteen-symbol set:{" "}
          <span style={goldText}>“ .:-=+*#%@WMBN&$”</span>. Dark areas become
          spaces and dots. Medium areas become dashes and plus signs. Light
          areas become dense characters — ampersands, dollar signs, the letter
          M, which is the widest and heaviest character in the set and therefore
          the brightest.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The result is a real-time ASCII art rendering of your face. You become
          text on a screen.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A facial recognition system presented with ASCII output sees a field
          of characters. It cannot extract geometry from punctuation. It cannot
          build a biometric profile from the letter W. What you have transmitted
          is a representation of your face in a medium that no identification
          system was designed to process.
        </p>
        <p style={{ marginBottom: "16px" }}>
          There is also something philosophically correct about this. We are
          all, in some sense, characters in someone else’s story. ASCII mode
          makes this literal.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> Broad luminance
          patterns, large movements, general presence, a kind of pixelated
          emotional legibility.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> All facial geometry,
          all feature detail, all biometric utility.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* ── The Five Voice Modes ── */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> THE FIVE VOICE MODES
        </div>

        <p style={{ marginBottom: "16px" }}>
          Your voice, transmitted cleanly, is also an identification document.
        </p>
        <p style={{ marginBottom: "16px" }}>
          It carries your pitch, your tonal signature, the resonant frequencies
          of your specific body, the patterns of emphasis and rhythm that are
          yours and nobody else’s. Voiceprint matching technology can identify
          you from a few seconds of speech. It is in active use. It is getting
          more accurate every year.
        </p>
        <p style={{ marginBottom: "12px" }}>
          VOID processes your audio locally, on a dedicated thread that never
          touches the main application, before a single sound leaves your
          device. Five modes are available. They form a clean arc from no
          interference to total destruction. You choose where on that arc to
          stand.
        </p>
        <p style={{ marginBottom: "0", color: "#9C8E7A", fontStyle: "italic" }}>
          The five modes are not equivalent.{" "}
          <span style={burntText}>CLEAR VOICE</span> is a passthrough — your
          voiceprint travels intact.{" "}
          <span style={tealText}>DEEP</span>,{" "}
          <span style={tealText}>FORMANT</span>, and{" "}
          <span style={tealText}>SCRAMBLE</span> each remove different parts
          of it. <span style={goldText}>COMBINED</span> removes nearly all of
          it. Pick the strongest mode the conversation tolerates.
        </p>

        {/* CLEAR VOICE */}
        <div style={modeNameStyle}>CLEAR VOICE</div>
        <p style={modeSubStyle}>
          Passthrough. Your unmodified voice.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Clear Voice mode transmits your audio as captured, processed only by the
          noise gate and dynamics compressor that clean up room noise and
          normalize levels. Your voice arrives as your voice.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Use it when you feel secure. Use it when you have decided that the
          call does not require voice masking and you have made that decision
          deliberately rather than by not thinking about it.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> Everything.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> Nothing.
        </p>

        {/* DEEP */}
        <div style={modeNameStyle}>DEEP</div>
        <p style={modeSubStyle}>
          Heavy pitch displacement with slow drift. Not your voice.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Deep mode shifts your voice downward — far enough that the tonal
          signature that makes your voice yours is no longer recognizable as
          yours — and then drifts that shift slowly over time with a
          low-frequency oscillator. The displacement does not sit still. It
          moves.
        </p>
        <p style={{ marginBottom: "16px" }}>
          This matters because a static pitch shift, applied consistently, can
          itself become a fingerprint. A moving shift cannot. What comes out is
          large, slow, and human in shape, but unfamiliar in character. The
          voice of someone speaking from the bottom of something very deep,
          which is not entirely inaccurate as a description of why people use
          this mode.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> Cadence, emphasis,
          rhythm, broad emotional tone, intelligibility.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> Voiceprint, pitch
          profile, tonal signature, the specific frequencies that make your
          voice yours.
        </p>

        {/* FORMANT */}
        <div style={modeNameStyle}>FORMANT</div>
        <p style={modeSubStyle}>
          Dual-LFO pitch modulation over a synthetic carrier.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Formant mode is the strange one. It applies two separate oscillators
          to your voice — a slow wave that drifts through a wide pitch range
          over several seconds, and a faster oscillator that adds a vibrato
          beneath it — layered over a sawtooth carrier signal.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The result is human in shape and alien in character. It communicates
          that there is a person there, that they have intent, that they feel
          something about what they are saying. It does not communicate who that
          person is. Their voice has become a kind of instrument, playing their
          meaning without revealing their identity.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> Emotional contour,
          emphasis, intent, the general rhythm of speech.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> Voiceprint, tonal
          signature, pitch profile, the quality that makes a voice recognizable.
        </p>

        {/* SCRAMBLE */}
        <div style={modeNameStyle}>SCRAMBLE</div>
        <p style={modeSubStyle}>
          Granular time-shuffling. Your meaning, someone else’s fingerprints.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Scramble mode takes small grains of your audio — eight simultaneous
          slices of sound — and shuffles them. Not randomly enough that the
          meaning dissolves, but enough that the acoustic signature is broken up
          and reassembled in a different order.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Speech stays intelligible. You can be understood. But the
          voiceprint — the statistical pattern of your particular voice over
          time — does not survive the shuffling. What comes through is your
          meaning, traveling in a voice that no longer has your fingerprints on
          it.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> Word-level
          intelligibility, general meaning, broad emotional tone.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> Acoustic
          fingerprint, voiceprint, tonal continuity.
        </p>

        {/* COMBINED */}
        <div style={modeNameStyle}>COMBINED</div>
        <p style={modeSubStyle}>
          Everything, layered. Maximum voice destruction.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Combined mode runs your voice through the full chain: deep pitch
          displacement with drift, dual-LFO formant modulation over a sawtooth
          carrier, and granular scatter, all applied in sequence.
        </p>
        <p style={{ marginBottom: "16px" }}>
          What comes out is barely recognizable as speech. It is recognizable as
          communication — there is someone there, they have something to say,
          the rhythm of language is present — but the voice that carries it is
          no longer yours in any sense that a machine can measure.
        </p>
        <p style={{ marginBottom: "16px" }}>
          We include it because some situations call for maximum voice
          destruction and we are not here to ask which situations those are.
        </p>
        <p style={preservesStyle}>
          <span style={tealText}>What it preserves:</span> The fact that a
          human being is speaking. Occasionally: intent.
        </p>
        <p style={destroysStyle}>
          <span style={burntText}>What it destroys:</span> Everything else.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* ── All Processing Is Local ── */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> ALL PROCESSING IS LOCAL
        </div>

        <p style={{ marginBottom: "16px" }}>
          The video shader runs on your GPU. On your device. In your machine.
          Before a single frame leaves your browser.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The audio worklet runs on a dedicated audio rendering thread. On your
          device. In your machine. Before a single sample leaves your browser.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The server never receives an unmasked frame. The server never receives
          an unmasked audio sample. There is no server-side copy of your
          original face or voice. There is no unmask button on our end — not
          because we have chosen not to build one, but because we do not have
          the data that such a button would require.
        </p>
        <p style={{ marginBottom: "16px" }}>
          You cannot hand over what you do not have.
        </p>
        <p style={{ marginBottom: "16px", ...goldText }}>
          We do not have it.
        </p>
        <p style={{ marginBottom: "0" }}>
          The original stays on your machine. The processed version travels the
          network. When the session ends, both are gone.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* ── What This Does Not Do ── */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHAT THIS DOES NOT DO
        </div>

        <p style={{ marginBottom: "16px" }}>
          A tool does what it does.
        </p>

        <p style={{ marginBottom: "8px", ...burntText, fontWeight: 700 }}>
          It does not make you anonymous to someone who already knows you.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If your mother is on the call, she will recognize your Gold-filtered
          silhouette and your pitch-displaced voice, because she has known you
          for your entire life and human pattern recognition is extraordinary
          and she loves you and love pays very close attention. The masks are
          designed to defeat machines and databases. Not people who love you.
        </p>

        <p style={{ marginBottom: "8px", ...burntText, fontWeight: 700 }}>
          It does not protect against screen recording.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If someone in your room points a second device at their screen, that
          device captures what their screen displays. What their screen
          displays is the masked output — the gold duotone, the ASCII render,
          the processed voice — which is better than nothing. But a recording
          exists. VOID cannot reach through the network and prevent someone
          from pressing record on a separate machine. No software can.
        </p>

        <p style={{ marginBottom: "8px", ...burntText, fontWeight: 700 }}>
          It does not defeat a determined adversary with access to your device.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If your device is compromised before you open VOID, the malware has
          access to your camera and microphone before the masks are applied.
          The masks process what they receive. They cannot protect what they
          never see.
        </p>

        <p style={{ marginBottom: "8px", ...burntText, fontWeight: 700 }}>
          It does not reduce your exposure to zero.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The masks reduce your biometric surface area substantially. They do
          not reduce it to zero. A human being who sees your silhouette and
          hears your scrambled voice knows that a human being is present, is
          communicating, has a rough physical shape. That is some information.
          Less than your face and voice in high definition. Not nothing.
        </p>
        <p style={{ marginBottom: "0" }}>
          The goal is not zero exposure. Zero exposure is a phone call with no
          video, or a text message, or silence. The goal is enough presence to
          trust someone, without providing the raw material that makes you
          findable, matchable, or reproducible in a database you never agreed
          to be in.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* ── The Right Framing ── */}
      <div id="reduced-exposure" style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={tealText}>▌</span>{" "}
          <span style={tealText}>THE RIGHT FRAMING</span>
        </div>

        <p style={{ marginBottom: "16px" }}>
          Patricia, from the beginning of this page, was trying to hide.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Hiding is difficult. Hiding requires perfection. One visible feature,
          one identifiable detail, and the hiding fails.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Reduced exposure is different. Reduced exposure does not require
          perfection. It requires making the data less useful — degrading it
          from surveillance-grade to presence-grade. From a biometric asset to
          a human signal.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A gold duotone of your face is not your face. A scrambled version of
          your voice is not your voice. They are evidence that a person is
          there, paying attention, feeling something, responding in real time.
        </p>
        <p style={{ marginBottom: "16px" }}>
          That is all a conversation requires.
        </p>
        <p style={{ marginBottom: "16px", ...goldText }}>
          The goal is not to hide.
        </p>
        <p style={{ marginBottom: "0", ...goldText }}>
          The goal is to be present without becoming a permanent record.
        </p>
      </div>

      {/* ── CTA Row ── */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "12px",
          padding: "28px 24px",
          maxWidth: "680px",
          width: "100%",
          backgroundColor: "var(--surface-dark)",
          backgroundImage:
            "linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('/concrete.jpeg')",
          backgroundSize: "auto, 400px auto",
          backgroundRepeat: "repeat",
        }}
      >
        <Link
          href="/"
          style={{
            border: "2px solid var(--gold)",
            padding: "12px 20px",
            color: "var(--gold)",
            textDecoration: "none",
            fontSize: "12px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            fontFamily: "var(--font-mono)",
          }}
        >
          START A ROOM
        </Link>
        <Link
          href="/threat-model"
          style={{
            border: "2px solid var(--burnt)",
            padding: "12px 20px",
            color: "var(--burnt)",
            textDecoration: "none",
            fontSize: "12px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            fontFamily: "var(--font-mono)",
          }}
        >
          READ THE THREAT MODEL
        </Link>
        <Link
          href="/compare"
          style={{
            border: "2px solid var(--burnt)",
            padding: "12px 20px",
            color: "var(--burnt)",
            textDecoration: "none",
            fontSize: "12px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            fontFamily: "var(--font-mono)",
          }}
        >
          WHY NOT ZOOM?
        </Link>
      </div>

    </PageShell>
  );
}
