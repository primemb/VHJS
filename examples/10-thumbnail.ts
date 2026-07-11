/**
 * Generate one JPEG thumbnail. The default timestamp is second 1; pass a
 * timestamp explicitly when a caller chooses a different frame.
 *
 * Run: `pnpm example 10-thumbnail`
 */
import { createVhjs, isThumbnailDryRun } from "vhjs";
import { binaryOptions, outputDir, sampleInput } from "./_env.js";

const vhjs = createVhjs(binaryOptions());
const result = await vhjs.generateThumbnail({
  input: sampleInput(),
  output: `${outputDir("thumbnail")}/poster.jpg`,
  timestampSeconds: 3,
});

if (isThumbnailDryRun(result)) throw new Error("unexpected dry run");
console.log(`Thumbnail: ${result.outputPath} at ${result.timestampSeconds}s`);
