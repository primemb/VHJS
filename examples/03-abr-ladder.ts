/**
 * Full adaptive-bitrate ladder auto-derived from the source, with live progress.
 *
 * Run: `pnpm example 03-abr-ladder`
 */
import { createVhjs, isDryRun } from "@primemb/vhjs";
import { binaryOptions, outputDir, sampleInput } from "./_env.js";

const vhjs = createVhjs(binaryOptions());

// Omitting `renditions` lets VHJS build a sensible ladder from the source
// (every standard rung at or below the source height, clamped to source bitrate).
const result = await vhjs.transcodeToHls({
  input: sampleInput(),
  outputDir: outputDir("abr"),
  onProgress(event) {
    const pct = event.percent === null ? "  ?" : `${event.percent}`.padStart(3);
    process.stdout.write(`\r  ${pct}%  (${event.speed ?? "?"}x)   `);
  },
});

process.stdout.write("\n");
if (isDryRun(result)) {
  throw new Error("unexpected dry run");
}

console.log(`Master playlist: ${result.masterPlaylistPath}`);
for (const rendition of result.renditions) {
  console.log(`  ${rendition.name.padEnd(6)} -> ${rendition.playlistPath}`);
}
for (const warning of result.warnings) {
  console.log(`  ⚠ ${warning.code}: ${warning.message}`);
}
console.log(`Done in ${result.elapsedMs} ms`);
