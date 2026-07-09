/**
 * Transcode a single 720p HLS rendition.
 *
 * Run: `pnpm example 02-basic-hls`
 */
import { asBitrate, asPixels, createVhjs, isDryRun, type Rendition } from "vhjs";
import { binaryOptions, outputDir, sampleInput } from "./_env.js";

const rendition: Rendition = {
  height: asPixels(720),
  videoBitrate: asBitrate(2_800_000),
  audioBitrate: asBitrate(128_000),
  videoCodec: "h264",
  audioCodec: "aac",
};

const vhjs = createVhjs(binaryOptions());
const result = await vhjs.transcodeToHls({
  input: sampleInput(),
  outputDir: outputDir("basic"),
  renditions: [rendition],
});

if (isDryRun(result)) {
  throw new Error("unexpected dry run");
}
console.log(`Master playlist: ${result.masterPlaylistPath}`);
console.log(`Done in ${result.elapsedMs} ms`);
