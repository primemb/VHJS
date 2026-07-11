import { describe, expect, it } from "vitest";
import { makeSourceMetadata } from "../../tests/fixtures/metadata.js";
import { makeRendition } from "../../tests/fixtures/rendition.js";
import { asBitrate, asPixels } from "../types/brands.js";
import type { AudioStream, VideoStream } from "../types/metadata.js";
import {
  BitrateExceedsSourceError,
  InvalidFrameRateError,
  ResolutionUpscaleError,
  UnsupportedCodecError,
  UnsupportedFfmpegPresetError,
} from "./errors.js";
import {
  assertNoUpscale,
  assertSupportedCodecs,
  assertSupportedFfmpegPreset,
  assertValidFrameRate,
  checkAudioDurationMatch,
  clampBitrate,
  DEFAULT_AUDIO_DURATION_TOLERANCE_MS,
  DEFAULT_BITRATE_POLICY,
  primaryVideoStream,
  validateRendition,
} from "./rules.js";

describe("transcode option validation", () => {
  it("accepts valid target frame rates and supported presets", () => {
    expect(() => assertValidFrameRate(23.976)).not.toThrow();
    expect(() => assertSupportedFfmpegPreset("fast")).not.toThrow();
  });

  it("rejects invalid target frame rates and unknown presets", () => {
    expect(() => assertValidFrameRate(0)).toThrow(InvalidFrameRateError);
    expect(() => assertSupportedFfmpegPreset("turbo")).toThrow(UnsupportedFfmpegPresetError);
  });
});

/** A source video stream with an explicit bitrate/height for bitrate tests. */
function video(overrides: Partial<VideoStream> = {}): VideoStream {
  return {
    index: 0,
    codec: "h264",
    width: asPixels(1920),
    height: asPixels(1080),
    rotation: 0,
    bitrate: asBitrate(5_000_000),
    frameRate: null,
    ...overrides,
  };
}

function audio(overrides: Partial<AudioStream> = {}): AudioStream {
  return {
    index: 1,
    codec: "aac",
    bitrate: asBitrate(128_000),
    channels: 2,
    sampleRate: 48_000,
    language: "eng",
    ...overrides,
  };
}

describe("primaryVideoStream", () => {
  it("returns the first video stream", () => {
    const source = makeSourceMetadata();
    expect(primaryVideoStream(source).height).toBe(1080);
  });

  it("throws UnsupportedCodecError when there is no video stream", () => {
    const source = makeSourceMetadata({ video: [] });
    expect(() => primaryVideoStream(source)).toThrow(UnsupportedCodecError);
  });
});

describe("assertNoUpscale", () => {
  it("accepts a height at or below the source", () => {
    const source = makeSourceMetadata();
    expect(() => assertNoUpscale(makeRendition({ height: asPixels(720) }), source)).not.toThrow();
    expect(() => assertNoUpscale(makeRendition({ height: asPixels(1080) }), source)).not.toThrow();
  });

  it("rejects a height above the source", () => {
    const source = makeSourceMetadata();
    expect(() => assertNoUpscale(makeRendition({ height: asPixels(2160) }), source)).toThrow(
      ResolutionUpscaleError,
    );
  });

  it("measures against the DISPLAY height for a rotated (portrait) source", () => {
    // Stored 1920x1080 but rotated 90° → displays 1080 wide x 1920 tall.
    const source = makeSourceMetadata({ video: [video({ rotation: 90 })] });
    // 1440p is an upscale of the stored 1080 height, but valid against the 1920 display height.
    expect(() => assertNoUpscale(makeRendition({ height: asPixels(1440) }), source)).not.toThrow();
    // 2160p is above the 1920 display height → still rejected.
    expect(() => assertNoUpscale(makeRendition({ height: asPixels(2160) }), source)).toThrow(
      ResolutionUpscaleError,
    );
  });
});

describe("assertSupportedCodecs", () => {
  it("accepts the supported H.264 + AAC pair", () => {
    expect(() => assertSupportedCodecs(makeRendition())).not.toThrow();
  });

  it("rejects an unsupported video codec", () => {
    // Cast: the type union forbids this, but a JS caller could still pass it.
    const bad = makeRendition({ videoCodec: "vp9" as "h264" });
    expect(() => assertSupportedCodecs(bad)).toThrow(UnsupportedCodecError);
  });

  it("rejects an unsupported audio codec", () => {
    const bad = makeRendition({ audioCodec: "opus" as "aac" });
    expect(() => assertSupportedCodecs(bad)).toThrow(UnsupportedCodecError);
  });
});

