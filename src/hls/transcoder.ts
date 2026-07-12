/**
 * HLS transcode use case — orchestrates the pipeline CLAUDE.md mandates:
 * **probe → validate → build → run → collect**.
 *
 * It owns no I/O of its own: every side effect (probing, spawning ffmpeg,
 * touching the filesystem, reading the clock) goes through an injected **port**,
 * so the whole orchestration is unit-tested with in-memory fakes and never
 * spawns a real process. The pure decisions it composes — ladder normalization
 * (`hls/ladder`) and argv construction (`hls/command`) — are imported directly
 * because they are deterministic domain logic, not adapters.
 *
 * Inner layer: imports `ports/`, `types/`, `validation/`, and sibling `hls/`
 * modules only — never `core/`. Real adapters are wired in at the composition
 * root (`src/composition.ts`).
 */
import type { Clock, FfmpegRunner, FileSystem, Logger, ProbeService } from "../ports/index.js";
import type { TranscodeRequest } from "../types/config.js";
import type { SourceMetadata } from "../types/metadata.js";
import type { Rendition, RenditionOutput, TranscodeResult } from "../types/rendition.js";
import type { ValidationWarning } from "../types/warnings.js";
import {
  ProbeError,
  TranscodeError,
  WatermarkFileNotFoundError,
  WatermarkFontFileNotFoundError,
} from "../validation/errors.js";
import { isTextWatermark, normalizeWatermark } from "../validation/watermark.js";
import { buildHlsCommand, DEFAULT_SEGMENT_DURATION_SEC, type HlsBuildOptions } from "./command.js";
import { autoLadder, normalizeLadder } from "./ladder.js";

/** Injected ports for the transcoder (adapters wired at the composition root). */
export interface TranscoderDeps {
  readonly probe: ProbeService;
  readonly ffmpeg: FfmpegRunner;
  readonly fs: FileSystem;
  readonly clock: Clock;
  readonly logger?: Logger;
}

export type { TranscodeRequest } from "../types/config.js";

/** The result of a `dryRun` request: the exact command, without side effects. */
export interface DryRunResult {
  readonly dryRun: true;
  readonly args: readonly string[];
  readonly renditions: readonly Rendition[];
  readonly masterPlaylistPath: string;
  readonly warnings: readonly ValidationWarning[];
}

/** Discriminated outcome: a real run's `TranscodeResult`, or a `DryRunResult`. */
export type TranscodeOutcome = TranscodeResult | DryRunResult;

/** Type guard distinguishing a dry-run outcome from a completed transcode. */
export function isDryRun(outcome: TranscodeOutcome): outcome is DryRunResult {
  return "dryRun" in outcome && outcome.dryRun;
}

export interface Transcoder {
  transcodeToHls(request: TranscodeRequest): Promise<TranscodeOutcome>;
}

