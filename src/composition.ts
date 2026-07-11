/**
 * Composition root — the one place that wires real adapters into the use cases.
 *
 * Everything inward (domain, use cases, ports) stays framework- and I/O-free and
 * receives its dependencies by injection; here we construct the concrete
 * `core/` adapters (process runner, binary resolution, ffprobe/ffmpeg, node fs,
 * system clock) and hand them to the transcoder. This is the only non-test module
 * besides the public barrel that is allowed to import `core/`.
 *
 * Because it is pure wiring (no branching logic of its own), it is exercised by
 * the examples and the opt-in e2e suite rather than by unit tests — like the
 * public barrel, it is excluded from the coverage gate.
 */

import { createHlsJobBuilder, type HlsJobBuilderStart } from "./builder/job-builder.js";
import { startTranscodeJob, type TranscodeJob } from "./builder/transcode-job.js";
import { createBinaryResolver, createBinaryVerifier } from "./core/binaries.js";
import { systemClock } from "./core/clock.js";
import { createFfmpegRunner } from "./core/ffmpeg.js";
import { createFfprobeService } from "./core/ffprobe.js";
import { createNodeFileSystem } from "./core/fs.js";
import { createProcessRunner } from "./core/process.js";
import { type AlternateTrackTools, createAlternateTrackTools } from "./hls/alternate-track.js";
import { type AudioTools, createAudioTools } from "./hls/audio.js";
import { createSubtitleTools, type SubtitleTools } from "./hls/subtitle.js";
import { createThumbnailTools, type ThumbnailTools } from "./hls/thumbnail.js";
import {
  createTranscoder,
  type TranscodeOutcome,
  type TranscodeRequest,
  type Transcoder,
} from "./hls/transcoder.js";
import type { Logger, ProbeService } from "./ports/index.js";
import type {
  AddAudioTrackRequest,
  AddAudioTrackResult,
  AudioDryRunResult,
  ExtractAudioRequest,
  ExtractAudioResult,
} from "./types/audio.js";
import type { SourceMetadata } from "./types/metadata.js";
import type {
  AddSubtitleTrackRequest,
  AddSubtitleTrackResult,
  SubtitleDryRunResult,
} from "./types/subtitle.js";
import type {
  GenerateThumbnailRequest,
  GenerateThumbnailResult,
  ThumbnailDryRunResult,
} from "./types/thumbnail.js";
import type {
  RemoveAlternateTrackResult,
  RemoveAudioTrackRequest,
  RemoveSubtitleTrackRequest,
} from "./types/tracks.js";

/** Options common to the composed entry points. */
export interface VhjsOptions {
  /** Explicit path to the ffmpeg binary (defaults to `ffmpeg` on PATH). */
  readonly ffmpegPath?: string;
  /** Explicit path to the ffprobe binary (defaults to `ffprobe` on PATH). */
  readonly ffprobePath?: string;
  /** Optional structured logger. */
  readonly logger?: Logger;
}

/** A configured VHJS instance: FFmpeg/ffprobe resolved once, then reused. */
export interface Vhjs {
  /** Probe a source file into typed `SourceMetadata`. */
  probe(input: string, signal?: AbortSignal): Promise<SourceMetadata>;
  /** Transcode a source file into an HLS package (or dry-run the command). */
  transcodeToHls(request: TranscodeRequest): Promise<TranscodeOutcome>;
  /** Start a job with EventEmitter and AsyncIterable progress delivery. */
  startTranscodeToHls(request: TranscodeRequest): TranscodeJob;
  /** Extract/demux one audio track from a video into a standalone file. */
  extractAudio(request: ExtractAudioRequest): Promise<ExtractAudioResult | AudioDryRunResult>;
  /** Add an alternate-audio rendition to an existing HLS package. */
  addAudioTrack(request: AddAudioTrackRequest): Promise<AddAudioTrackResult | AudioDryRunResult>;
  /** Add a segmented WebVTT subtitle rendition to an existing HLS package. */
  addSubtitleTrack(
    request: AddSubtitleTrackRequest,
  ): Promise<AddSubtitleTrackResult | SubtitleDryRunResult>;
  /** Remove an alternate-audio rendition, optionally deleting its generated files. */
  removeAudioTrack(request: RemoveAudioTrackRequest): Promise<RemoveAlternateTrackResult>;
  /** Remove an alternate subtitle rendition, optionally deleting its generated files. */
  removeSubtitleTrack(request: RemoveSubtitleTrackRequest): Promise<RemoveAlternateTrackResult>;
  /** Generate one thumbnail at a validated source timestamp. */
  generateThumbnail(
    request: GenerateThumbnailRequest,
  ): Promise<GenerateThumbnailResult | ThumbnailDryRunResult>;
}

