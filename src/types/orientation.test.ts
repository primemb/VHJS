import { describe, expect, it } from "vitest";
import { asPixels } from "./brands.js";
import { displayDimensions, isQuarterTurned } from "./orientation.js";

describe("isQuarterTurned", () => {
  it("is true for odd quarter-turns and false otherwise", () => {
    expect(isQuarterTurned(90)).toBe(true);
    expect(isQuarterTurned(270)).toBe(true);
    expect(isQuarterTurned(0)).toBe(false);
    expect(isQuarterTurned(180)).toBe(false);
  });

  it("normalizes negative and over-360 rotations", () => {
    expect(isQuarterTurned(-90)).toBe(true); // Display-Matrix style
    expect(isQuarterTurned(450)).toBe(true); // 450 ≡ 90
    expect(isQuarterTurned(-180)).toBe(false);
  });
});

describe("displayDimensions", () => {
  const stored = { width: asPixels(1920), height: asPixels(1080) };

  it("returns stored dimensions unchanged for 0° / 180°", () => {
    expect(displayDimensions({ ...stored, rotation: 0 })).toEqual(stored);
    expect(displayDimensions({ ...stored, rotation: 180 })).toEqual(stored);
  });

  it("swaps width and height for a 90° / 270° rotation (portrait phone clip)", () => {
    expect(displayDimensions({ ...stored, rotation: 90 })).toEqual({
      width: asPixels(1080),
      height: asPixels(1920),
    });
    expect(displayDimensions({ ...stored, rotation: 270 })).toEqual({
      width: asPixels(1080),
      height: asPixels(1920),
    });
  });
});
