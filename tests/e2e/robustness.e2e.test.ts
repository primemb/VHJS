/**
 * End-to-end real-world input robustness against a real FFmpeg (Phase 4.5).
 *
 * Unlike `transcode.e2e.test.ts`, these tests **synthesize their own inputs**
 * with `ffmpeg -f lavfi`, so they are fully reproducible on any machine with
 * FFmpeg and never depend on a (git-ignored) sample clip. Each one exercises a
 * category of messy real-world input that CLAUDE.md's "Real-world input
 * handling" mandate requires VHJS to survive — the same categories the local
 * `examples/assets` clips (VP9/Opus `mobile.mkv`, audio-less `1min.mp4`) show:
 *
 *  1. A **non-H.264 source in a non-mp4 container** (mpeg4 video + PCM audio in
 *     Matroska) — VHJS always re-encodes to H.264/AAC, so it must not gate on
 *     the input container or codec. (VP9/Opus MKV verified manually against
 *     `examples/assets/mobile.mkv`; mpeg4+PCM is used here so the test needs no
 *     external encoder libs and runs on a minimal FFmpeg build.)
 *  2. An **audio-less (video-only) source** — the audio maps / codec args must
 *     be omitted so ffmpeg doesn't fail binding a non-existent `0:a:0`.
 *  3. A **multichannel (5.1) source** — downmixed to stereo (`-ac 2`).
 *
 * Opt-in and self-skipping: resolves ffmpeg/ffprobe from `VHJS_FFMPEG_PATH` /
 * `VHJS_FFPROBE_PATH` (falling back to PATH) and skips when neither is runnable.
 *
 * Run: `pnpm test:e2e`   (optionally with VHJS_FFMPEG_PATH / VHJS_FFPROBE_PATH)
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBinaryVerifier } from "../../src/core/binaries.js";
import { createProcessRunner } from "../../src/core/process.js";
import { parseMediaPlaylist } from "../../src/hls/playlist.js";
import { isDryRun } from "../../src/hls/transcoder.js";
import { createVhjs, type Rendition, type VhjsOptions } from "../../src/index.js";
import { asBitrate, asPixels } from "../../src/types/brands.js";

const run = createProcessRunner();

const ffmpegPath = process.env.VHJS_FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.VHJS_FFPROBE_PATH ?? "ffprobe";
const options: VhjsOptions = { ffmpegPath, ffprobePath };
const vhjs = createVhjs(options);

const verify = createBinaryVerifier(createProcessRunner());
const available = (await verify(ffmpegPath)) && (await verify(ffprobePath));

/** One decoded stream's identity, as reported by ffprobe. */
interface ProbedStream {
  readonly type: string;
  readonly codec: string;
  readonly channels: number | null;
}

/**
 * Probe every stream of `path`. mpegts (.ts) lists each stream twice (once under
 * `[PROGRAM]`), so we de-duplicate by `index` to get the real stream set.
 */
async function probeStreams(path: string): Promise<ProbedStream[]> {
  const { exitCode, stderr, stdout } = await run(ffprobePath, {
    args: [
      "-v",
      "error",
      "-show_entries",
      "stream=index,codec_type,codec_name,channels",
      "-of",
      "json",
      path,
    ],
  });
  if (exitCode !== 0) {
    throw new Error(`ffprobe failed for ${path} (exit ${exitCode}): ${stderr.trim()}`);
  }
  const parsed = JSON.parse(stdout) as {
    streams?: { index?: number; codec_type?: string; codec_name?: string; channels?: number }[];
  };
  const byIndex = new Map<number, ProbedStream>();
  for (const s of parsed.streams ?? []) {
    byIndex.set(s.index ?? -1, {
      type: s.codec_type ?? "?",
      codec: s.codec_name ?? "?",
      channels: typeof s.channels === "number" ? s.channels : null,
    });
  }
  return [...byIndex.values()];
}

