import { describe, expect, it } from "vitest";
import {
  FakeClock,
  FakeFfmpegRunner,
  FakeFileSystem,
  FakeProbeService,
} from "../../tests/fakes/index.js";
import { makeSourceMetadata } from "../../tests/fixtures/metadata.js";
import { asMilliseconds } from "../types/brands.js";
import { isThumbnailDryRun } from "../types/thumbnail.js";
import {
  InvalidThumbnailTimestampError,
  ThumbnailTimestampExceedsDurationError,
  TranscodeError,
  VideoDurationUnavailableError,
} from "../validation/errors.js";
import {
  buildThumbnailCommand,
  createThumbnailTools,
  DEFAULT_THUMBNAIL_TIMESTAMP_SECONDS,
} from "./thumbnail.js";

function harness(
  metadata = makeSourceMetadata({ durationMs: asMilliseconds(5_000) }),
  ffmpeg = new FakeFfmpegRunner(),
) {
  const fs = new FakeFileSystem();
  fs.files.set("input.mp4", "");
  return {
    fs,
    ffmpeg,
    tools: createThumbnailTools({
      fs,
      ffmpeg,
      probe: new FakeProbeService(metadata),
      clock: new FakeClock(),
    }),
  };
}

describe("buildThumbnailCommand", () => {
  it("uses second 1 by default and extracts exactly one frame", () => {
    const { args } = buildThumbnailCommand({ input: "in.mp4", output: "out/frame.jpg" });
    expect(args.join(" ")).toContain("-ss 1 -i in.mp4 -map 0:v:0 -frames:v 1 -q:v 2 out/frame.jpg");
  });

  it("rejects invalid timestamps", () => {
    expect(() =>
      buildThumbnailCommand({ input: "in", output: "out", timestampSeconds: -1 }),
    ).toThrow(InvalidThumbnailTimestampError);
  });
});

describe("generateThumbnail", () => {
  it("runs at the requested valid timestamp and creates the output parent", async () => {
    const { fs, ffmpeg, tools } = harness();
    const result = await tools.generateThumbnail({
      input: "input.mp4",
      output: "out/frame.jpg",
      timestampSeconds: 3.5,
    });

    expect(result).toMatchObject({
      outputPath: "out/frame.jpg",
      timestampSeconds: 3.5,
      elapsedMs: 0,
    });
    expect(ffmpeg.lastArgs).toContain("3.5");
    expect(fs.dirs.has("out")).toBe(true);
  });

  it("uses the documented default timestamp for dry runs without FFmpeg side effects", async () => {
    const { ffmpeg, tools } = harness();
    const result = await tools.generateThumbnail({
      input: "input.mp4",
      output: "out/frame.jpg",
      dryRun: true,
    });

    expect(isThumbnailDryRun(result)).toBe(true);
    if (isThumbnailDryRun(result)) {
      expect(result.timestampSeconds).toBe(DEFAULT_THUMBNAIL_TIMESTAMP_SECONDS);
    }
    expect(ffmpeg.calls).toHaveLength(0);
  });

  it("rejects a timestamp after the source duration before running FFmpeg", async () => {
    const { ffmpeg, tools } = harness();
    await expect(
      tools.generateThumbnail({
        input: "input.mp4",
        output: "out/frame.jpg",
        timestampSeconds: 5.01,
      }),
    ).rejects.toThrow(ThumbnailTimestampExceedsDurationError);
    expect(ffmpeg.calls).toHaveLength(0);
  });

  it("requires usable duration metadata and a video stream", async () => {
    const unavailable = harness(makeSourceMetadata({ durationMs: null }));
    await expect(
      unavailable.tools.generateThumbnail({ input: "input.mp4", output: "out/frame.jpg" }),
    ).rejects.toThrow(VideoDurationUnavailableError);

    const videoLess = harness(makeSourceMetadata({ video: [] }));
    await expect(
      videoLess.tools.generateThumbnail({ input: "input.mp4", output: "out/frame.jpg" }),
    ).rejects.toMatchObject({ code: "PROBE_FAILED" });
  });

  it("wraps FFmpeg failures in a typed TranscodeError", async () => {
    const { tools } = harness(
      makeSourceMetadata({ durationMs: asMilliseconds(5_000) }),
      new FakeFfmpegRunner({ result: { exitCode: 1, stderrTail: "bad image" } }),
    );
    await expect(
      tools.generateThumbnail({ input: "input.mp4", output: "out/frame.jpg" }),
    ).rejects.toThrow(TranscodeError);
  });
});
