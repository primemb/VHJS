/**
 * End-to-end transcode against a real FFmpeg.
 *
 * Opt-in and self-skipping: it resolves ffmpeg/ffprobe from `VHJS_FFMPEG_PATH` /
 * `VHJS_FFPROBE_PATH` (falling back to PATH) and skips entirely if neither is
 * runnable — so CI without FFmpeg stays green. When the binaries are present it
 * transcodes the bundled `1min.mp4` to a tiny two-rung ladder and asserts the
 * master + variant playlists and segments exist and parse.
 *
 * Run: `pnpm test:e2e`   (optionally with VHJS_FFMPEG_PATH / VHJS_FFPROBE_PATH)
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createBinaryVerifier } from "../../src/core/binaries.js";
import { createProcessRunner } from "../../src/core/process.js";
import { parseMediaPlaylist } from "../../src/hls/playlist.js";
import { isDryRun } from "../../src/hls/transcoder.js";
import { createVhjs, type Rendition, type VhjsOptions } from "../../src/index.js";
import { asBitrate, asPixels } from "../../src/types/brands.js";

const run = createProcessRunner();

/** Probe one output file's first video stream dimensions with real ffprobe. */
async function videoSize(path: string): Promise<{ width: number; height: number }> {
  const { exitCode, stderr, stdout } = await run(ffprobePath, {
    args: [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      path,
    ],
  });
  if (exitCode !== 0) {
    throw new Error(`ffprobe failed for ${path} (exit ${exitCode}): ${stderr.trim()}`);
  }
  // mpegts (.ts) reports the stream twice (once under [PROGRAM]); take line one.
  const firstLine = stdout.trim().split(/\r?\n/)[0] ?? "";
  const [width, height] = firstLine.split(",").map(Number);
  return { width: width ?? 0, height: height ?? 0 };
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

const here = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(here, "..", "..", "examples", "assets", "1min.mp4");
// The sample clip is git-ignored (see examples/assets/.gitignore), so a fresh
// clone with FFmpeg but no clip must skip the clip-dependent cases rather than
// fail. The rotation case synthesizes its own input and needs no sample.
const hasSample = existsSync(INPUT);

const ffmpegPath = process.env.VHJS_FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.VHJS_FFPROBE_PATH ?? "ffprobe";
const options: VhjsOptions = { ffmpegPath, ffprobePath };
const vhjs = createVhjs(options);

// Resolve availability once, before defining the suite.
const verify = createBinaryVerifier(createProcessRunner());
const available = (await verify(ffmpegPath)) && (await verify(ffprobePath));

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const ladder: Rendition[] = [
  {
    height: asPixels(480),
    videoBitrate: asBitrate(1_000_000),
    audioBitrate: asBitrate(96_000),
    videoCodec: "h264",
    audioCodec: "aac",
  },
  {
    height: asPixels(240),
    videoBitrate: asBitrate(400_000),
    audioBitrate: asBitrate(64_000),
    videoCodec: "h264",
    audioCodec: "aac",
  },
];

describe.skipIf(!available)("e2e: transcodeToHls against real FFmpeg", () => {
  let outDir = "";

  afterAll(async () => {
    if (outDir) {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasSample)("produces a master playlist, variant playlists and segments", async () => {
    outDir = await mkdtemp(join(tmpdir(), "vhjs-e2e-"));

    const result = await vhjs.transcodeToHls({
      input: INPUT,
      outputDir: outDir,
      renditions: ladder,
      segmentDuration: 4,
      // Exercise the custom-args escape hatch end-to-end.
      outputArgs: ["-pix_fmt", "yuv420p"],
    });

    if (isDryRun(result)) {
      throw new Error("expected a real run");
    }

    // Master playlist exists and references both variants.
    expect(await exists(result.masterPlaylistPath)).toBe(true);
    const master = await readFile(result.masterPlaylistPath, "utf8");
    expect(master).toContain("#EXTM3U");
    expect(master.match(/#EXT-X-STREAM-INF/g) ?? []).toHaveLength(2);

    expect(result.renditions.map((r) => r.name)).toEqual(["480p", "240p"]);

    // Each variant playlist exists, parses, and has at least one segment on disk.
    for (const rendition of result.renditions) {
      expect(await exists(rendition.playlistPath)).toBe(true);
      const media = await readFile(rendition.playlistPath, "utf8");
      expect(media).toContain("#EXTINF");
      expect(media).toContain(".ts");

      const firstSegment = await firstSegmentPath(rendition.playlistPath);
      expect(await exists(firstSegment)).toBe(true);
    }

    expect(result.elapsedMs).toBeGreaterThan(0);
  });

  it("keeps a rotated (portrait) source upright — output is portrait, not sideways", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-rot-"));
    try {
      // Author a landscape 640x480 clip, then bake a 90° display rotation into a
      // copy (ffmpeg writes a Display Matrix). It *displays* portrait 480x640.
      const base = join(dir, "base.mp4");
      const rotated = join(dir, "rotated.mp4");
      await run(ffmpegPath, {
        args: [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=640x480:duration=1:rate=15",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          base,
          "-loglevel",
          "error",
        ],
      });
      await run(ffmpegPath, {
        args: [
          "-y",
          "-display_rotation:v:0",
          "-90",
          "-i",
          base,
          "-c",
          "copy",
          rotated,
          "-loglevel",
          "error",
        ],
      });

      const outDirRot = join(dir, "hls");
      // Auto-ladder (clamps bitrates to the source, so the synthetic low-bitrate
      // testsrc clip is fine). Display is portrait 480x640 → top rung is 480p.
      const result = await vhjs.transcodeToHls({
        input: rotated,
        outputDir: outDirRot,
        segmentDuration: 4,
        outputArgs: ["-pix_fmt", "yuv420p"],
      });
      if (isDryRun(result)) throw new Error("expected a real run");

      // The ladder must key off the DISPLAY height (640), not the stored 480.
      expect(result.renditions[0]?.name).toBe("480p");

      // Probe the first emitted segment: it must be PORTRAIT (width < height).
      // A double-rotation or a dropped rotation would come out landscape here.
      const segment = await firstSegmentPath(result.renditions[0]?.playlistPath ?? "");
      const { width, height } = await videoSize(segment);
      expect(height).toBe(480);
      expect(width).toBeLessThan(height);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasSample)("upscaling the source is rejected before FFmpeg runs", async () => {
    const upscale: Rendition[] = [
      {
        height: asPixels(4320), // 8K — well above the source
        videoBitrate: asBitrate(400_000),
        audioBitrate: asBitrate(64_000),
        videoCodec: "h264",
        audioCodec: "aac",
      },
    ];
    await expect(
      vhjs.transcodeToHls({
        input: INPUT,
        outputDir: join(tmpdir(), "vhjs-e2e-never"),
        renditions: upscale,
      }),
    ).rejects.toMatchObject({ code: "RESOLUTION_UPSCALE" });
  });
});

// Surface a clear note when the suite self-skips (e.g. no FFmpeg in CI).
describe.skipIf(available)("e2e: skipped (FFmpeg not resolvable)", () => {
  it("documents how to enable e2e", () => {
    expect(available).toBe(false);
  });
});
