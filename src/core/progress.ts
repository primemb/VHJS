/**
 * ffmpeg progress parser (adapter, decide-from-do).
 *
 * ffmpeg reports progress on stderr as it works: a one-off `Duration:` line at
 * startup, then repeated stats lines (`frame=… fps=… time=… speed=…`). The pure
 * functions here turn that text into typed `ProgressEvent`s; `createProgressParser`
 * is the small stateful glue that remembers the total duration (so it can compute
 * a percentage) and feeds whole lines out of a chunked stderr stream.
 *
 * Everything here is pure string→data — it spawns nothing and is unit-tested
 * against a recorded stderr fixture.
 */
import { asMilliseconds, type Milliseconds } from "../types/brands.js";
import type { ProgressEvent } from "../types/progress.js";

const DURATION_RE = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const TIME_RE = /\btime=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const FPS_RE = /\bfps=\s*([\d.]+)/;
const SPEED_RE = /\bspeed=\s*([\d.]+)\s*x/;

/** Convert `HH`, `MM`, `SS(.ss)` components to milliseconds. */
export function hmsToMs(hours: string, minutes: string, seconds: string): Milliseconds {
  const total = Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
  return asMilliseconds(Math.round(total * 1_000));
}

/** Extract the source duration from an ffmpeg `Duration:` line, or `null`. */
export function extractDuration(line: string): Milliseconds | null {
  const match = DURATION_RE.exec(line);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return null;
  }
  return hmsToMs(match[1], match[2], match[3]);
}

/** Round a fraction to an integer percent, clamped to 0–100. */
function toPercent(timeMs: number, totalMs: number): number {
  return Math.min(100, Math.max(0, Math.round((timeMs / totalMs) * 100)));
}

/**
 * Parse one ffmpeg stats line into a `ProgressEvent`. Returns `null` for any
 * line without a `time=` field (banner lines, blank lines, etc.). `totalMs` is
 * the known source duration used to compute `percent` (or `null` if unknown).
 */
export function parseProgressLine(
  line: string,
  totalMs: Milliseconds | null,
): ProgressEvent | null {
  const time = TIME_RE.exec(line);
  if (time?.[1] === undefined || time[2] === undefined || time[3] === undefined) {
    return null;
  }
  const timeMs = hmsToMs(time[1], time[2], time[3]);
  const fps = FPS_RE.exec(line);
  const speed = SPEED_RE.exec(line);

  return {
    percent: totalMs === null ? null : toPercent(timeMs, totalMs),
    timeMs,
    fps: fps?.[1] !== undefined ? Number(fps[1]) : null,
    speed: speed?.[1] !== undefined ? Number(speed[1]) : null,
    currentRendition: null,
  };
}

/** Feeds chunked ffmpeg stderr text in; emits a typed event per progress line. */
export type ProgressFeed = (chunk: string) => void;

/**
 * Create a stateful parser over a stderr stream. It buffers partial lines across
 * chunks (ffmpeg terminates stats lines with `\r`), latches the first `Duration:`
 * it sees, and invokes `onEvent` for every stats line thereafter.
 */
export function createProgressParser(onEvent: (event: ProgressEvent) => void): ProgressFeed {
  let totalMs: Milliseconds | null = null;
  let buffer = "";

  return (chunk: string): void => {
    buffer += chunk;
    // ffmpeg uses \r for the live stats line and \n for informational lines.
    const parts = buffer.split(/[\r\n]/);
    // Keep the trailing (possibly incomplete) segment for the next chunk.
    buffer = parts.pop() ?? "";

    for (const line of parts) {
      if (totalMs === null) {
        const duration = extractDuration(line);
        if (duration !== null) {
          totalMs = duration;
        }
      }
      const event = parseProgressLine(line, totalMs);
      if (event !== null) {
        onEvent(event);
      }
    }
  };
}
