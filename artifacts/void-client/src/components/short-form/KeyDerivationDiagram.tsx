// SPDX-License-Identifier: AGPL-3.0-or-later
// Hand-coded SVG replacement for the ASCII VOID-key-derivation diagram
// that previously lived inside the long-form WHY page. Lives on
// /docs/how-it-works under the ENCRYPTION section.
//
// Responsive via viewBox; scales sharp on retina; accessible via
// <title>/<desc> + role="img" + aria-labelledby. Two-column flow
// (PEER A | PEER B) matches the prior ASCII layout so prose around
// it ("From this, HKDF domain separation produces two distinct keys…")
// still reads correctly.
//
// Palette: gold (#E8A200) for structural strokes and headers,
// teal (#0D9D8B) for key outputs and the encrypted-channel line.
// Dark fill (#14110D) matches the page background.

export default function KeyDerivationDiagram() {
  const gold = "#E8A200";
  const teal = "#0D9D8B";
  const bg = "var(--surface-dark)";
  const dim = "#9C8E7A";
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  // x-centers for the two peer columns
  const aX = 130;
  const bX = 470;
  const boxW = 180;
  const boxH = 56;
  const half = boxW / 2;

  // y-centers for the five row tiers
  const yPhrase = 60;
  const yArgon = 160;
  const yHkdf = 260;
  const ySession = 360;
  const ySas = 360;

  const Box = ({
    x,
    y,
    line1,
    line2,
    stroke = gold,
    textColor = gold,
  }: {
    x: number;
    y: number;
    line1: string;
    line2?: string;
    stroke?: string;
    textColor?: string;
  }) => (
    <g>
      <rect
        x={x - half}
        y={y - boxH / 2}
        width={boxW}
        height={boxH}
        fill={bg}
        stroke={stroke}
        strokeWidth={2}
      />
      <text
        x={x}
        y={line2 ? y - 4 : y + 5}
        fill={textColor}
        fontFamily={mono}
        fontSize={13}
        fontWeight={700}
        textAnchor="middle"
        letterSpacing="1.5"
      >
        {line1}
      </text>
      {line2 ? (
        <text
          x={x}
          y={y + 16}
          fill={textColor}
          fontFamily={mono}
          fontSize={11}
          textAnchor="middle"
          letterSpacing="1"
        >
          {line2}
        </text>
      ) : null}
    </g>
  );

  const Arrow = ({ x, y1, y2 }: { x: number; y1: number; y2: number }) => (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2 - 8} stroke={gold} strokeWidth={2} />
      <polygon
        points={`${x - 5},${y2 - 8} ${x + 5},${y2 - 8} ${x},${y2}`}
        fill={gold}
      />
    </g>
  );

  return (
    <svg
      viewBox="0 0 600 460"
      role="img"
      aria-labelledby="kdf-title kdf-desc"
      style={{
        width: "100%",
        height: "auto",
        maxWidth: "640px",
        display: "block",
        margin: "12px auto 0",
        border: `2px solid ${teal}`,
        backgroundColor: "rgba(13,157,139,0.06)",
        padding: "8px",
        boxSizing: "border-box",
      }}
    >
      <title id="kdf-title">VOID key derivation</title>
      <desc id="kdf-desc">
        Both peers independently derive a session key and a verification key
        from the same six-word VOID phrase. The phrase is fed through
        Argon2id with 64 MiB of memory and three passes, then through HKDF
        domain separation, producing a session encryption key and a Short
        Authentication String key. The two peers’ session keys agree and
        carry the encrypted WebRTC channel. The server relays signals but
        never holds keys or content; when the room closes all keys are
        destroyed and past sessions cannot be decrypted.
      </desc>

      {/* Column headers */}
      <text
        x={aX}
        y={22}
        fill={gold}
        fontFamily={mono}
        fontSize={14}
        fontWeight={700}
        textAnchor="middle"
        letterSpacing="3"
      >
        PEER A
      </text>
      <text
        x={bX}
        y={22}
        fill={gold}
        fontFamily={mono}
        fontSize={14}
        fontWeight={700}
        textAnchor="middle"
        letterSpacing="3"
      >
        PEER B
      </text>

      {/* Row 1: 6-WORD VOID PHRASE — shared secret line between */}
      <Box x={aX} y={yPhrase} line1="6-WORD VOID" line2="PHRASE" />
      <Box x={bX} y={yPhrase} line1="6-WORD VOID" line2="PHRASE" />
      <line
        x1={aX + half}
        y1={yPhrase}
        x2={bX - half}
        y2={yPhrase}
        stroke={dim}
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <text
        x={(aX + bX) / 2}
        y={yPhrase - 6}
        fill={dim}
        fontFamily={mono}
        fontSize={10}
        textAnchor="middle"
        letterSpacing="1.5"
      >
        SHARED SECRET
      </text>

      <Arrow x={aX} y1={yPhrase + boxH / 2} y2={yArgon - boxH / 2} />
      <Arrow x={bX} y1={yPhrase + boxH / 2} y2={yArgon - boxH / 2} />

      {/* Row 2: ARGON2ID */}
      <Box x={aX} y={yArgon} line1="ARGON2ID" line2="64 MiB · 3 PASS" />
      <Box x={bX} y={yArgon} line1="ARGON2ID" line2="64 MiB · 3 PASS" />

      <Arrow x={aX} y1={yArgon + boxH / 2} y2={yHkdf - boxH / 2} />
      <Arrow x={bX} y1={yArgon + boxH / 2} y2={yHkdf - boxH / 2} />

      {/* Row 3: HKDF DOMAIN SEPARATION */}
      <Box x={aX} y={yHkdf} line1="HKDF DOMAIN" line2="SEPARATION" />
      <Box x={bX} y={yHkdf} line1="HKDF DOMAIN" line2="SEPARATION" />

      {/* Row 4: split into SESSION KEY + SAS KEY for each peer.
          Left side of each HKDF box → SESSION KEY at x-30, right
          side → SAS KEY at x+30, drawn as two narrower boxes per peer. */}
      {[aX, bX].map((cx) => {
        const sessX = cx - 50;
        const sasX = cx + 50;
        return (
          <g key={cx}>
            {/* split arrows */}
            <line
              x1={cx}
              y1={yHkdf + boxH / 2}
              x2={cx}
              y2={yHkdf + boxH / 2 + 14}
              stroke={gold}
              strokeWidth={2}
            />
            <line
              x1={sessX}
              y1={yHkdf + boxH / 2 + 14}
              x2={sasX}
              y2={yHkdf + boxH / 2 + 14}
              stroke={gold}
              strokeWidth={2}
            />
            <Arrow
              x={sessX}
              y1={yHkdf + boxH / 2 + 14}
              y2={ySession - 18}
            />
            <Arrow x={sasX} y1={yHkdf + boxH / 2 + 14} y2={ySas - 18} />
            <text
              x={sessX}
              y={ySession - 4}
              fill={teal}
              fontFamily={mono}
              fontSize={11}
              fontWeight={700}
              textAnchor="middle"
              letterSpacing="2"
            >
              SESSION KEY
            </text>
            <text
              x={sasX}
              y={ySas - 4}
              fill={teal}
              fontFamily={mono}
              fontSize={11}
              fontWeight={700}
              textAnchor="middle"
              letterSpacing="2"
            >
              SAS KEY
            </text>
            <text
              x={sasX}
              y={ySas + 10}
              fill={dim}
              fontFamily={mono}
              fontSize={9}
              textAnchor="middle"
            >
              (verify)
            </text>
          </g>
        );
      })}

      {/* Encrypted P2P channel between the two SESSION KEYs */}
      <line
        x1={aX - 50}
        y1={ySession + 24}
        x2={aX - 50}
        y2={ySession + 60}
        stroke={teal}
        strokeWidth={2}
      />
      <line
        x1={bX - 50}
        y1={ySession + 24}
        x2={bX - 50}
        y2={ySession + 60}
        stroke={teal}
        strokeWidth={2}
      />
      <line
        x1={aX - 50}
        y1={ySession + 60}
        x2={bX - 50}
        y2={ySession + 60}
        stroke={teal}
        strokeWidth={2}
      />
      <text
        x={(aX + bX) / 2 - 50}
        y={ySession + 80}
        fill={teal}
        fontFamily={mono}
        fontSize={12}
        fontWeight={700}
        textAnchor="middle"
        letterSpacing="3"
      >
        ENCRYPTED WebRTC · P2P
      </text>

      {/* Footer band */}
      <rect
        x={10}
        y={420}
        width={580}
        height={32}
        fill="none"
        stroke={gold}
        strokeWidth={2}
      />
      <text
        x={300}
        y={440}
        fill={gold}
        fontFamily={mono}
        fontSize={11}
        textAnchor="middle"
        letterSpacing="1.5"
      >
        SERVER RELAYS SIGNALS · NEVER SEES KEYS OR CONTENT · PAST SESSIONS
        UNDECRYPTABLE
      </text>
    </svg>
  );
}
