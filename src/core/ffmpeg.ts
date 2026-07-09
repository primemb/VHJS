/**
 * ffmpeg runner adapter — the I/O "do" half of transcoding.
 *
 * It implements the `FfmpegRunner` port: hand it a prebuilt argv (from
 * `hls/command`, the pure decision half) and it spawns ffmpeg via the injected
 * `ProcessRunner`, parses progress out of stderr into the caller's `onProgress`,
 * retains a bounded stderr tail for typed error reporting, and rejects distinctly
 * on cancellation. This is an adapter — the only layer allowed to depend on
 * `core/` process machinery.
 */
import type { FfmpegRunner, FfmpegRunOptions, FfmpegRunResult } from "../ports/index.js";
import type { ProcessRunner } from "./process.js";
import { createProgressParser } from "./progress.js";

/** Dependencies for the ffmpeg runner adapter. */
export interface FfmpegRunnerDeps {
  readonly run: ProcessRunner;
  /** Resolved ffmpeg command (see `core/binaries`). */
  readonly ffmpegPath: string;
  /** How many trailing bytes of stderr to retain for diagnostics (default 4096). */
  readonly stderrTailBytes?: number;
}

/**
 * Create an `FfmpegRunner` backed by a real ffmpeg process. It parses progress
 * out of stderr (via `createProgressParser`) into the caller's `onProgress`,
 * retains a bounded stderr tail for error reporting, and rejects if the run is
 * aborted (so cancellation surfaces distinctly from a non-zero exit).
 */
export function createFfmpegRunner(deps: FfmpegRunnerDeps): FfmpegRunner {
  const tailBytes = deps.stderrTailBytes ?? 4_096;

  return {
    async run(options: FfmpegRunOptions): Promise<FfmpegRunResult> {
      let stderrTail = "";
      const feed = options.onProgress ? createProgressParser(options.onProgress) : undefined;

      const onStderr = (chunk: string): void => {
        stderrTail = (stderrTail + chunk).slice(-tailBytes);
        feed?.(chunk);
      };

      const result = await deps.run(deps.ffmpegPath, {
        args: [...options.args],
        onStderr,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      if (result.aborted) {
        throw options.signal?.reason instanceof Error
          ? options.signal.reason
          : new Error("ffmpeg run was aborted");
      }

      return { exitCode: result.exitCode ?? -1, stderrTail };
    },
  };
}
