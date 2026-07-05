// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * gen-icons.mjs
 * Generates Apple touch icon PNGs from public/void-icon.png.
 * Run from the artifacts/void-client directory:
 *   node scripts/gen-icons.mjs
 */

import sharp from "sharp";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dir, "../public");
const source = resolve(publicDir, "void-icon.png");

if (!existsSync(source)) {
  console.error(`Source not found: ${source}`);
  process.exit(1);
}

const sizes = [120, 152, 167, 180];

for (const size of sizes) {
  const out = resolve(publicDir, `apple-touch-icon-${size}.png`);
  await sharp(source).resize(size, size).png().toFile(out);
  console.log(`✓ apple-touch-icon-${size}.png`);
}

console.log("Done — Apple touch icons written to public/");
