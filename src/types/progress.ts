/**
 * `ProgressEvent` — the framework-neutral progress signal emitted while a
 * transcode runs. The type lives here (domain) so both the `FfmpegRunner` port
 * and consumers can depend on it; the parser that turns raw ffmpeg stderr into
 * these events is an adapter concern and lands in Phase 3 (`core/progress`).
 */
import type { Milliseconds } from "./brands.js";

export interface ProgressEvent {
  /** Completion 0–100, or `null` when source duration is unknown. */
  readonly percent: number | null;
  /** Timestamp of the frame ffmpeg has processed so far. */
  readonly timeMs: Milliseconds;
  /** Encoding frame rate, or `null` when not reported. */
  readonly fps: number | null;
  /** Encoding speed multiple (e.g. `2.5` = 2.5× realtime), or `null`. */
  readonly speed: number | null;
  /** Which rendition is currently encoding, or `null` for single-output jobs. */
  readonly currentRendition: string | null;
}
