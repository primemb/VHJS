/**
 * Public request/result types for the Phase-5 audio features: extracting/demuxing
 * audio out of a video, and adding an alternate-audio rendition to an existing
 * HLS package.
 *
 * These are pure input/output shapes (innermost layer) — no I/O, no `core/`. The
 * use cases live in `hls/audio`; the composition root wires real adapters behind
 * them. Optional fields carry their defaults in the doc comment; the use case
 * applies them (never assume a field is present).
 */
import type { Bitrate } from "./brands.js";
import type { ProgressEvent } from "./progress.js";
import type { ValidationWarning } from "./warnings.js";

/** How the extracted audio is written: verbatim bitstream copy, or re-encode. */
export type AudioExtractMode = "copy" | "aac";

/** Request to extract/demux one audio track from a video into a standalone file. */
export interface ExtractAudioRequest {
  /** Path to the source media (any container/codec with an audio track). */
  readonly input: string;
  /** Destination file path. Its extension chooses the container. */
  readonly output: string;
  /**
   * `"copy"` keeps the source bitstream verbatim (fast, lossless — the container
   * at `output` must accept the source codec); `"aac"` re-encodes to AAC. There
   * is intentionally **no default** — pick per call.
   */
  readonly mode: AudioExtractMode;
  /** Which audio stream to extract (0-based; default `0`). */
  readonly trackIndex?: number;
  /** Target bitrate for `"aac"` mode (bits/sec; default `128000`). Ignored for `"copy"`. */
  readonly audioBitrate?: Bitrate;
  /** Output channel count for `"aac"` mode (default `2` — downmix to stereo). Ignored for `"copy"`. */
  readonly channels?: number;
  /** Extra ffmpeg args before `-i` (additive; conflicts with managed flags throw). */
  readonly inputArgs?: readonly string[];
  /** Extra ffmpeg args before the output file (additive; conflicts with managed flags throw). */
  readonly outputArgs?: readonly string[];
  /** Return the argv without running ffmpeg (no files written). */
  readonly dryRun?: boolean;
  /** Cancels the run when aborted. */
  readonly signal?: AbortSignal;
  /** Invoked for each parsed progress tick. */
  readonly onProgress?: (event: ProgressEvent) => void;
}

/** Result of a completed `extractAudio`. */
export interface ExtractAudioResult {
  /** Where the extracted audio landed. */
  readonly outputPath: string;
  /** The mode actually used. */
  readonly mode: AudioExtractMode;
  /** Wall-clock duration of the job, in milliseconds. */
  readonly elapsedMs: number;
  /** Non-fatal advisories accumulated while running. */
  readonly warnings: readonly ValidationWarning[];
}

/**
 * Request to add an alternate-audio rendition (e.g. a second language) to an
 * existing HLS package. The audio input is segmented into its own audio-only HLS
 * media playlist under the package, and the master is patched with an
 * `EXT-X-MEDIA:TYPE=AUDIO` entry referenced from every variant.
 */
export interface AddAudioTrackRequest {
  /** Directory of the existing HLS package (holds the master playlist). */
  readonly packageDir: string;
  /** Master playlist filename within `packageDir` (default `master.m3u8`). */
  readonly masterPlaylistName?: string;
  /** Path to the external audio file to add. */
  readonly audioInput: string;
  /** BCP-47 / ISO-639 language tag for the rendition (e.g. `"fr"`). */
  readonly language: string;
  /** Human-readable rendition name shown in player menus (e.g. `"Français"`). */
  readonly name: string;
  /** Rendition group id; reuse the same value across calls for multi-language groups (default `"audio"`). */
  readonly groupId?: string;
  /** Mark this rendition `DEFAULT=YES` (default `false`). */
  readonly isDefault?: boolean;
  /** Mark this rendition `AUTOSELECT=YES` (default `true`). */
  readonly autoselect?: boolean;
  /** Which audio stream of `audioInput` to use (0-based; default `0`). */
  readonly trackIndex?: number;
  /** Target AAC bitrate for the segmented audio (bits/sec; default `128000`). */
  readonly audioBitrate?: Bitrate;
  /** Output channel count (default `2`). */
  readonly channels?: number;
  /** Target segment length in seconds (default `6`). */
  readonly segmentDuration?: number;
  /** Allowed |audio − video| duration drift before warning (ms; default `2000`). */
  readonly durationToleranceMs?: number;
  /** Return the argv + planned patch without running ffmpeg or writing files. */
  readonly dryRun?: boolean;
  /** Cancels the run when aborted. */
  readonly signal?: AbortSignal;
  /** Invoked for each parsed progress tick. */
  readonly onProgress?: (event: ProgressEvent) => void;
}

/** Result of a completed `addAudioTrack`. */
export interface AddAudioTrackResult {
  /** Path to the (patched) master playlist. */
  readonly masterPlaylistPath: string;
  /** Path to the new audio rendition's media playlist. */
  readonly audioPlaylistPath: string;
  /** The rendition group id the track was added to. */
  readonly groupId: string;
  /** The rendition name. */
  readonly name: string;
  /** The rendition language tag. */
  readonly language: string;
  /** Wall-clock duration of the job, in milliseconds. */
  readonly elapsedMs: number;
  /** Non-fatal advisories (duration mismatch, muxed-audio caveat, …). */
  readonly warnings: readonly ValidationWarning[];
}

/**
 * A dry-run outcome shared by the audio use cases: the exact ffmpeg argv that
 * *would* run, plus any warnings computed up front, with no side effects.
 */
export interface AudioDryRunResult {
  readonly dryRun: true;
  readonly args: readonly string[];
  readonly warnings: readonly ValidationWarning[];
}

/** Type guard distinguishing an audio dry-run outcome from a completed one. */
export function isAudioDryRun<T extends object>(
  outcome: T | AudioDryRunResult,
): outcome is AudioDryRunResult {
  return "dryRun" in outcome && outcome.dryRun === true;
}
