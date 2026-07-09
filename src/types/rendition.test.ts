import { describe, expect, it } from "vitest";
import { makeRendition } from "../../tests/fixtures/rendition.js";
import { asPixels } from "./brands.js";
import { renditionName, SUPPORTED_AUDIO_CODECS, SUPPORTED_VIDEO_CODECS } from "./rendition.js";

describe("renditionName", () => {
  it("derives a `<height>p` name", () => {
    expect(renditionName(makeRendition({ height: asPixels(720) }))).toBe("720p");
    expect(renditionName(makeRendition({ height: asPixels(2160) }))).toBe("2160p");
  });
});

describe("supported codec lists", () => {
  it("advertise the MVP H.264 + AAC defaults", () => {
    expect(SUPPORTED_VIDEO_CODECS).toContain("h264");
    expect(SUPPORTED_AUDIO_CODECS).toContain("aac");
  });
});
