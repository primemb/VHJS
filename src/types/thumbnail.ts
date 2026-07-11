/** Public request/result types for extracting a single video thumbnail. */
import type { ProgressEvent } from "./progress.js";

/** Request a JPEG thumbnail from a video at an exact timestamp. */
export interface GenerateThumbnailRequest {
  /** Source video path. */
  readonly input: string;
  /** Destination image path (normally ending in `.jpg` or `.jpeg`). */
  readonly output: string;
  /** Timestamp in seconds; defaults to second `1`. */
  readonly timestampSeconds?: number;
  /** Return the exact FFmpeg argv without writing an image. */
  readonly dryRun?: boolean;
  /** Cancels the FFmpeg run when aborted. */
  readonly signal?: AbortSignal;
  /** Receives FFmpeg progress events while the image is generated. */
  readonly onProgress?: (event: ProgressEvent) => void;
}

/** Result of successfully generating a thumbnail. */
export interface GenerateThumbnailResult {
  readonly outputPath: string;
  readonly timestampSeconds: number;
  readonly elapsedMs: number;
}

/** Dry-run result for thumbnail generation. */
export interface ThumbnailDryRunResult {
  readonly dryRun: true;
  readonly args: readonly string[];
  readonly timestampSeconds: number;
}

/** Distinguish a thumbnail dry-run from a completed result. */
export function isThumbnailDryRun(
  outcome: GenerateThumbnailResult | ThumbnailDryRunResult,
): outcome is ThumbnailDryRunResult {
  return "dryRun" in outcome && outcome.dryRun;
}
