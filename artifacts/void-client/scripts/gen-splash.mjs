// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * gen-splash.mjs
 * Generates iOS PWA splash screen PNGs for VOID.
 * Run from the artifacts/void-client directory:
 *   node scripts/gen-splash.mjs
 *
 * Each splash: #14110D background + void-icon.png centered.
 */

import sharp from "sharp";
import { existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dir, "../public");
const splashDir = resolve(publicDir, "splash");
const iconPath = resolve(publicDir, "void-icon.png");

if (!existsSync(iconPath)) {
  console.error(`Source not found: ${iconPath}`);
  process.exit(1);
}

mkdirSync(splashDir, { recursive: true });

// [width, height, iconSize, media query]
const screens = [
  [750, 1334, 192,
    "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"],
  [1170, 2532, 192,
    "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"],
  [1179, 2556, 192,
    "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"],
  [1290, 2796, 192,
    "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"],
  [2048, 2732, 256,
    "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"],
];

// Parse #14110D as {r, g, b}
const bg = { r: 0x14, g: 0x11, b: 0x0d };

for (const [w, h, iconSize, media] of screens) {
  const out = resolve(splashDir, `splash-${w}x${h}.png`);

  // Resize the icon
  const iconBuf = await sharp(iconPath)
    .resize(iconSize, iconSize)
    .png()
    .toBuffer();

  // Composite: dark bg + centered icon
  await sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: bg,
    },
  })
    .composite([{
      input: iconBuf,
      gravity: "center",
    }])
    .png()
    .toFile(out);

  console.log(`✓ splash-${w}x${h}.png`);
  console.log(`  media: ${media}`);
}

console.log("\nDone — splash screens written to public/splash/");