describe("clampBitrate", () => {
  const ref = asBitrate(5_000_000);

  it("passes through a request at or below the reference", () => {
    expect(clampBitrate("video", asBitrate(4_000_000), ref).value).toBe(4_000_000);
    expect(clampBitrate("video", asBitrate(5_000_000), ref).warning).toBeUndefined();
  });

  it("passes through unchanged when the reference is unknown", () => {
    const out = clampBitrate("video", asBitrate(99_000_000), null);
    expect(out.value).toBe(99_000_000);
    expect(out.warning).toBeUndefined();
  });

  it("clamps a mild overshoot down to the reference and warns", () => {
    const out = clampBitrate("video", asBitrate(6_000_000), ref); // 1.2× ≤ 1.5×
    expect(out.value).toBe(5_000_000);
    expect(out.warning?.code).toBe("BITRATE_CLAMPED");
    expect(out.warning?.message).toContain("clamped");
  });

  it("throws for a clear overshoot (above source × hardExceedFactor)", () => {
    expect(() => clampBitrate("video", asBitrate(9_000_000), ref)).toThrow(
      BitrateExceedsSourceError,
    );
  });

  it("honours a custom policy factor", () => {
    const strict = { hardExceedFactor: 1 };
    expect(() => clampBitrate("audio", asBitrate(130_000), asBitrate(128_000), strict)).toThrow(
      BitrateExceedsSourceError,
    );
  });
});

describe("validateRendition", () => {
  it("returns the rendition unchanged and no warnings for a clean request", () => {
    const source = makeSourceMetadata({ video: [video()], audio: [audio()] });
    const result = validateRendition(makeRendition({ height: asPixels(720) }), source);
    expect(result.warnings).toEqual([]);
    expect(result.rendition.height).toBe(720);
  });

  it("clamps both video and audio bitrates and reports both warnings", () => {
    const source = makeSourceMetadata({
      video: [video({ bitrate: asBitrate(3_000_000) })],
      audio: [audio({ bitrate: asBitrate(96_000) })],
    });
    const requested = makeRendition({
      height: asPixels(1080),
      videoBitrate: asBitrate(3_500_000),
      audioBitrate: asBitrate(110_000),
    });
    const result = validateRendition(requested, source);
    expect(result.rendition.videoBitrate).toBe(3_000_000);
    expect(result.rendition.audioBitrate).toBe(96_000);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.every((w) => w.code === "BITRATE_CLAMPED")).toBe(true);
  });

  it("falls back to the format bitrate when the video stream has none", () => {
    const source = makeSourceMetadata({
      video: [video({ bitrate: null })],
      formatBitrate: asBitrate(4_000_000),
    });
    const requested = makeRendition({ videoBitrate: asBitrate(4_500_000) });
    const result = validateRendition(requested, source);
    expect(result.rendition.videoBitrate).toBe(4_000_000); // clamped to format bitrate
  });

  it("throws before clamping when the request upscales", () => {
    const source = makeSourceMetadata();
    expect(() => validateRendition(makeRendition({ height: asPixels(4320) }), source)).toThrow(
      ResolutionUpscaleError,
    );
  });

  it("exposes the default policy factor", () => {
    expect(DEFAULT_BITRATE_POLICY.hardExceedFactor).toBe(1.5);
  });
});

describe("checkAudioDurationMatch", () => {
  it("returns null when the durations agree within tolerance", () => {
    expect(checkAudioDurationMatch(10_000, 10_500)).toBeNull();
  });

  it("returns an AUDIO_DURATION_MISMATCH warning beyond tolerance", () => {
    const warning = checkAudioDurationMatch(10_000, 60_000);
    expect(warning?.code).toBe("AUDIO_DURATION_MISMATCH");
    expect(warning?.message).toContain("differs");
  });

  it("returns null when either duration is unknown", () => {
    expect(checkAudioDurationMatch(null, 10_000)).toBeNull();
    expect(checkAudioDurationMatch(10_000, null)).toBeNull();
  });

  it("honours a custom tolerance", () => {
    expect(checkAudioDurationMatch(10_000, 13_000, 5_000)).toBeNull();
    expect(checkAudioDurationMatch(10_000, 13_000, 1_000)?.code).toBe("AUDIO_DURATION_MISMATCH");
  });

  it("exposes a default tolerance of 2s", () => {
    expect(DEFAULT_AUDIO_DURATION_TOLERANCE_MS).toBe(2_000);
  });
});
