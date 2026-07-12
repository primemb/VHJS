import { describe, expect, it } from "vitest";
import { InvalidWatermarkOptionsError } from "./errors.js";
import { DEFAULT_WATERMARK_OPTIONS, isBouncingWatermark, normalizeWatermark } from "./watermark.js";

describe("normalizeWatermark", () => {
  it("materializes static defaults", () => {
    expect(normalizeWatermark({ input: "logo.png" })).toEqual({
      input: "logo.png",
      relativeWidth: DEFAULT_WATERMARK_OPTIONS.relativeWidth,
      margin: DEFAULT_WATERMARK_OPTIONS.margin,
      motion: "static",
      position: "bottom-right",
    });
  });

  it("preserves a custom normalized static location", () => {
    expect(normalizeWatermark({ input: "logo.png", position: { x: 0.25, y: 0.75 } })).toMatchObject(
      {
        motion: "static",
        position: { x: 0.25, y: 0.75 },
      },
    );
  });

  it("materializes bounce speed and narrows animated requests", () => {
    const watermark = normalizeWatermark({ input: "logo.png", motion: "bounce" });
    expect(isBouncingWatermark(watermark)).toBe(true);
    if (!isBouncingWatermark(watermark)) throw new Error("expected bouncing watermark");
    expect(watermark.speed).toBe(DEFAULT_WATERMARK_OPTIONS.speed);
  });

  it("materializes a static text watermark without requiring a font file", () => {
    expect(normalizeWatermark({ type: "text", text: "VHJS", color: "#ff0000" })).toMatchObject({
      type: "text",
      text: "VHJS",
      relativeFontSize: DEFAULT_WATERMARK_OPTIONS.relativeFontSize,
      color: "0xff0000",
      motion: "static",
      position: "bottom-right",
    });
  });

  it.each([
    ["empty input", { input: "   " }],
    ["zero relative width", { input: "logo.png", relativeWidth: 0 }],
    ["too-large margin", { input: "logo.png", margin: 1 }],
    [
      "watermark wider than its usable area",
      { input: "logo.png", relativeWidth: 0.95, margin: 0.03 },
    ],
    ["out-of-range custom x", { input: "logo.png", position: { x: 1.1, y: 0 } }],
    ["invalid bounce speed", { input: "logo.png", motion: "bounce" as const, speed: 0 }],
    ["empty text", { type: "text" as const, text: " " }],
    ["unsafe text color", { type: "text" as const, text: "VHJS", color: "red:fontsize=99" }],
  ])("rejects %s", (_, watermark) => {
    expect(() => normalizeWatermark(watermark as never)).toThrow(InvalidWatermarkOptionsError);
  });
});