/** Build the `BinaryOverrides` object, omitting undefined keys. */
function overrides(options: VhjsOptions): { ffmpegPath?: string; ffprobePath?: string } {
  return {
    ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
    ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
  };
}

/**
 * Create a configured VHJS instance. Bind the binary paths / logger **once**,
 * then call `probe` / `transcodeToHls` as many times as you like without
 * re-passing options. Binary resolution is memoized, so ffmpeg/ffprobe are
 * verified only on the first call and shared across every later one.
 *
 * ```ts
 * const vhjs = createVhjs({ ffmpegPath: "/opt/ffmpeg" });
 * const meta = await vhjs.probe("in.mp4");
 * await vhjs.transcodeToHls({ input: "in.mp4", outputDir: "out" });
 * ```
 */
export function createVhjs(options: VhjsOptions = {}): Vhjs {
  const run = createProcessRunner();
  const resolveBinaries = createBinaryResolver(createBinaryVerifier(run), overrides(options));

  // Build the probe service + transcoder + audio tools once, after the first
  // binary resolve. They share the same adapters (ffmpeg runner, fs, clock).
  type Services = {
    probe: ProbeService;
    transcoder: Transcoder;
    audio: AudioTools;
    subtitle: SubtitleTools;
    alternateTracks: AlternateTrackTools;
    thumbnail: ThumbnailTools;
  };
  let servicesPromise: Promise<Services> | undefined;
  const services = (): Promise<Services> => {
    servicesPromise ??= (async () => {
      const { ffmpeg, ffprobe } = await resolveBinaries();
      const probeService = createFfprobeService({ run, ffprobePath: ffprobe });
      const sharedDeps = {
        probe: probeService,
        ffmpeg: createFfmpegRunner({ run, ffmpegPath: ffmpeg }),
        fs: createNodeFileSystem(),
        clock: systemClock,
        ...(options.logger ? { logger: options.logger } : {}),
      };
      return {
        probe: probeService,
        transcoder: createTranscoder(sharedDeps),
        audio: createAudioTools(sharedDeps),
        subtitle: createSubtitleTools(sharedDeps),
        alternateTracks: createAlternateTrackTools(sharedDeps),
        thumbnail: createThumbnailTools(sharedDeps),
      };
    })();
    return servicesPromise;
  };

  return {
    async probe(input, signal) {
      const { probe: probeService } = await services();
      return probeService.probe(input, signal);
    },
    async transcodeToHls(request) {
      const { transcoder } = await services();
      return transcoder.transcodeToHls(request);
    },
    startTranscodeToHls(request) {
      return startTranscodeJob(
        {
          transcodeToHls: async (jobRequest) => {
            const { transcoder } = await services();
            return transcoder.transcodeToHls(jobRequest);
          },
        },
        request,
      );
    },
    async extractAudio(request) {
      const { audio } = await services();
      return audio.extractAudio(request);
    },
    async addAudioTrack(request) {
      const { audio } = await services();
      return audio.addAudioTrack(request);
    },
    async addSubtitleTrack(request) {
      const { subtitle } = await services();
      return subtitle.addSubtitleTrack(request);
    },
    async removeAudioTrack(request) {
      const { alternateTracks } = await services();
      return alternateTracks.removeAlternateTrack("AUDIO", request);
    },
    async removeSubtitleTrack(request) {
      const { alternateTracks } = await services();
      return alternateTracks.removeAlternateTrack("SUBTITLES", request);
    },
    async generateThumbnail(request) {
      const { thumbnail } = await services();
      return thumbnail.generateThumbnail(request);
    },
  };
}

