/**
 * End-to-end audio features (Phase 5) against a real FFmpeg.
 *
 * Like `robustness.e2e.test.ts`, these tests **synthesize their own inputs** with
 * `ffmpeg -f lavfi`, so they are reproducible on any machine with FFmpeg and need
 * no committed media. They exercise the three Phase-5 flows end-to-end:
 *
 *  1. `extractAudio` in `aac` mode — the output is a lone AAC stream (no video).
 *  2. `extractAudio` in `copy` mode — the source audio bitstream is preserved.
 *  3. `addAudioTrack` — a base package is transcoded, then a second, language-
 *     tagged audio is segmented into its own HLS rendition and referenced from
 *     the master via `EXT-X-MEDIA:TYPE=AUDIO`.
 *
 * Opt-in and self-skipping: resolves ffmpeg/ffprobe from `VHJS_FFMPEG_PATH` /
 * `VHJS_FFPROBE_PATH` (falling back to PATH) and skips when neither is runnable.
 *
 * Run: `pnpm test:e2e`
 */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBinaryVerifier } from "../../src/core/binaries.js";
import { createProcessRunner } from "../../src/core/process.js";
import { parseMasterPlaylist } from "../../src/hls/playlist.js";
import { isDryRun } from "../../src/hls/transcoder.js";
import { createVhjs, type VhjsOptions } from "../../src/index.js";
import { isAudioDryRun } from "../../src/types/audio.js";

const run = createProcessRunner();
const ffmpegPath = process.env.VHJS_FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.VHJS_FFPROBE_PATH ?? "ffprobe";
const options: VhjsOptions = { ffmpegPath, ffprobePath };
const vhjs = createVhjs(options);

const verify = createBinaryVerifier(createProcessRunner());
const available = (await verify(ffmpegPath)) && (await verify(ffprobePath));

interface ProbedStream {
  readonly type: string;
  readonly codec: string;
}

/** Probe every stream of `path`, de-duplicated by index (mpegts lists twice). */
async function probeStreams(path: string): Promise<ProbedStream[]> {
  const { stdout } = await run(ffprobePath, {
    args: [
      "-v",
      "error",
      "-show_entries",
      "stream=index,codec_type,codec_name",
      "-of",
      "json",
      path,
    ],
  });
  const parsed = JSON.parse(stdout) as {
    streams?: { index?: number; codec_type?: string; codec_name?: string }[];
  };
  const byIndex = new Map<number, ProbedStream>();
  for (const s of parsed.streams ?? []) {
    byIndex.set(s.index ?? -1, { type: s.codec_type ?? "?", codec: s.codec_name ?? "?" });
  }
  return [...byIndex.values()];
}

/** Generate a synthetic input clip; throws if generation fails. */
async function synth(outPath: string, args: readonly string[]): Promise<string> {
  const result = await run(ffmpegPath, { args: ["-y", "-loglevel", "error", ...args, outPath] });
  if (result.exitCode !== 0) {
    throw new Error(`failed to synthesize ${outPath}: ${result.stderr}`);
  }
  return outPath;
}

/** A 1s clip with testsrc video + a 440Hz AAC tone. */
function videoWithAudio(freq = 440): readonly string[] {
  return [
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:duration=1:rate=15",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${freq}:duration=1:sample_rate=48000`,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
  ];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!available)("e2e: audio features", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("extracts audio to a lone AAC file (aac mode)", async () => {
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-extract-aac-"));
    const input = await synth(join(dir, "src.mp4"), videoWithAudio());

    const result = await vhjs.extractAudio({
      input,
      output: join(dir, "out.m4a"),
      mode: "aac",
    });
    if (isAudioDryRun(result)) throw new Error("expected a real run");

    const streams = await probeStreams(result.outputPath);
    expect(streams.some((s) => s.type === "video")).toBe(false);
    expect(streams.find((s) => s.type === "audio")?.codec).toBe("aac");
  });

  it("preserves the source audio bitstream (copy mode)", async () => {
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-extract-copy-"));
    const input = await synth(join(dir, "src.mp4"), videoWithAudio());

    const result = await vhjs.extractAudio({
      input,
      output: join(dir, "out.m4a"),
      mode: "copy",
    });
    if (isAudioDryRun(result)) throw new Error("expected a real run");

    const streams = await probeStreams(result.outputPath);
    expect(streams.some((s) => s.type === "video")).toBe(false);
    expect(streams.find((s) => s.type === "audio")?.codec).toBe("aac");
  });

  it("adds an alternate-audio rendition to an existing HLS package", async () => {
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-add-audio-"));
    const input = await synth(join(dir, "src.mp4"), videoWithAudio(440));
    const extra = await synth(join(dir, "es.m4a"), [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:duration=1:sample_rate=48000",
      "-c:a",
      "aac",
    ]);
    const packageDir = join(dir, "hls");

    const base = await vhjs.transcodeToHls({ input, outputDir: packageDir, segmentDuration: 1 });
    if (isDryRun(base)) throw new Error("expected a real run");

    const added = await vhjs.addAudioTrack({
      packageDir,
      audioInput: extra,
      language: "es",
      name: "Español",
      segmentDuration: 1,
    });
    if (isAudioDryRun(added)) throw new Error("expected a real run");

    // The audio rendition's media playlist + at least one segment exist and parse.
    const audioPlaylist = await readFile(added.audioPlaylistPath, "utf8");
    expect(audioPlaylist).toContain("#EXTINF");
    expect(await exists(join(packageDir, "audio_audio_es", "data000.ts"))).toBe(true);

    // The master advertises the alternate audio and references it from a variant.
    const masterText = await readFile(added.masterPlaylistPath, "utf8");
    expect(masterText).toContain("#EXT-X-MEDIA:TYPE=AUDIO");
    expect(masterText).toContain('LANGUAGE="es"');
    expect(masterText).toContain('URI="audio_audio_es/audio.m3u8"');

    const master = parseMasterPlaylist(masterText);
    expect(master.media).toHaveLength(1);
    expect(master.variants.every((v) => v.attributes.some(([k]) => k === "AUDIO"))).toBe(true);
  });
});
