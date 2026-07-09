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
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createBinaryVerifier } from "../../src/core/binaries.js";
import { createProcessRunner } from "../../src/core/process.js";
import { isDryRun } from "../../src/hls/transcoder.js";
import { createVhjs, type Rendition, type VhjsOptions } from "../../src/index.js";
import { asBitrate, asPixels } from "../../src/types/brands.js";

const here = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(here, "..", "..", "examples", "assets", "1min.mp4");

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

  it("produces a master playlist, variant playlists and segments", async () => {
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

      const firstSegment = join(dirname(rendition.playlistPath), "data000.ts");
      expect(await exists(firstSegment)).toBe(true);
    }

    expect(result.elapsedMs).toBeGreaterThan(0);
  });

  it("upscaling the source is rejected before FFmpeg runs", async () => {
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
