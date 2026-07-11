/**
 * Probe a file and print its typed `SourceMetadata`.
 *
 * Run: `pnpm example 01-probe`
 */
import { createVhjs } from "@primemb/vhjs";
import { binaryOptions, sampleInput } from "./_env.js";

// Configure once; reuse the instance for every probe/transcode call.
const vhjs = createVhjs(binaryOptions());

const meta = await vhjs.probe(sampleInput());

const [video] = meta.video;
const [audio] = meta.audio;

console.log("Source metadata:");
console.log(`  duration    : ${meta.durationMs} ms`);
console.log(`  container   : ${meta.formatBitrate} bps`);
if (video) {
  console.log(`  video       : ${video.codec} ${video.width}x${video.height}`);
  console.log(`                ${video.bitrate ?? "?"} bps @ ${video.frameRate ?? "?"} fps`);
}
if (audio) {
  console.log(
    `  audio       : ${audio.codec} ${audio.channels ?? "?"}ch ${audio.bitrate ?? "?"} bps`,
  );
}
console.log(`  subtitles   : ${meta.subtitle.length}`);