/** Resolve the first segment named by an emitted media playlist. */
async function firstSegmentPath(playlistPath: string): Promise<string> {
  const playlist = parseMediaPlaylist(await readFile(playlistPath, "utf8"));
  const segment = playlist.segments[0];
  if (segment === undefined) {
    throw new Error(`expected ${playlistPath} to contain at least one segment`);
  }
  return resolve(dirname(playlistPath), segment.uri);
}

/** Generate a synthetic input clip with ffmpeg; throws if generation fails. */
async function synth(outPath: string, args: readonly string[]): Promise<string> {
  const result = await run(ffmpegPath, {
    args: ["-y", "-loglevel", "error", ...args, outPath],
  });
  if (result.exitCode !== 0) {
    throw new Error(`failed to synthesize ${outPath}: ${result.stderr}`);
  }
  return outPath;
}

const oneRung: Rendition[] = [
  {
    height: asPixels(240),
    videoBitrate: asBitrate(400_000),
    audioBitrate: asBitrate(64_000),
    videoCodec: "h264",
    audioCodec: "aac",
  },
];

describe.skipIf(!available)("e2e: real-world input robustness", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("re-encodes a non-H.264 source in a non-mp4 container to H.264/AAC", async () => {
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-exotic-"));
    // mpeg4 video + PCM audio, muxed into Matroska — nothing about the input is
    // H.264/AAC/mp4, yet VHJS must produce a standard H.264/AAC HLS package.
    const input = await synth(join(dir, "src.mkv"), [
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:duration=1:rate=15",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1:sample_rate=48000",
      "-c:v",
      "mpeg4",
      "-c:a",
      "pcm_s16le",
      "-shortest",
    ]);

    const result = await vhjs.transcodeToHls({
      input,
      outputDir: join(dir, "hls"),
      renditions: oneRung,
      segmentDuration: 4,
    });
    if (isDryRun(result)) throw new Error("expected a real run");

    const segment = await firstSegmentPath(result.renditions[0]?.playlistPath ?? "");
    const streams = await probeStreams(segment);
    expect(streams.find((s) => s.type === "video")?.codec).toBe("h264");
    expect(streams.find((s) => s.type === "audio")?.codec).toBe("aac");
  });

  it("handles an audio-less (video-only) source without mapping audio", async () => {
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-videoonly-"));
    const input = await synth(join(dir, "src.mkv"), [
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:duration=1:rate=15",
      "-c:v",
      "mpeg4",
    ]);

    // Auto-ladder (no explicit renditions) also exercises the audio-less path
    // through ladder derivation.
    const result = await vhjs.transcodeToHls({
      input,
      outputDir: join(dir, "hls"),
      segmentDuration: 4,
    });
    if (isDryRun(result)) throw new Error("expected a real run");

    // The master must advertise a video-only variant (no audio in CODECS).
    const master = await readFile(result.masterPlaylistPath, "utf8");
    expect(master).toContain("#EXT-X-STREAM-INF");

    const segment = await firstSegmentPath(result.renditions[0]?.playlistPath ?? "");
    const streams = await probeStreams(segment);
    expect(streams.some((s) => s.type === "video")).toBe(true);
    expect(streams.some((s) => s.type === "audio")).toBe(false);
  });

  it("downmixes a multichannel (5.1) source to stereo", async () => {
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-51-"));
    const input = await synth(join(dir, "src.mkv"), [
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:duration=1:rate=15",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1:sample_rate=48000",
      "-ac",
      "6",
      "-c:v",
      "mpeg4",
      "-c:a",
      "ac3",
      "-shortest",
    ]);

    const result = await vhjs.transcodeToHls({
      input,
      outputDir: join(dir, "hls"),
      renditions: oneRung,
      segmentDuration: 4,
    });
    if (isDryRun(result)) throw new Error("expected a real run");

    const segment = await firstSegmentPath(result.renditions[0]?.playlistPath ?? "");
    const streams = await probeStreams(segment);
    expect(streams.find((s) => s.type === "audio")?.channels).toBe(2);
  });
});
