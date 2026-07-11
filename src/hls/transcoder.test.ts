import { describe, expect, it } from "vitest";
import { FakeClock } from "../../tests/fakes/fake-clock.js";
import { FakeFfmpegRunner } from "../../tests/fakes/fake-ffmpeg-runner.js";
import { FakeFileSystem } from "../../tests/fakes/fake-file-system.js";
import { FakeLogger } from "../../tests/fakes/fake-logger.js";
import { FakeProbeService } from "../../tests/fakes/fake-probe-service.js";
import { makeSourceMetadata } from "../../tests/fixtures/metadata.js";
import { makeRendition } from "../../tests/fixtures/rendition.js";
import type { Clock } from "../ports/index.js";
import { asBitrate, asFrameRate, asMilliseconds, asPixels } from "../types/brands.js";
import type { ProgressEvent } from "../types/progress.js";
import { ProbeError, ResolutionUpscaleError } from "../validation/errors.js";
import { createTranscoder, isDryRun, type TranscoderDeps } from "./transcoder.js";

/** Build a transcoder over fakes, with the input file pre-seeded to exist. */
function setup(
  options: {
    metadata?: ReturnType<typeof makeSourceMetadata>;
    ffmpeg?: FakeFfmpegRunner;
    clock?: Clock;
    input?: string;
  } = {},
) {
  const input = options.input ?? "in.mp4";
  const fs = new FakeFileSystem();
  fs.files.set(input, ""); // make `exists(input)` true
  const probe = new FakeProbeService(options.metadata ?? makeSourceMetadata());
  const ffmpeg = options.ffmpeg ?? new FakeFfmpegRunner();
  const clock = options.clock ?? new FakeClock(0);
  const logger = new FakeLogger();
  const deps: TranscoderDeps = { probe, ffmpeg, fs, clock, logger };
  return { deps, fs, probe, ffmpeg, clock, logger, input };
}

describe("createTranscoder — dry run", () => {
  it("returns the argv, renditions and master path without side effects", async () => {
    const { deps, fs, ffmpeg } = setup();
    const result = await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
      renditions: [makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) })],
      dryRun: true,
    });

    expect(isDryRun(result)).toBe(true);
    if (!isDryRun(result)) throw new Error("expected dry run");
    expect(result.args[0]).toBe("-hide_banner");
    expect(result.masterPlaylistPath).toBe("out/master.m3u8");
    expect(result.renditions).toHaveLength(1);
    // No dirs created, no ffmpeg run.
    expect(fs.dirs.size).toBe(0);
    expect(ffmpeg.calls).toHaveLength(0);
  });
});