/**
 * One-shot probe. Convenience wrapper over `createVhjs(options).probe(input)` —
 * prefer a shared `createVhjs` instance when making multiple calls.
 */
export function probe(input: string, options: VhjsOptions = {}): Promise<SourceMetadata> {
  return createVhjs(options).probe(input);
}

/**
 * One-shot transcode. Convenience wrapper over
 * `createVhjs(options).transcodeToHls(request)` — prefer a shared `createVhjs`
 * instance when making multiple calls. Pass `dryRun: true` to get the argv
 * without executing.
 */
export function transcodeToHls(
  request: TranscodeRequest,
  options: VhjsOptions = {},
): Promise<TranscodeOutcome> {
  return createVhjs(options).transcodeToHls(request);
}

/**
 * One-shot streaming transcode. The returned job is both an `EventEmitter` and
 * an `AsyncIterable`; await `job.result` for the final outcome.
 */
export function startTranscodeToHls(
  request: TranscodeRequest,
  options: VhjsOptions = {},
): TranscodeJob {
  return createVhjs(options).startTranscodeToHls(request);
}

/**
 * One-shot audio extraction. Convenience wrapper over
 * `createVhjs(options).extractAudio(request)` — prefer a shared `createVhjs`
 * instance for multiple calls. Pass `dryRun: true` to get the argv without executing.
 */
export function extractAudio(
  request: ExtractAudioRequest,
  options: VhjsOptions = {},
): Promise<ExtractAudioResult | AudioDryRunResult> {
  return createVhjs(options).extractAudio(request);
}

/**
 * One-shot alternate-audio add. Convenience wrapper over
 * `createVhjs(options).addAudioTrack(request)` — prefer a shared `createVhjs`
 * instance for multiple calls.
 */
export function addAudioTrack(
  request: AddAudioTrackRequest,
  options: VhjsOptions = {},
): Promise<AddAudioTrackResult | AudioDryRunResult> {
  return createVhjs(options).addAudioTrack(request);
}

/** One-shot subtitle add; SRT inputs are converted to segmented WebVTT. */
export function addSubtitleTrack(
  request: AddSubtitleTrackRequest,
  options: VhjsOptions = {},
): Promise<AddSubtitleTrackResult | SubtitleDryRunResult> {
  return createVhjs(options).addSubtitleTrack(request);
}

/** One-shot alternate-audio removal. */
export function removeAudioTrack(
  request: RemoveAudioTrackRequest,
  options: VhjsOptions = {},
): Promise<RemoveAlternateTrackResult> {
  return createVhjs(options).removeAudioTrack(request);
}

/** One-shot alternate-subtitle removal. */
export function removeSubtitleTrack(
  request: RemoveSubtitleTrackRequest,
  options: VhjsOptions = {},
): Promise<RemoveAlternateTrackResult> {
  return createVhjs(options).removeSubtitleTrack(request);
}

/** One-shot thumbnail generation. */
export function generateThumbnail(
  request: GenerateThumbnailRequest,
  options: VhjsOptions = {},
): Promise<GenerateThumbnailResult | ThumbnailDryRunResult> {
  return createVhjs(options).generateThumbnail(request);
}

/**
 * Begin the optional fluent API:
 * `vhjs("input.mp4").output("hls").rendition(rendition).run()`.
 */
export function vhjs(input: string, options: VhjsOptions = {}): HlsJobBuilderStart {
  return createHlsJobBuilder(input, createVhjs(options));
}
