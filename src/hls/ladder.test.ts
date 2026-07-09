import { describe, expect, it } from "vitest";
import { makeSourceMetadata } from "../../tests/fixtures/metadata.js";
import { makeRendition } from "../../tests/fixtures/rendition.js";
import { asBitrate, asPixels } from "../types/brands.js";
import { ResolutionUpscaleError } from "../validation/errors.js";
import { autoLadder, normalizeLadder } from "./ladder.js";

describe("autoLadder", () => {
  it("selects standard rungs at or below the source height, highest first", () => {
    const source = makeSourceMetadata(); // 1080p
    const heights = autoLadder(source).map((r) => r.height);
    expect(heights).toEqual([1080, 720, 480, 360, 240]);
  });

  it("never includes a rung above the source height", () => {
    const source = makeSourceMetadata({
      video: [
        {
          index: 0,
          codec: "h264",
          width: asPixels(1280),
          height: asPixels(720),
          bitrate: asBitrate(2_800_000),
          frameRate: null,
        },
      ],
    });
    expect(autoLadder(source).map((r) => r.height)).toEqual([720, 480, 360, 240]);
  });

  it("clamps rung bitrates down to a low-bitrate source", () => {
    const source = makeSourceMetadata({
      video: [
        {
          index: 0,
          codec: "h264",
          width: asPixels(1920),
          height: asPixels(1080),
          bitrate: asBitrate(1_000_000), // well below the 1080p target
          frameRate: null,
        },
      ],
    });
    const top = autoLadder(source)[0];
    expect(top?.videoBitrate).toBe(1_000_000);
  });

  it("falls back to a single rung for a source below the smallest standard rung", () => {
    const source = makeSourceMetadata({
      video: [
        {
          index: 0,
          codec: "h264",
          width: asPixels(256),
          height: asPixels(144),
          bitrate: asBitrate(300_000),
          frameRate: null,
        },
      ],
    });
    const ladder = autoLadder(source);
    expect(ladder).toHaveLength(1);
    expect(ladder[0]?.height).toBe(144);
  });

  it("keeps target bitrates when the source reports none", () => {
    const source = makeSourceMetadata({
      video: [
        {
          index: 0,
          codec: "h264",
          width: asPixels(1280),
          height: asPixels(720),
          bitrate: null,
          frameRate: null,
        },
      ],
      formatBitrate: null,
      audio: [],
    });
    const top = autoLadder(source)[0];
    expect(top?.videoBitrate).toBe(2_800_000); // untouched 720p target
  });
});

describe("normalizeLadder", () => {
  it("sorts survivors highest-first", () => {
    const source = makeSourceMetadata();
    const requested = [
      makeRendition({ height: asPixels(480), videoBitrate: asBitrate(1_400_000) }),
      makeRendition({ height: asPixels(1080) }),
      makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) }),
    ];
    expect(normalizeLadder(requested, source).renditions.map((r) => r.height)).toEqual([
      1080, 720, 480,
    ]);
  });

  it("drops a duplicate height and warns it is redundant", () => {
    const source = makeSourceMetadata();
    const requested = [
      makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) }),
      makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_500_000) }),
    ];
    const { renditions, warnings } = normalizeLadder(requested, source);
    expect(renditions).toHaveLength(1);
    expect(warnings.some((w) => w.code === "REDUNDANT_RENDITION")).toBe(true);
  });

  it("propagates bitrate-clamp warnings from validation", () => {
    const source = makeSourceMetadata(); // video bitrate 5_000_000
    const requested = [
      makeRendition({ height: asPixels(1080), videoBitrate: asBitrate(6_000_000) }),
    ];
    const { renditions, warnings } = normalizeLadder(requested, source);
    expect(renditions[0]?.videoBitrate).toBe(5_000_000);
    expect(warnings.some((w) => w.code === "BITRATE_CLAMPED")).toBe(true);
  });

  it("rejects the whole ladder when any rung upscales", () => {
    const source = makeSourceMetadata();
    const requested = [makeRendition({ height: asPixels(2160) })];
    expect(() => normalizeLadder(requested, source)).toThrow(ResolutionUpscaleError);
  });

  it("returns an empty ladder for empty input", () => {
    const source = makeSourceMetadata();
    expect(normalizeLadder([], source)).toEqual({ renditions: [], warnings: [] });
  });
});
