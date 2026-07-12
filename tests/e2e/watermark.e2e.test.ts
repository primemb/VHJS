/** Real-FFmpeg coverage for static and animated image watermarks. */
import { existsSync } from "node:fs";
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
const systemFont = [
  "C:\\Windows\\Fonts\\arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
].find(existsSync);

const ladder: Rendition[] = [
  {
    height: asPixels(240),
    videoBitrate: asBitrate(400_000),
    audioBitrate: asBitrate(64_000),
    videoCodec: "h264",
    audioCodec: "aac",
  },
  {
    height: asPixels(120),
    videoBitrate: asBitrate(200_000),
    audioBitrate: asBitrate(48_000),
    videoCodec: "h264",
    audioCodec: "aac",
  },
];

async function mustRun(args: readonly string[]): Promise<void> {
  const result = await run(ffmpegPath, { args: ["-y", "-loglevel", "error", ...args] });
  if (result.exitCode !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

async function firstSegment(playlistPath: string): Promise<string> {
  const playlist = parseMediaPlaylist(await readFile(playlistPath, "utf8"));
  const segment = playlist.segments[0];
  if (segment === undefined) throw new Error(`expected a segment in ${playlistPath}`);
  return resolve(dirname(playlistPath), segment.uri);
}

interface PpmImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Buffer;
}

/** Decode one frame through FFmpeg into the dependency-free PPM format. */
async function snapshot(segment: string, atSeconds: number, output: string): Promise<PpmImage> {
  await mustRun([
    "-i",
    segment,
    "-ss",
    `${atSeconds}`,
    "-frames:v",
    "1",
    "-pix_fmt",
    "rgb24",
    output,
  ]);
  const file = await readFile(output);
  const headerEnd = file.indexOf(Buffer.from("\n255\n"));
  if (headerEnd < 0) throw new Error("expected a binary PPM header");
  const header = file
    .subarray(0, headerEnd + 5)
    .toString("ascii")
    .trim()
    .split(/\s+/);
  const width = Number(header[1]);
  const height = Number(header[2]);
  return { width, height, pixels: file.subarray(headerEnd + 5) };
}

/** Find the red logo's approximate bounding box despite normal H.264 chroma loss. */
function redBounds(image: PpmImage): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 3;
      const red = image.pixels[offset] ?? 0;
      const green = image.pixels[offset + 1] ?? 0;
      const blue = image.pixels[offset + 2] ?? 0;
      if (red > 130 && red > green * 1.8 && red > blue * 1.8) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) throw new Error("expected a visible red watermark");
  return { minX, minY, maxX, maxY };
}

async function streamTypes(segment: string): Promise<readonly string[]> {
  const result = await run(ffprobePath, {
    args: ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", segment],
  });
  if (result.exitCode !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

describe.skipIf(!available)("e2e: image watermarks", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("places a static transparent logo in every video rendition without dropping audio", async () => {
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-watermark-static-"));
    const source = join(dir, "source.mkv");
    const logo = join(dir, "logo.png");
    await mustRun([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x240:d=2:r=15",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:d=2:sample_rate=48000",
      "-c:v",
      "mpeg4",
      "-c:a",
      "pcm_s16le",
      "-shortest",
      source,
    ]);
    await mustRun([
      "-f",
      "lavfi",
      "-i",
      "color=c=red@0.8:s=20x20:d=0.1,format=rgba",
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgba",
      logo,
    ]);

    const result = await vhjs.transcodeToHls({
      input: source,
      outputDir: join(dir, "hls"),
      renditions: ladder,
      watermark: { input: logo, position: "bottom-right", relativeWidth: 0.1, margin: 0.03 },
    });
    if (isDryRun(result)) throw new Error("expected a real run");

    for (const [index, rendition] of result.renditions.entries()) {
      const segment = await firstSegment(rendition.playlistPath);
      const image = await snapshot(segment, 0, join(dir, `static-${index}.ppm`));
      const bounds = redBounds(image);
      expect(bounds.minX).toBeGreaterThan(image.width * 0.7);
      expect(bounds.minY).toBeGreaterThan(image.height * 0.7);
      expect(await streamTypes(segment)).toEqual(expect.arrayContaining(["video", "audio"]));
    }
  });

  it("moves a bouncing watermark between sampled video frames", async () => {
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-watermark-bounce-"));
    const source = join(dir, "source.mkv");
    const logo = join(dir, "logo.png");
    await mustRun([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x240:d=3:r=15",
      "-c:v",
      "mpeg4",
      source,
    ]);
    await mustRun([
      "-f",
      "lavfi",
      "-i",
      "color=c=red@0.8:s=20x20:d=0.1,format=rgba",
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgba",
      logo,
    ]);
    const result = await vhjs.transcodeToHls({
      input: source,
      outputDir: join(dir, "hls"),
      renditions: [ladder[0] as Rendition],
      // A flat black synthetic source reports a tiny measured bitrate; relax
      // the guard so this visual watermark fixture can still be encoded.
      bitratePolicy: { hardExceedFactor: 100 },
      watermark: { input: logo, motion: "bounce", speed: 0.5, relativeWidth: 0.1, margin: 0 },
    });
    if (isDryRun(result)) throw new Error("expected a real run");

    const segment = await firstSegment(result.renditions[0]?.playlistPath ?? "");
    const early = redBounds(await snapshot(segment, 0.1, join(dir, "early.ppm")));
    const late = redBounds(await snapshot(segment, 1, join(dir, "late.ppm")));
    expect(early.minX).toBeLessThan(100);
    expect(early.minY).toBeLessThan(80);
    expect(late.minX).toBeGreaterThan(200);
    expect(late.minY).toBeGreaterThan(150);
  });

  it.skipIf(systemFont === undefined)("renders a text watermark with drawtext", async () => {
    if (systemFont === undefined) throw new Error("expected a system font");
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-watermark-text-"));
    const source = join(dir, "source.mkv");
    await mustRun([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x240:d=1:r=15",
      "-c:v",
      "mpeg4",
      source,
    ]);
    const result = await vhjs.transcodeToHls({
      input: source,
      outputDir: join(dir, "hls"),
      renditions: [ladder[0] as Rendition],
      bitratePolicy: { hardExceedFactor: 100 },
      watermark: {
        type: "text",
        text: "VHJS",
        color: "red",
        fontFile: systemFont,
        position: "center",
      },
    });
    if (isDryRun(result)) throw new Error("expected a real run");

    const segment = await firstSegment(result.renditions[0]?.playlistPath ?? "");
    expect(await streamTypes(segment)).toContain("video");
  });
});
