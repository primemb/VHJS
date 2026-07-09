import { describe, expect, it } from "vitest";
import { asBitrate, asFrameRate, asMilliseconds, asPixels } from "./brands.js";

describe("asBitrate", () => {
  it("wraps a positive finite value", () => {
    expect(asBitrate(128_000)).toBe(128_000);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects %p", (value) => {
    expect(() => asBitrate(value)).toThrow(RangeError);
  });
});

describe("asPixels", () => {
  it("wraps a positive integer", () => {
    expect(asPixels(1080)).toBe(1080);
  });

  it.each([0, -720, 1.5, Number.NaN])("rejects %p", (value) => {
    expect(() => asPixels(value)).toThrow(RangeError);
  });
});

describe("asFrameRate", () => {
  it("wraps a positive finite (possibly fractional) value", () => {
    expect(asFrameRate(29.97)).toBeCloseTo(29.97);
  });

  it.each([0, -30, Number.NaN, Number.POSITIVE_INFINITY])("rejects %p", (value) => {
    expect(() => asFrameRate(value)).toThrow(RangeError);
  });
});

describe("asMilliseconds", () => {
  it("wraps a non-negative finite value", () => {
    expect(asMilliseconds(0)).toBe(0);
    expect(asMilliseconds(60_000)).toBe(60_000);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects %p", (value) => {
    expect(() => asMilliseconds(value)).toThrow(RangeError);
  });
});
