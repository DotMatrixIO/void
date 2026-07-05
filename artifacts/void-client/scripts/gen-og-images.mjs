// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * gen-og-images.mjs
 *
 * Generates one 1200x630 PNG Open Graph card per marketing route.
 *
 * Run from the artifacts/void-client directory:
 *   node scripts/gen-og-images.mjs
 *
 * Output: public/og/<slug>.png
 *
 * Why static PNGs and not on-the-fly rendering?
 *   Crawlers (FB, Twitter, Slack, iMessage, WhatsApp) fetch og:image once
 *   and cache aggressively. They also penalise slow responses. A pre-built
 *   PNG sitting in public/og/ is the fastest, cheapest, most cacheable
 *   thing we can serve.
 *
 * Why SVG -> sharp instead of node-canvas?
 *   sharp is already a dev dep (used by gen-icons.mjs). librsvg honours
 *   @font-face declarations with data: URIs, so we can embed our brutalist
 *   Staatliches woff2 directly into the SVG and get pixel-perfect text
 *   without pulling in another rendering toolchain.
 */

import sharp from "sharp";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import wawoff from "wawoff2";
import { OG_ROUTES, PALETTE } from "./og-routes.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dir, "../public");
const outDir = resolve(publicDir, "og");
const fontsDir = resolve(publicDir, "fonts");

/**
 * Make a TrueType copy of one of the bundled woff2 fonts and place it
 * somewhere fontconfig will pick it up. We have to do this because
 * librsvg (the SVG rasteriser sharp uses) cannot read woff2 — it goes
 * through pango/freetype, which only handles legacy font formats. If
 * we skip this step, all the headlines fall back to whatever sans-serif
 * fontconfig hands out and the cards lose their brutalist look.
 *
 * The TTFs land in a per-user .fonts directory because that path is on
 * fontconfig's default search list everywhere we deploy (Linux desktop,
 * Replit container, GitHub Actions runner). We refuse to overwrite an
 * existing TTF so repeated runs stay cheap.
 */
async function ensureTtf(woff2Name, ttfName) {
  const ttfDir = resolve(process.env.HOME || tmpdir(), ".fonts");
  if (!existsSync(ttfDir)) await mkdir(ttfDir, { recursive: true });
  const ttfPath = resolve(ttfDir, ttfName);
  if (existsSync(ttfPath)) {
    const s = await stat(ttfPath);
    if (s.size > 0) return ttfPath;
  }
  const woffBuf = await readFile(resolve(fontsDir, woff2Name));
  const ttfBuf = await wawoff.decompress(woffBuf);
  await writeFile(ttfPath, Buffer.from(ttfBuf));
  console.log(`✓ converted ${woff2Name} -> ~/.fonts/${ttfName}`);
  return ttfPath;
}

await ensureTtf("staatliches-latin.woff2", "staatliches-latin.ttf");
await ensureTtf("jetbrains-mono-latin.woff2", "jetbrains-mono-latin.ttf");

// 1200x630 is the OG/Twitter recommended ratio (1.91:1) and the size every
// major crawler renders without downscaling. Don't change without checking
// FB sharing debugger and Twitter card validator.
const W = 1200;
const H = 630;

if (!existsSync(outDir)) {
  await mkdir(outDir, { recursive: true });
}

// Read the concrete texture so we can composite it under the foreground.
// Loaded once and reused across all six cards.
const concreteBuf = await readFile(resolve(publicDir, "concrete.jpeg"));

// Read the void icon so we can stamp it as the wordmark on the top-left.
const iconBuf = await readFile(resolve(publicDir, "void-icon.png"));

/**
 * Wraps headline text into balanced lines based on a max character width.
 * Greedy left-to-right; good enough for the 6 short headlines we have and
 * doesn't require a full text shaper.
 */
function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * XML-escapes a string for safe interpolation into SVG text nodes. Without
 * this, an apostrophe or ampersand in a headline would corrupt the SVG and
 * sharp would silently render an empty PNG.
 */
function esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds the SVG markup for one card. The visual system mirrors the live
 * site: dark concrete background, gold/teal/burnt accent stripe, Staatliches
 * headline, mono-spaced footer line.
 */
