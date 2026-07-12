import { describe, expect, it } from "vitest";
import {
  AlternateTrackNotFoundError,
  BitrateExceedsSourceError,
  ConflictingFfmpegArgError,
  FfmpegNotFoundError,
  FfprobeNotFoundError,
  InvalidFrameRateError,
  InvalidThumbnailTimestampError,
  InvalidWatermarkOptionsError,
  NoSubtitleTrackError,
  PlaylistParseError,
  ProbeError,
  ResolutionUpscaleError,
  ThumbnailTimestampExceedsDurationError,
  TranscodeError,
  UnsafePlaylistUriError,
  UnsupportedCodecError,
  UnsupportedFfmpegPresetError,
  VhjsError,
  VideoDurationUnavailableError,
  WatermarkFileNotFoundError,
  WatermarkFontFileNotFoundError,
} from "./errors.js";

describe("FfmpegNotFoundError", () => {
  const err = new FfmpegNotFoundError("/opt/ffmpeg");

  it("is a VhjsError and an Error", () => {
    expect(err).toBeInstanceOf(VhjsError);
    expect(err).toBeInstanceOf(Error);
  });

  it("carries the discriminant code and searched path", () => {
    expect(err.code).toBe("FFMPEG_NOT_FOUND");
    expect(err.searchedPath).toBe("/opt/ffmpeg");
  });

  it("names itself after the concrete subclass and mentions the path", () => {
    expect(err.name).toBe("FfmpegNotFoundError");
    expect(err.message).toContain("/opt/ffmpeg");
  });
});

describe("FfprobeNotFoundError", () => {
  it("carries its own code and path", () => {
    const err = new FfprobeNotFoundError("ffprobe");
    expect(err.code).toBe("FFPROBE_NOT_FOUND");
    expect(err.searchedPath).toBe("ffprobe");
    expect(err.name).toBe("FfprobeNotFoundError");
  });
});

describe("ProbeError", () => {
  it("carries the PROBE_FAILED code and preserves the cause", () => {
    const cause = new Error("boom");
    const err = new ProbeError("bad json", { cause });
    expect(err.code).toBe("PROBE_FAILED");
    expect(err.message).toBe("bad json");
    expect(err.cause).toBe(cause);
  });

  it("supports discriminating by code", () => {
    const err: VhjsError = new ProbeError("x");
    const label = err.code === "PROBE_FAILED" ? "probe" : "other";
    expect(label).toBe("probe");
  });
});

describe("ResolutionUpscaleError", () => {
  const err = new ResolutionUpscaleError(2160, 1080);

  it("carries its code and the requested/source heights", () => {
    expect(err.code).toBe("RESOLUTION_UPSCALE");
    expect(err.requestedHeight).toBe(2160);
    expect(err.sourceHeight).toBe(1080);
    expect(err.name).toBe("ResolutionUpscaleError");
  });

  it("mentions both heights in the message", () => {
    expect(err.message).toContain("2160");
    expect(err.message).toContain("1080");
  });
});

describe("BitrateExceedsSourceError", () => {
  const err = new BitrateExceedsSourceError("video", 9_000_000, 5_000_000);

  it("carries kind, requested and source bitrates", () => {
    expect(err.code).toBe("BITRATE_EXCEEDS_SOURCE");
    expect(err.kind).toBe("video");
    expect(err.requested).toBe(9_000_000);
    expect(err.source).toBe(5_000_000);
    expect(err.message).toContain("video");
  });
});

describe("UnsupportedCodecError", () => {
  const err = new UnsupportedCodecError("audio", "opus", ["aac"]);

  it("carries kind, codec and the supported list", () => {
    expect(err.code).toBe("UNSUPPORTED_CODEC");
    expect(err.kind).toBe("audio");
    expect(err.codec).toBe("opus");
    expect(err.supported).toEqual(["aac"]);
    expect(err.message).toContain("opus");
    expect(err.message).toContain("aac");
  });
});

