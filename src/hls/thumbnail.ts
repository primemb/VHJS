/**
 * Thumbnail generation: a pure FFmpeg argv builder plus a probe-first use case
 * over injected ports. The timestamp is checked against the source duration
 * before FFmpeg runs, so callers receive a specific typed validation error.
 */
import { dirname } from "node:path";
import type { Clock, FfmpegRunner, FileSystem, ProbeService } from "../ports/index.js";
import type {
  GenerateThumbnailRequest,
  GenerateThumbnailResult,
  ThumbnailDryRunResult,
} from "../types/thumbnail.js";
import {
  InvalidThumbnailTimestampError,
  ProbeError,
  ThumbnailTimestampExceedsDurationError,
  TranscodeError,
  VideoDurationUnavailableError,
} from "../validation/errors.js";

/** The requested timestamp when callers do not choose one themselves. */
export const DEFAULT_THUMBNAIL_TIMESTAMP_SECONDS = 1;

/** Options for the pure thumbnail FFmpeg command builder. */
export interface ThumbnailBuildOptions {
  readonly input: string;
  readonly output: string;
  readonly timestampSeconds?: number;
}

/** Build the FFmpeg command that writes exactly one JPEG-compatible image. */
export function buildThumbnailCommand(options: ThumbnailBuildOptions): {
  readonly args: readonly string[];
} {
  const timestampSeconds = options.timestampSeconds ?? DEFAULT_THUMBNAIL_TIMESTAMP_SECONDS;
  assertValidThumbnailTimestamp(timestampSeconds);
  return {
    args: [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-ss",
      `${timestampSeconds}`,
      "-i",
      options.input,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      options.output,
    ],
  };
}

/** Dependencies for thumbnail generation. */
export interface ThumbnailToolsDeps {
  readonly probe: ProbeService;
  readonly ffmpeg: FfmpegRunner;
  readonly fs: FileSystem;
  readonly clock: Clock;
}

/** Thumbnail generator bound to the supplied adapters. */
export interface ThumbnailTools {
  generateThumbnail(
    request: GenerateThumbnailRequest,
  ): Promise<GenerateThumbnailResult | ThumbnailDryRunResult>;
}

/** Reject timestamps that cannot be represented as a valid media offset. */
export function assertValidThumbnailTimestamp(timestampSeconds: number): void {
  if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
    throw new InvalidThumbnailTimestampError(timestampSeconds);
  }
}

/** Create thumbnail tools over injected filesystem, probe and FFmpeg ports. */
export function createThumbnailTools(deps: ThumbnailToolsDeps): ThumbnailTools {
  return {
    async generateThumbnail(
      request: GenerateThumbnailRequest,
    ): Promise<GenerateThumbnailResult | ThumbnailDryRunResult> {
      if (!(await deps.fs.exists(request.input))) {
        throw new ProbeError(`Input file not found: ${request.input}`);
      }
      const timestampSeconds = request.timestampSeconds ?? DEFAULT_THUMBNAIL_TIMESTAMP_SECONDS;
      assertValidThumbnailTimestamp(timestampSeconds);
      const source = await deps.probe.probe(request.input, request.signal);
      if (source.video.length === 0) {
        throw new ProbeError(`No video stream found in "${request.input}".`);
      }
      if (source.durationMs === null) {
        throw new VideoDurationUnavailableError(request.input);
      }
      const timestampMs = timestampSeconds * 1_000;
      if (timestampMs > source.durationMs) {
        throw new ThumbnailTimestampExceedsDurationError(timestampMs, source.durationMs);
      }
      const { args } = buildThumbnailCommand({
        input: request.input,
        output: request.output,
        timestampSeconds,
      });
      if (request.dryRun) {
        return { dryRun: true, args, timestampSeconds };
      }
      await deps.fs.mkdirp(dirname(request.output));
      const startedAt = deps.clock.now();
      const result = await deps.ffmpeg.run({
        args,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.onProgress ? { onProgress: request.onProgress } : {}),
      });
      if (result.exitCode !== 0) {
        throw new TranscodeError(result.exitCode, result.stderrTail);
      }
      return {
        outputPath: request.output,
        timestampSeconds,
        elapsedMs: deps.clock.now() - startedAt,
      };
    },
  };
}
