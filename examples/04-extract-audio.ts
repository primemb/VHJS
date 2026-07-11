/**
 * Extract / demux the audio out of a video into a standalone file ("spread
 * audio"), in both supported modes:
 *   - `copy` — keep the source audio bitstream verbatim (fast, lossless).
 *   - `aac`  — re-encode to AAC (universally playable; stereo downmix default).
 *
 * Run: `pnpm example 04-extract-audio`
 */
import { join } from "node:path";
import { createVhjs, isAudioDryRun } from "@primemb/vhjs";
import { audioSampleInput, binaryOptions, outputDir } from "./_env.js";

const vhjs = createVhjs(binaryOptions());
const input = audioSampleInput();
const out = outputDir("extract-audio");

const copied = await vhjs.extractAudio({
  input,
  output: join(out, "audio-copy.mka"),
  mode: "copy",
});
if (isAudioDryRun(copied)) throw new Error("unexpected dry run");
console.log(`copy -> ${copied.outputPath} (${copied.elapsedMs} ms)`);

const reencoded = await vhjs.extractAudio({
  input,
  output: join(out, "audio-aac.m4a"),
  mode: "aac",
});
if (isAudioDryRun(reencoded)) throw new Error("unexpected dry run");
console.log(`aac  -> ${reencoded.outputPath} (${reencoded.elapsedMs} ms)`);
