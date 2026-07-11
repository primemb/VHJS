import { describe, expect, it } from "vitest";
import { FFMPEG_PRESETS, isFfmpegPreset } from "./encoding.js";

describe("FFMPEG_PRESETS", () => {
  it("exposes libx264's supported presets", () => {
    expect(FFMPEG_PRESETS).toContain("ultrafast");
    expect(FFMPEG_PRESETS).toContain("medium");
    expect(FFMPEG_PRESETS).toContain("placebo");
  });
});

describe("isFfmpegPreset", () => {
  it("narrows supported presets and rejects unknown values", () => {
    expect(isFfmpegPreset("fast")).toBe(true);
    expect(isFfmpegPreset("turbo")).toBe(false);
  });
});
