/**
 * Clock adapter — implements the `Clock` port over the system clock. Injected so
 * use-case timings are deterministic in tests (via `FakeClock`).
 */
import type { Clock } from "../ports/index.js";

/** A `Clock` reading wall-clock time from `Date.now()`. */
export const systemClock: Clock = {
  now(): number {
    return Date.now();
  },
};