function buildSvg(route) {
  const accent = PALETTE[route.accent] || PALETTE.gold;

  // Headline sizing: 64px base, dropped to 52 if we end up with 4+ lines so
  // the text never overflows the safe zone. Padded 80px left, 110px right
  // (the icon stamp lives in the upper-right and we want a clear gutter).
  // wrap() targets ~24 chars per line, which is roughly what Staatliches at
  // 64px fits inside a 1010-pixel-wide column.
  const headline = route.headline;
  const lines = wrap(headline, 24);
  const fontSize = lines.length >= 4 ? 52 : 64;
  const lineHeight = fontSize * 1.1;
  // Vertically centre the headline block in the area between the wordmark
  // (top ~150px) and the footer (~530px).
  const blockHeight = lines.length * lineHeight;
  const startY = 200 + (330 - blockHeight) / 2 + fontSize;

  const headlineTspans = lines
    .map(
      (line, i) =>
        `<tspan x="80" y="${startY + i * lineHeight}">${esc(line)}</tspan>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!--
    Font families ("Staatliches", "JetBrains Mono") are resolved at render
    time by fontconfig. ensureTtf() above guarantees TTF copies live in
    ~/.fonts/ so pango/freetype can read them — librsvg cannot read woff2.
  -->

  <!-- Solid base so concrete texture composites against the right color -->
  <rect width="${W}" height="${H}" fill="${PALETTE.bg}"/>

  <!-- Top accent stripe -->
  <rect x="0" y="0" width="${W}" height="6" fill="${accent}"/>

  <!-- Bottom accent stripe -->
  <rect x="0" y="${H - 6}" width="${W}" height="6" fill="${accent}"/>

  <!-- Wordmark -->
  <text x="80" y="130"
        font-family="Staatliches, sans-serif"
        font-size="64"
        fill="${PALETTE.gold}"
        letter-spacing="8">VOID</text>

  <!-- Wordmark underbar accent -->
  <rect x="80" y="148" width="120" height="3" fill="${PALETTE.gold}" opacity="0.6"/>

  <!-- Headline -->
  <text font-family="Staatliches, sans-serif"
        font-size="${fontSize}"
        fill="${PALETTE.fg}"
        letter-spacing="2">${headlineTspans}</text>

  <!-- Footer line: mono, dim, with accent block -->
  <rect x="80" y="540" width="14" height="14" fill="${accent}"/>
  <text x="108" y="552"
        font-family="'JetBrains Mono', monospace"
        font-size="18"
        fill="${PALETTE.dim}"
        letter-spacing="3">EPHEMERAL · PEER-TO-PEER · NO LOGS</text>

  <!-- URL stamp bottom-right -->
  <text x="${W - 80}" y="552"
        font-family="'JetBrains Mono', monospace"
        font-size="18"
        fill="${PALETTE.dim}"
        letter-spacing="3"
        text-anchor="end">VOID${route.path === "/" ? "" : route.path.toUpperCase().replace(/-/g, " ")}</text>
</svg>
`;
}

async function renderCard(route) {
  const svg = buildSvg(route);

  // Resize the concrete texture to cover the full card and dim it heavily
  // so it acts as subtle grain rather than dominating the design. The
  // brightness/saturation knock-down matches the live page treatment
  // (`linear-gradient(rgba(20,17,13,0.82), ...)`).
  const concreteLayer = await sharp(concreteBuf)
    .resize(W, H, { fit: "cover" })
    .modulate({ brightness: 0.18, saturation: 0.4 })
    .blur(0.6)
    .png()
    .toBuffer();

  // Stamp the void icon into the upper-right corner as a small accent.
  const iconSize = 96;
  const iconLayer = await sharp(iconBuf)
    .resize(iconSize, iconSize, { fit: "contain" })
    .png()
    .toBuffer();

  const svgLayer = Buffer.from(svg);

  const out = resolve(outDir, `${route.slug}.png`);
  await sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: PALETTE.bg,
    },
  })
    .composite([
      { input: concreteLayer, top: 0, left: 0, blend: "over" },
      { input: svgLayer, top: 0, left: 0 },
      {
        input: iconLayer,
        top: 60,
        left: W - iconSize - 80,
      },
    ])
    .png({ quality: 92, compressionLevel: 9 })
    .toFile(out);

  console.log(`✓ og/${route.slug}.png`);
}

// Routes that pin an explicit `image` (see og-routes.mjs) point at a
// hand-crafted asset (e.g. the editorial hero JPG) instead of the
// templated card. Skip them here — nothing references the templated card
// for those routes, so generating one would be wasted work and a
// confusing artifact in public/og/.
const renderable = OG_ROUTES.filter((route) => !route.image);
const skipped = OG_ROUTES.length - renderable.length;

for (const route of renderable) {
  await renderCard(route);
}

console.log(
  `Done — ${renderable.length} OG card(s) written to public/og/` +
    (skipped > 0
      ? ` (${skipped} skipped because the route uses an explicit image override)`
      : ""),
);
