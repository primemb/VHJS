import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ProbeError } from "../validation/errors.js";
import { buildFfprobeArgs, createFfprobeService, parseProbeOutput } from "./ffprobe.js";
import type { ProcessResult, ProcessRunner } from "./process.js";

function fixture(name: string): unknown {
  const url = new URL(`../../tests/fixtures/ffprobe/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    aborted: false,
    ...overrides,
  };
}

describe("buildFfprobeArgs", () => {
  it("requests JSON stream + format output for the input", () => {
    expect(buildFfprobeArgs("in.mp4")).toEqual([
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "in.mp4",
    ]);
  });
});

describe("parseProbeOutput", () => {
  it("maps a full 1080p h264/aac/subtitle probe", () => {
    const meta = parseProbeOutput(fixture("1080p-h264-aac-subs.json"));

    expect(meta.durationMs).toBe(60_000);
    expect(meta.formatBitrate).toBe(5_200_000);

    expect(meta.video).toHaveLength(1);
    expect(meta.video[0]).toMatchObject({ codec: "h264", width: 1920, height: 1080 });
    expect(meta.video[0]?.bitrate).toBe(5_000_000);
    // 30000/1001 ≈ 29.97
    expect(meta.video[0]?.frameRate).toBeCloseTo(29.97, 2);

    expect(meta.audio[0]).toMatchObject({
      codec: "aac",
      channels: 2,
      sampleRate: 48_000,
      language: "eng",
    });
    expect(meta.subtitle[0]).toMatchObject({ codec: "subrip", language: "eng" });
  });

  it("treats absent optional fields as null and ignores unmodelled stream kinds", () => {
    const meta = parseProbeOutput(fixture("no-bitrate.json"));

    expect(meta.durationMs).toBeNull();
    expect(meta.formatBitrate).toBeNull();
    expect(meta.video[0]?.bitrate).toBeNull();
    expect(meta.video[0]?.frameRate).toBe(25);
    expect(meta.audio[0]).toMatchObject({
      channels: 6,
      bitrate: null,
      sampleRate: null,
      language: null,
    });
    // The `data` stream is neither video, audio, nor subtitle.
    expect(meta.subtitle).toHaveLength(0);
  });

  it.each([
    ["a null payload", null],
    ["a non-object payload", 42],
    ["an object with no streams array", { format: {} }],
  ])("throws ProbeError for %s", (_label, payload) => {
    expect(() => parseProbeOutput(payload)).toThrow(ProbeError);
  });

  it("throws ProbeError when a video stream lacks width/height", () => {
    const bad = { streams: [{ index: 0, codec_type: "video", codec_name: "h264" }] };
    expect(() => parseProbeOutput(bad)).toThrow(/missing width\/height/);
  });

  it("parses an integer frame rate and rejects a zero denominator", () => {
    const meta = parseProbeOutput({
      streams: [
        {
          index: 0,
          codec_type: "video",
          codec_name: "h264",
          width: 640,
          height: 480,
          r_frame_rate: "24/0",
        },
      ],
    });
    expect(meta.video[0]?.frameRate).toBeNull();
  });

  it("reports a null frame rate when r_frame_rate is absent", () => {
    const meta = parseProbeOutput({
      streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 640, height: 480 }],
    });
    expect(meta.video[0]?.frameRate).toBeNull();
  });

  it("defaults a missing codec name to 'unknown' and a missing index to -1", () => {
    const meta = parseProbeOutput({
      streams: [{ codec_type: "audio" }],
    });
    expect(meta.audio[0]).toMatchObject({ codec: "unknown", index: -1 });
  });
});

describe("createFfprobeService", () => {
  const rawJson = JSON.stringify(fixture("1080p-h264-aac-subs.json"));

  it("runs ffprobe with the built argv and parses stdout", async () => {
    const run = vi.fn<ProcessRunner>(async () => processResult({ stdout: rawJson }));
    const service = createFfprobeService({ run, ffprobePath: "ffprobe" });

    const meta = await service.probe("clip.mp4");

    expect(run).toHaveBeenCalledWith("ffprobe", { args: buildFfprobeArgs("clip.mp4") });
    expect(meta.video[0]?.height).toBe(1080);
  });

  it("forwards an AbortSignal to the runner when provided", async () => {
    const run = vi.fn<ProcessRunner>(async () => processResult({ stdout: rawJson }));
    const service = createFfprobeService({ run, ffprobePath: "ffprobe" });
    const controller = new AbortController();

    await service.probe("clip.mp4", controller.signal);

    expect(run).toHaveBeenCalledWith("ffprobe", {
      args: buildFfprobeArgs("clip.mp4"),
      signal: controller.signal,
    });
  });

  it("throws ProbeError when ffprobe exits non-zero", async () => {
    const run: ProcessRunner = async () => processResult({ exitCode: 1, stderr: "bad input" });
    const service = createFfprobeService({ run, ffprobePath: "ffprobe" });
    await expect(service.probe("clip.mp4")).rejects.toThrow(/exited with code 1.*bad input/s);
  });

  it("throws ProbeError when stdout is not valid JSON", async () => {
    const run: ProcessRunner = async () => processResult({ stdout: "not json" });
    const service = createFfprobeService({ run, ffprobePath: "ffprobe" });
    await expect(service.probe("clip.mp4")).rejects.toThrow(/invalid JSON/);
  });

  it("wraps a spawn failure in ProbeError with the cause", async () => {
    const cause = new Error("spawn ENOENT");
    const run: ProcessRunner = async () => {
      throw cause;
    };
    const service = createFfprobeService({ run, ffprobePath: "ffprobe" });
    await expect(service.probe("clip.mp4")).rejects.toMatchObject({
      name: "ProbeError",
      cause,
    });
  });
});