describe("createTranscoder — real run", () => {
  it("creates the output tree, runs ffmpeg and returns a TranscodeResult", async () => {
    // A clock that returns 1000 then 1500 on successive reads (start, end).
    const stamps = [1_000, 1_500];
    const clock: Clock = { now: () => stamps.shift() ?? 1_500 };
    const { deps, fs, ffmpeg } = setup({ clock });

    const result = await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
      renditions: [
        makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) }),
        makeRendition({ height: asPixels(480), videoBitrate: asBitrate(1_400_000) }),
      ],
    });

    if (isDryRun(result)) throw new Error("expected a real run");
    expect(result.masterPlaylistPath).toBe("out/master.m3u8");
    expect(result.renditions.map((r) => r.playlistPath)).toEqual([
      "out/stream_720p/stream.m3u8",
      "out/stream_480p/stream.m3u8",
    ]);
    expect(result.elapsedMs).toBe(500);
    // Output dir + one dir per variant.
    expect(fs.dirs.has("out")).toBe(true);
    expect(fs.dirs.has("out/stream_720p")).toBe(true);
    expect(fs.dirs.has("out/stream_480p")).toBe(true);
    // ffmpeg ran once with the built argv.
    expect(ffmpeg.calls).toHaveLength(1);
    expect(ffmpeg.lastArgs).toContain("-f");
  });

  it("auto-derives a ladder from the source when none is requested", async () => {
    const { deps } = setup(); // default source is 1080p
    const result = await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
    });
    if (isDryRun(result)) throw new Error("expected a real run");
    expect(result.renditions.map((r) => r.name)).toEqual(["1080p", "720p", "480p", "360p", "240p"]);
  });

  it("accepts the Phase-4 explicit ladder configuration", async () => {
    const { deps } = setup();
    const rendition = makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) });
    const result = await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
      ladder: { mode: "explicit", renditions: [rendition] },
    });

    if (isDryRun(result)) throw new Error("expected a real run");
    expect(result.renditions.map((output) => output.name)).toEqual(["720p"]);
  });

  it("rejects an explicit configuration with no renditions", async () => {
    const { deps } = setup();

    await expect(
      createTranscoder(deps).transcodeToHls({
        input: "in.mp4",
        outputDir: "out",
        ladder: { mode: "explicit", renditions: [] },
      }),
    ).rejects.toMatchObject({ code: "PROBE_FAILED" });
  });

  it("passes a keyframe interval derived from the source frame rate", async () => {
    const { deps, ffmpeg } = setup(); // 30 fps source
    await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
      segmentDuration: 4,
      renditions: [makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) })],
    });
    // gop = round(30 fps * 4s) = 120
    expect(ffmpeg.lastArgs.join(" ")).toContain("-g 120");
  });

  it("uses a requested FPS for both the frame filter and GOP alignment", async () => {
    const { deps, ffmpeg } = setup();
    await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
      segmentDuration: 4,
      frameRate: asFrameRate(24),
      preset: "slow",
      renditions: [makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) })],
    });
    expect(ffmpeg.lastArgs.join(" ")).toContain("fps=24,scale=-2:720");
    expect(ffmpeg.lastArgs.join(" ")).toContain("-g 96");
    expect(ffmpeg.lastArgs.join(" ")).toContain("-preset slow");
  });

  it("forwards the abort signal and progress callback to the runner", async () => {
    const events: ProgressEvent[] = [];
    const tick: ProgressEvent = {
      percent: 50,
      timeMs: asMilliseconds(30_000),
      fps: 60,
      speed: 2,
      currentRendition: null,
    };
    const ffmpeg = new FakeFfmpegRunner({ progress: [tick] });
    const { deps } = setup({ ffmpeg });
    const controller = new AbortController();

    await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
      renditions: [makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) })],
      signal: controller.signal,
      onProgress: (e) => events.push(e),
    });

    expect(ffmpeg.calls[0]?.signal).toBe(controller.signal);
    expect(events).toEqual([tick]);
  });

  it("omits audio mapping when the source has no audio track", async () => {
    const { deps, ffmpeg } = setup({ metadata: makeSourceMetadata({ audio: [] }) });
    await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
      renditions: [makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) })],
    });
    expect(ffmpeg.lastArgs).not.toContain("0:a:0");
    expect(ffmpeg.lastArgs.join(" ")).not.toContain("-c:a:0");
  });

  it("auto-ladders a rotated portrait source off its DISPLAY height (no transpose)", async () => {
    // Stored 720x1280 portrait tagged with a 90° rotation → displays 1280x720
    // landscape; the ladder must key off the 1280 display width-as-height... i.e.
    // display height 720. Use a tall stored frame rotated so display height > stored.
    const rotated = makeSourceMetadata({
      video: [
        {
          index: 0,
          codec: "h264",
          width: asPixels(1920), // stored landscape
          height: asPixels(1080),
          rotation: 90, // displays portrait 1080x1920 → display height 1920
          bitrate: asBitrate(5_000_000),
          frameRate: asFrameRate(30),
        },
      ],
    });
    const { deps, ffmpeg } = setup({ metadata: rotated });
    const result = await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
    });
    if (isDryRun(result)) throw new Error("expected a real run");
    // Display height 1920 admits the full standard ladder down from 1080p.
    expect(result.renditions.map((r) => r.name)).toEqual(["1080p", "720p", "480p", "360p", "240p"]);
    // ffmpeg's own autorotate handles the pixels; we must not add a transpose.
    expect(ffmpeg.lastArgs.join(" ")).not.toContain("transpose");
  });

  it("threads custom input/output args into the built ffmpeg command", async () => {
    const { deps, ffmpeg } = setup();
    await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
      renditions: [makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) })],
      inputArgs: ["-hwaccel", "cuda"],
      outputArgs: ["-tune", "film"],
    });
    const joined = ffmpeg.lastArgs.join(" ");
    expect(joined).toContain("-hwaccel cuda");
    expect(joined).toContain("-tune film");
  });

  it("rejects (before running ffmpeg) custom args that collide with managed flags", async () => {
    const ffmpeg = new FakeFfmpegRunner();
    const { deps } = setup({ ffmpeg });
    await expect(
      createTranscoder(deps).transcodeToHls({
        input: "in.mp4",
        outputDir: "out",
        renditions: [makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) })],
        outputArgs: ["-preset", "slow"],
      }),
    ).rejects.toMatchObject({ code: "CONFLICTING_FFMPEG_ARG" });
    expect(ffmpeg.calls).toHaveLength(0);
  });

  it("logs each validation warning at warn level", async () => {
    const { deps, logger } = setup(); // source video bitrate 5_000_000
    await createTranscoder(deps).transcodeToHls({
      input: "in.mp4",
      outputDir: "out",
      renditions: [makeRendition({ height: asPixels(1080), videoBitrate: asBitrate(6_000_000) })],
    });
    expect(logger.messages("warn").some((m) => m.includes("clamped"))).toBe(true);
  });
});

describe("createTranscoder — failures", () => {
  it("throws ProbeError when the input does not exist", async () => {
    const { deps, fs } = setup();
    fs.files.delete("in.mp4");
    await expect(
      createTranscoder(deps).transcodeToHls({ input: "in.mp4", outputDir: "out" }),
    ).rejects.toBeInstanceOf(ProbeError);
  });

  it("throws TranscodeError when ffmpeg exits non-zero", async () => {
    const ffmpeg = new FakeFfmpegRunner({ result: { exitCode: 1, stderrTail: "x264 error" } });
    const { deps } = setup({ ffmpeg });
    await expect(
      createTranscoder(deps).transcodeToHls({
        input: "in.mp4",
        outputDir: "out",
        renditions: [makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) })],
      }),
    ).rejects.toMatchObject({ code: "TRANSCODE_FAILED", exitCode: 1 });
  });

  it("does not run ffmpeg when the ladder fails validation (upscale)", async () => {
    const ffmpeg = new FakeFfmpegRunner();
    const { deps } = setup({ ffmpeg });
    await expect(
      createTranscoder(deps).transcodeToHls({
        input: "in.mp4",
        outputDir: "out",
        renditions: [makeRendition({ height: asPixels(2160) })],
      }),
    ).rejects.toBeInstanceOf(ResolutionUpscaleError);
    expect(ffmpeg.calls).toHaveLength(0);
  });
});

describe("isDryRun", () => {
  it("is false for a completed transcode result", () => {
    expect(isDryRun({ masterPlaylistPath: "m", renditions: [], elapsedMs: 0, warnings: [] })).toBe(
      false,
    );
  });
});
