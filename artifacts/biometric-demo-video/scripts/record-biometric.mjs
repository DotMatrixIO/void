// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Records the biometric split-screen demo into an MP4 + poster.
 *
 * Run from a workspace that has @playwright/test installed (e.g. artifacts/void-client):
 *   cp scripts/record-biometric.mjs ../void-client/record-biometric.mjs
 *   (cd ../void-client && node record-biometric.mjs)
 *   rm ../void-client/record-biometric.mjs
 *
 * Then copy outputs into the landing site:
 *   cp /tmp/biometric-demo.mp4         ../void-client/public/biometric-demo.mp4
 *   ffmpeg -y -i /tmp/biometric-demo-poster.jpg -q:v 8 /tmp/poster-final.jpg
 *   cp /tmp/poster-final.jpg           ../void-client/public/biometric-demo-poster.jpg
 *
 * The biometric-demo-video workflow must be running (default port 22687).
 * Confirm the port with: grep -r PORT artifacts/biometric-demo-video or the workflow logs.
 */
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const URL = 'http://localhost:22687/biometric-demo-video/';
const OUT_DIR = '/tmp/video-captures';
const POSTER_AT = 12300; // peak-contrast moment: scan remnants + first thesis caption
const TOTAL = 32000; // record a little longer than the 29.5s loop, trim on encode

const browser = await chromium.launch({
  args: ['--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
console.log('Launching browser...');
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 }, // 16:9 — fills the locked landscape stage exactly
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();
console.log('Navigating to video...');
await page.goto(URL, { waitUntil: 'load' });

console.log(`Waiting ${POSTER_AT}ms for peak-contrast poster moment...`);
await page.waitForTimeout(POSTER_AT);
console.log('Capturing poster via Playwright screenshot...');
await page.screenshot({ path: '/tmp/biometric-demo-poster.jpg', quality: 90, type: 'jpeg' });

const remaining = TOTAL - POSTER_AT;
console.log(`Continuing for remaining ${remaining}ms...`);
await page.waitForTimeout(remaining);

console.log('Closing context to save video...');
await ctx.close();
await browser.close();

const webm = readdirSync(OUT_DIR)
  .filter((f) => f.endsWith('.webm'))
  .map((f) => `${OUT_DIR}/${f}`)[0];
console.log('Found recording:', webm);

console.log('Converting to MP4 (CRF 28, H.264, no audio)...');
execSync(
  `ffmpeg -y -i "${webm}" -t 29.5 -an -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -movflags +faststart /tmp/biometric-demo.mp4`,
  { stdio: 'inherit' }
);
console.log('Done. Outputs: /tmp/biometric-demo.mp4 and /tmp/biometric-demo-poster.jpg');
