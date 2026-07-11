/**
 * Add a segmented WebVTT subtitle rendition to an existing HLS package.
 * SRT files can be passed as `subtitleInput` as well; VHJS converts them to
 * WebVTT during ingest.
 *
 * Run: `pnpm example 06-add-subtitles`
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createVhjs, isDryRun, isSubtitleDryRun } from "@primemb/vhjs";
import { binaryOptions, outputDir, sampleInput } from "./_env.js";

const vhjs = createVhjs(binaryOptions());
const packageDir = outputDir("add-subtitles");

const base = await vhjs.transcodeToHls({ input: sampleInput(), outputDir: packageDir });
if (isDryRun(base)) throw new Error("unexpected dry run");

// A real application normally receives this as a user-provided .vtt or .srt.
const subtitleInput = join(packageDir, "demo-en.vtt");
await writeFile(
  subtitleInput,
  [
    "WEBVTT",
    "",
    "00:00:00.000 --> 00:00:03.000",
    "Welcome to VHJS.",
    "",
    "00:00:03.000 --> 00:00:06.000",
    "This subtitle is packaged as segmented WebVTT.",
    "",
  ].join("\n"),
  "utf8",
);

const added = await vhjs.addSubtitleTrack({
  packageDir,
  subtitleInput,
  language: "en",
  name: "English",
  isDefault: true,
});
if (isSubtitleDryRun(added)) throw new Error("unexpected dry run");

console.log(`Added subtitles [${added.groupId}] ${added.name} -> ${added.subtitlePlaylistPath}`);
console.log("\nPatched master playlist:\n");
console.log(await readFile(added.masterPlaylistPath, "utf8"));

// Soft removal preserves the generated WebVTT playlist and segments on disk.
await vhjs.removeSubtitleTrack({
  packageDir,
  groupId: added.groupId,
  name: added.name,
  mode: "soft",
});

// Reattach it, then hard-remove both its master entry and generated VTT files.
const readded = await vhjs.addSubtitleTrack({
  packageDir,
  subtitleInput,
  language: "en",
  name: "English",
  isDefault: true,
});
if (isSubtitleDryRun(readded)) throw new Error("unexpected dry run");
const removed = await vhjs.removeSubtitleTrack({
  packageDir,
  groupId: readded.groupId,
  name: readded.name,
  mode: "hard",
});
console.log(`Hard-removed subtitle files at ${removed.removedUri}`);
