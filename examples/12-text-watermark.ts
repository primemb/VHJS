/**
 * Render a simple text watermark while producing HLS.
 *
 * Run: `pnpm example 12-text-watermark`
 */
import { createVhjs, isDryRun } from "@primemb/vhjs";
import { binaryOptions, outputDir, sampleInput } from "./_env.js";

const client = createVhjs(binaryOptions());
const result = await client.transcodeToHls({
  input: sampleInput(),
  outputDir: outputDir("text-watermark"),
  watermark: {
    type: "text",
    text: "© Example Studio",
    color: "white",
    position: "bottom-right",
    relativeFontSize: 0.05,
    margin: 0.03,
    // Optionally set `fontFile` to a .ttf/.otf path for a guaranteed typeface.
  },
});

if (isDryRun(result)) throw new Error("unexpected dry run");
console.log(`Text-watermarked HLS master: ${result.masterPlaylistPath}`);
