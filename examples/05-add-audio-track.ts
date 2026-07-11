/**
 * Add an alternate-audio track to an existing HLS package.
 *
 * First transcode a base package, then attach a second-language audio rendition
 * (`EXT-X-MEDIA:TYPE=AUDIO`) referencing it from every variant. Re-run
 * `addAudioTrack` with the same `groupId` to build a multi-language group.
 *
 * Run: `pnpm example 05-add-audio-track`
 */
import { readFile } from "node:fs/promises";
import { createVhjs, isAudioDryRun, isDryRun } from "@primemb/vhjs";
import { audioSampleInput, binaryOptions, outputDir } from "./_env.js";

const vhjs = createVhjs(binaryOptions());
const input = audioSampleInput();
const packageDir = outputDir("add-audio");

// 1. Build a base HLS package from the sample.
const base = await vhjs.transcodeToHls({ input, outputDir: packageDir });
if (isDryRun(base)) throw new Error("unexpected dry run");
console.log(`Base package: ${base.masterPlaylistPath}`);

// 2. Add an alternate-audio rendition (here we reuse the sample's audio as a
//    stand-in "Español" track — in practice this is a separate language file).
const added = await vhjs.addAudioTrack({
  packageDir,
  audioInput: input,
  language: "es",
  name: "Español",
  isDefault: false,
});
if (isAudioDryRun(added)) throw new Error("unexpected dry run");

console.log(`Added audio [${added.groupId}] ${added.name} -> ${added.audioPlaylistPath}`);
for (const warning of added.warnings) {
  console.log(`  ⚠ ${warning.code}: ${warning.message}`);
}

console.log("\nPatched master playlist:\n");
console.log(await readFile(added.masterPlaylistPath, "utf8"));

// Soft removal only unlinks the rendition from the master. The generated audio
// playlist and segments stay available on disk if you need to attach them again.
await vhjs.removeAudioTrack({
  packageDir,
  groupId: added.groupId,
  name: added.name,
  mode: "soft",
});

// Add it again, then use hard removal to delete its generated playlist/segments too.
const readded = await vhjs.addAudioTrack({
  packageDir,
  audioInput: input,
  language: "es",
  name: "EspaÃ±ol",
});
if (isAudioDryRun(readded)) throw new Error("unexpected dry run");
const removed = await vhjs.removeAudioTrack({
  packageDir,
  groupId: readded.groupId,
  name: readded.name,
  mode: "hard",
});
console.log(`Hard-removed audio files at ${removed.removedUri}`);
