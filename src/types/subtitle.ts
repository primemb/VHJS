/**
 * Public request/result types for adding segmented WebVTT subtitle renditions
 * to an existing HLS package. SRT inputs are converted to WebVTT by FFmpeg.
 */
import type { ProgressEvent } from "./progress.js";
import type { ValidationWarning } from "./warnings.js";

/** Request to add an alternate subtitle rendition to an existing HLS package. */
export interface AddSubtitleTrackRequest {
  /** Directory of the existing HLS package (holds the master playlist). */
  readonly packageDir: string;
  /** Master playlist filename within `packageDir` (default `master.m3u8`). */
  readonly masterPlaylistName?: string;
  /** Path to a subtitle input readable by FFmpeg, including WebVTT or SRT. */
  readonly subtitleInput: string;
  /** BCP-47 / ISO-639 language tag for the rendition (for example, `"en"`). */
  readonly language: string;
  /** Human-readable rendition name shown in player menus. */
  readonly name: string;
  /** Reuse a group id across calls for multiple languages (default `"subtitles"`). */
  readonly groupId?: string;
  /** Mark this rendition `DEFAULT=YES` (default `false`). */
  readonly isDefault?: boolean;
  /** Mark this rendition `AUTOSELECT=YES` (default `true`). */
  readonly autoselect?: boolean;
  /** Mark this rendition `FORCED=YES` (default `false`). */
  readonly forced?: boolean;
  /** Which subtitle stream of `subtitleInput` to use (0-based; default `0`). */
  readonly trackIndex?: number;
  /** Target segment length in seconds (default `6`). */
  readonly segmentDuration?: number;
  /** Return the exact FFmpeg argv without running or writing files. */
  readonly dryRun?: boolean;
  /** Cancels the run when aborted. */
  readonly signal?: AbortSignal;
  /** Invoked for each parsed progress tick. */
  readonly onProgress?: (event: ProgressEvent) => void;
}

/** Result of a completed `addSubtitleTrack`. */
export interface AddSubtitleTrackResult {
  /** Path to the patched master playlist. */
  readonly masterPlaylistPath: string;
  /** Path to the new subtitle rendition's media playlist. */
  readonly subtitlePlaylistPath: string;
  readonly groupId: string;
  readonly name: string;
  readonly language: string;
  readonly forced: boolean;
  /** Wall-clock duration of the job, in milliseconds. */
  readonly elapsedMs: number;
  readonly warnings: readonly ValidationWarning[];
}

/** Dry-run outcome for subtitle packaging. */
export interface SubtitleDryRunResult {
  readonly dryRun: true;
  readonly args: readonly string[];
  readonly warnings: readonly ValidationWarning[];
}

/** Distinguish a subtitle dry-run from a completed result. */
export function isSubtitleDryRun<T extends object>(
  outcome: T | SubtitleDryRunResult,
): outcome is SubtitleDryRunResult {
  return "dryRun" in outcome && outcome.dryRun === true;
}
