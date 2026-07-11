/**
 * Dry run — print the exact ffmpeg argv VHJS would execute, without running it.
 * (Still probes the source, so the ladder can be validated/derived.)
 *
 * Run: `pnpm example 08-dry-run`
 */
import { createVhjs, isDryRun } from "@primemb/vhjs";
import { binaryOptions, outputDir, sampleInput } from "./_env.js";

const vhjs = createVhjs(binaryOptions());
const result = await vhjs.transcodeToHls({
  input: sampleInput(),
  outputDir: outputDir("dry-run"),
  dryRun: true,
  // Custom, additive ffmpeg options — VHJS injects these verbatim. Passing a
  // flag VHJS already manages (e.g. -preset, -c:v) throws ConflictingFfmpegArgError.
  outputArgs: ["-tune", "film", "-pix_fmt", "yuv420p"],
});

if (!isDryRun(result)) {
  throw new Error("expected a dry run");
}

console.log(`Ladder: ${result.renditions.map((r) => `${r.height}p`).join(", ")}`);
console.log(`Master: ${result.masterPlaylistPath}`);
console.log("\nffmpeg \\");
console.log(
  result.args
    .map((arg) => (arg.startsWith("-") ? `  ${arg}` : `    ${JSON.stringify(arg)}`))
    .join(" \\\n"),
);
