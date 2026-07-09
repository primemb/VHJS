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
import {
  createTranscoder,
  type TranscodeOutcome,
  type TranscodeRequest,
  type Transcoder,
} from "./hls/transcoder.js";
import type { Logger, ProbeService } from "./ports/index.js";
import type { SourceMetadata } from "./types/metadata.js";

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

  // Build the probe service + transcoder once, after the first binary resolve.
  let servicesPromise: Promise<{ probe: ProbeService; transcoder: Transcoder }> | undefined;
  const services = (): Promise<{ probe: ProbeService; transcoder: Transcoder }> => {
    servicesPromise ??= (async () => {
      const { ffmpeg, ffprobe } = await resolveBinaries();
      const probeService = createFfprobeService({ run, ffprobePath: ffprobe });
      const transcoder = createTranscoder({
        probe: probeService,
        ffmpeg: createFfmpegRunner({ run, ffmpegPath: ffmpeg }),
        fs: createNodeFileSystem(),
        clock: systemClock,
        ...(options.logger ? { logger: options.logger } : {}),
      });
      return { probe: probeService, transcoder };
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
 * Begin the optional fluent API:
 * `vhjs("input.mp4").output("hls").rendition(rendition).run()`.
 */
export function vhjs(input: string, options: VhjsOptions = {}): HlsJobBuilderStart {
  return createHlsJobBuilder(input, createVhjs(options));
}
