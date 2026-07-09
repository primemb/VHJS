/**
 * `SourceMetadata` — the typed view of everything ffprobe tells us about an
 * input file. This is a pure domain type (no I/O); the `core/ffprobe` adapter
 * produces it, and the validation layer consumes it to decide what renditions
 * are legal. Fields that ffprobe may omit are modelled as `| null` rather than
 * optional, so consumers always see the key and make an explicit decision.
 */
import type { Bitrate, FrameRate, Milliseconds, Pixels } from "./brands.js";

/** A single video stream discovered in the source. */
export interface VideoStream {
  /** ffprobe stream index (position in the container). */
  readonly index: number;
  /** Codec name as reported by ffprobe, e.g. `"h264"`, `"hevc"`, `"vp9"`. */
  readonly codec: string;
  readonly width: Pixels;
  readonly height: Pixels;
  /** Per-stream bitrate, or `null` when ffprobe does not report one. */
  readonly bitrate: Bitrate | null;
  /** Frames per second, or `null` when unknown/unparseable. */
  readonly frameRate: FrameRate | null;
}

/** A single audio stream discovered in the source. */
export interface AudioStream {
  readonly index: number;
  readonly codec: string;
  readonly bitrate: Bitrate | null;
  /** Channel count (e.g. 2 for stereo, 6 for 5.1), or `null` if unknown. */
  readonly channels: number | null;
  /** Sample rate in Hz, or `null` if unknown. */
  readonly sampleRate: number | null;
  /** BCP-47 / ISO-639 language tag from stream metadata, or `null`. */
  readonly language: string | null;
}

/** A single subtitle stream discovered in the source. */
export interface SubtitleStream {
  readonly index: number;
  readonly codec: string;
  readonly language: string | null;
}

/** The complete, typed result of probing a source file. */
export interface SourceMetadata {
  /** Container duration, or `null` when ffprobe cannot determine it. */
  readonly durationMs: Milliseconds | null;
  /** Overall container bitrate, or `null` when unknown. */
  readonly formatBitrate: Bitrate | null;
  readonly video: readonly VideoStream[];
  readonly audio: readonly AudioStream[];
  readonly subtitle: readonly SubtitleStream[];
}
