import { describe, expect, it } from "vitest";
import { systemClock } from "./clock.js";

describe("systemClock", () => {
  it("returns a millisecond timestamp near Date.now()", () => {
    const before = Date.now();
    const now = systemClock.now();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it("is monotonic across successive reads", () => {
    const a = systemClock.now();
    const b = systemClock.now();
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
