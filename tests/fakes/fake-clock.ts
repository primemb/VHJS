import type { Clock } from "../../src/ports/index.js";

/**
 * A `Clock` whose time only moves when the test tells it to — so job timings
 * are deterministic. `now()` returns the current value; `advance`/`set` control it.
 */
export class FakeClock implements Clock {
  private current: number;

  constructor(startMs = 0) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  /** Move time forward by `ms` and return the new value. */
  advance(ms: number): number {
    this.current += ms;
    return this.current;
  }

  /** Jump to an absolute epoch-millisecond value. */
  set(ms: number): void {
    this.current = ms;
  }
}