/** Create a transcoder bound to a set of ports. */
export function createTranscoder(deps: TranscoderDeps): Transcoder {
  return {
    async transcodeToHls(request: TranscodeRequest): Promise<TranscodeOutcome> {
      // 1. Validate input location up front for a clear, typed failure.
      if (!(await deps.fs.exists(request.input))) {
        throw new ProbeError(`Input file not found: ${request.input}`);
      }

      // 2. Probe the source.
      const source = await deps.probe.probe(request.input, request.signal);

      // Validate watermark input before FFmpeg runs. This applies to dry runs
      // too, just like the source-input preflight above.
      if (request.watermark !== undefined) {
        const watermark = normalizeWatermark(request.watermark);
        if (isTextWatermark(watermark)) {
          if (watermark.fontFile !== undefined && !(await deps.fs.exists(watermark.fontFile))) {
            throw new WatermarkFontFileNotFoundError(watermark.fontFile);
          }
        } else if (!(await deps.fs.exists(watermark.input))) {
          throw new WatermarkFileNotFoundError(watermark.input);
        }
      }

      // 3. Validate + normalize the ladder (throws typed errors on hard failures).
      const requested = requestedLadder(request, source);
      const { renditions, warnings } = normalizeLadder(requested, source, request.bitratePolicy);
      if (renditions.length === 0) {
        throw new ProbeError("No renditions to encode after normalization.");
      }
      for (const warning of warnings) {
        deps.logger?.warn(warning.message, { code: warning.code });
      }

      // 4. Build the exact ffmpeg command (pure). Audio is only mapped when the
      // source actually has an audio track.
      const segmentDuration = request.segmentDuration ?? DEFAULT_SEGMENT_DURATION_SEC;
      const targetFrameRate = request.frameRate ?? sourceFrameRate(source);
      const command = buildHlsCommand(
        buildOptions(request, renditions, segmentDuration, targetFrameRate, {
          includeAudio: source.audio.length > 0,
        }),
      );

      if (request.dryRun) {
        return {
          dryRun: true,
          args: command.args,
          renditions,
          masterPlaylistPath: command.masterPlaylistPath,
          warnings,
        };
      }

      // 5. Create the output directory tree (writes stay under outputDir).
      await deps.fs.mkdirp(request.outputDir);
      for (const variant of command.variants) {
        await deps.fs.mkdirp(variant.dir);
      }

      // 6. Run ffmpeg, streaming progress.
      const startedAt = deps.clock.now();
      deps.logger?.info("Starting HLS transcode", {
        input: request.input,
        renditions: renditions.length,
      });
      const runResult = await deps.ffmpeg.run({
        args: command.args,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.onProgress ? { onProgress: request.onProgress } : {}),
      });
      if (runResult.exitCode !== 0) {
        throw new TranscodeError(runResult.exitCode, runResult.stderrTail);
      }

      // 7. Collect the outputs.
      const elapsedMs = deps.clock.now() - startedAt;
      const outputs: RenditionOutput[] = command.variants.map((variant) => ({
        rendition: variant.rendition,
        name: variant.name,
        playlistPath: variant.playlistPath,
      }));
      deps.logger?.info("Finished HLS transcode", { elapsedMs });

      return {
        masterPlaylistPath: command.masterPlaylistPath,
        renditions: outputs,
        elapsedMs,
        warnings,
      };
    },
  };
}

/** Resolve either the Phase-4 discriminated config or the compatible Phase-3 shape. */
function requestedLadder(request: TranscodeRequest, source: SourceMetadata): readonly Rendition[] {
  if (request.ladder?.mode === "explicit") {
    return request.ladder.renditions;
  }
  if ("renditions" in request && request.renditions && request.renditions.length > 0) {
    return request.renditions;
  }
  return autoLadder(source);
}

/** The source frame rate, used to align the keyframe interval to segments. */
function sourceFrameRate(source: SourceMetadata): number | undefined {
  const fps = source.video[0]?.frameRate;
  return fps === null || fps === undefined ? undefined : fps;
}

/** Assemble `buildHlsCommand` options, omitting undefined optionals (exactOptionalPropertyTypes). */
function buildOptions(
  request: TranscodeRequest,
  renditions: readonly Rendition[],
  segmentDuration: number,
  frameRate: number | undefined,
  extra: { readonly includeAudio: boolean },
): HlsBuildOptions {
  const gopSize = frameRate === undefined ? undefined : Math.round(frameRate * segmentDuration);
  return {
    input: request.input,
    outputDir: request.outputDir,
    renditions,
    segmentDuration,
    includeAudio: extra.includeAudio,
    ...(request.masterPlaylistName ? { masterPlaylistName: request.masterPlaylistName } : {}),
    ...(request.preset ? { preset: request.preset } : {}),
    ...(request.frameRate !== undefined ? { frameRate: request.frameRate } : {}),
    ...(gopSize !== undefined ? { gopSize } : {}),
    ...(request.inputArgs ? { inputArgs: request.inputArgs } : {}),
    ...(request.outputArgs ? { outputArgs: request.outputArgs } : {}),
    ...(request.watermark ? { watermark: request.watermark } : {}),
  };
}
