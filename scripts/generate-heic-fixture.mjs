/**
 * Generates the small HEIC fixture used by lib/story/heic.test.ts.
 *
 * Kept (not throwaway) so the fixture can be regenerated, but it needs
 * macOS's `sips` CLI: nothing in this repo's dependency tree can *encode*
 * HEIC (sharp's prebuilt libvips has no HEVC encoder either, which is the
 * mirror image of the decode problem lib/story/heic.ts exists to solve).
 * The fixture is therefore checked in, and this script is a build-time-only
 * tool, not a runtime or CI dependency.
 *
 * The image content is a synthetic colour ramp — invented pixels, no real
 * contributor photo (CLAUDE.md Engineering Rule 22).
 *
 * Run (macOS only): node scripts/generate-heic-fixture.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "lib", "story", "__fixtures__");
fs.mkdirSync(OUT_DIR, { recursive: true });

const WIDTH = 240;
const HEIGHT = 160;

const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const i = (y * WIDTH + x) * 3;
    pixels[i] = Math.round((x / (WIDTH - 1)) * 255);
    pixels[i + 1] = Math.round((y / (HEIGHT - 1)) * 255);
    pixels[i + 2] = 128;
  }
}

const tmpJpeg = path.join(os.tmpdir(), `heic-fixture-${Date.now()}.jpg`);
await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
  .jpeg({ quality: 92 })
  .toFile(tmpJpeg);

const outPath = path.join(OUT_DIR, "sample.heic");
execFileSync("sips", ["-s", "format", "heic", tmpJpeg, "--out", outPath], {
  stdio: "ignore",
});
fs.rmSync(tmpJpeg, { force: true });

console.log(`Wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);