describe("TranscodeError", () => {
  it("wraps the exit code and stderr tail", () => {
    const err = new TranscodeError(1, "x264 failed");
    expect(err.code).toBe("TRANSCODE_FAILED");
    expect(err.exitCode).toBe(1);
    expect(err.stderrTail).toBe("x264 failed");
    expect(err.message).toContain("1");
    expect(err.message).toContain("x264 failed");
  });

  it("renders a null exit code (killed by signal)", () => {
    const err = new TranscodeError(null, "");
    expect(err.exitCode).toBeNull();
    expect(err.message).toContain("null");
  });
});

describe("PlaylistParseError", () => {
  it("carries the PLAYLIST_PARSE code and preserves the cause", () => {
    const cause = new Error("bad tag");
    const err = new PlaylistParseError("malformed master", { cause });
    expect(err.code).toBe("PLAYLIST_PARSE");
    expect(err.message).toBe("malformed master");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("PlaylistParseError");
  });
});

describe("NoSubtitleTrackError", () => {
  it("carries a typed code and input when no subtitles exist", () => {
    const err = new NoSubtitleTrackError("captions.bin");
    expect(err.code).toBe("NO_SUBTITLE_TRACK");
    expect(err.input).toBe("captions.bin");
    expect(err.message).toContain("No subtitle stream");
  });

  it("reports an invalid requested track index", () => {
    const err = new NoSubtitleTrackError("captions.mkv", 3);
    expect(err.trackIndex).toBe(3);
    expect(err.message).toContain("index 3");
  });
});

describe("ConflictingFfmpegArgError", () => {
  const err = new ConflictingFfmpegArgError(["-preset", "-c:v"]);

  it("carries the code and the offending flags", () => {
    expect(err.code).toBe("CONFLICTING_FFMPEG_ARG");
    expect(err.conflicts).toEqual(["-preset", "-c:v"]);
    expect(err.name).toBe("ConflictingFfmpegArgError");
  });

  it("names the conflicting flags in the message", () => {
    expect(err.message).toContain("-preset");
    expect(err.message).toContain("-c:v");
  });
});

describe("new feature errors", () => {
  it("carries precise codes and context for encoding controls", () => {
    expect(new InvalidFrameRateError(0)).toMatchObject({
      code: "INVALID_FRAME_RATE",
      frameRate: 0,
    });
    expect(new UnsupportedFfmpegPresetError("turbo", ["fast"])).toMatchObject({
      code: "UNSUPPORTED_FFMPEG_PRESET",
      preset: "turbo",
    });
  });

  it("carries precise codes and context for thumbnail validation", () => {
    expect(new InvalidThumbnailTimestampError(-1).code).toBe("INVALID_THUMBNAIL_TIMESTAMP");
    expect(new ThumbnailTimestampExceedsDurationError(2_000, 1_000)).toMatchObject({
      code: "THUMBNAIL_TIMESTAMP_EXCEEDS_DURATION",
      timestampMs: 2_000,
      durationMs: 1_000,
    });
    expect(new VideoDurationUnavailableError("in.mp4").code).toBe("VIDEO_DURATION_UNAVAILABLE");
  });

  it("carries precise codes and context for alternate-track removal", () => {
    expect(new AlternateTrackNotFoundError("AUDIO", "audio", "English")).toMatchObject({
      code: "ALTERNATE_TRACK_NOT_FOUND",
      groupId: "audio",
      trackName: "English",
    });
    expect(new UnsafePlaylistUriError("../audio.m3u8").code).toBe("UNSAFE_PLAYLIST_URI");
  });

  it("carries precise codes and context for watermark validation", () => {
    expect(new InvalidWatermarkOptionsError("margin is invalid")).toMatchObject({
      code: "INVALID_WATERMARK_OPTIONS",
      reason: "margin is invalid",
    });
    expect(new WatermarkFileNotFoundError("logo.png")).toMatchObject({
      code: "WATERMARK_FILE_NOT_FOUND",
      input: "logo.png",
    });
    expect(new WatermarkFontFileNotFoundError("font.ttf")).toMatchObject({
      code: "WATERMARK_FONT_FILE_NOT_FOUND",
      input: "font.ttf",
    });
  });
});
