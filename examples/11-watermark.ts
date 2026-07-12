/**
 * Apply a static image watermark while producing HLS.
 *
 * Run (PowerShell):
 *   $env:VHJS_WATERMARK_IMAGE = "C:\\media\\logo.png"; pnpm example 11-watermark
 */
import { createVhjs, isDryRun } from "@primemb/vhjs";
import { binaryOptions, outputDir, sampleInput } from "./_env.js";

const watermark = process.env.VHJS_WATERMARK_IMAGE;
if (!watermark) {
  throw new Error("Set VHJS_WATERMARK_IMAGE to a PNG, WebP, or JPEG watermark image.");
}

const client = createVhjs(binaryOptions());
const result = await client.transcodeToHls({
  input: sampleInput(),
  outputDir: outputDir("watermark"),
  watermark: {
    input: watermark,
    position: "bottom-right",
    relativeWidth: 0.15,
    margin: 0.03,
  },
});

if (isDryRun(result)) throw new Error("unexpected dry run");
console.log(`Watermarked HLS master: ${result.masterPlaylistPath}`);
