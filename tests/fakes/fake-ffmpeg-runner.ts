import type { FfmpegRunner, FfmpegRunOptions, FfmpegRunResult } from "../../src/ports/index.js";
import type { ProgressEvent } from "../../src/types/progress.js";

/** What a `FakeFfmpegRunner` should emit/return for a run. */
export interface FfmpegScript {
  /** Progress ticks replayed (in order) to `onProgress` before resolving. */
  readonly progress?: readonly ProgressEvent[];
  /** The result to resolve with (defaults to a clean exit). */
  readonly result?: FfmpegRunResult;
  /** When set, `run` rejects with this instead of resolving. */
  readonly error?: Error;
}

/**
 * An `FfmpegRunner` that records every invocation and replays a scripted set of
 * progress events + result — so use-case tests assert on the argv built and the
 * events emitted without spawning ffmpeg.
 */
export class FakeFfmpegRunner implements FfmpegRunner {
  readonly calls: FfmpegRunOptions[] = [];

  constructor(private readonly script: FfmpegScript = {}) {}

  async run(options: FfmpegRunOptions): Promise<FfmpegRunResult> {
    this.calls.push(options);
    if (this.script.error !== undefined) {
      throw this.script.error;
    }
    for (const event of this.script.progress ?? []) {
      options.onProgress?.(event);
    }
    return this.script.result ?? { exitCode: 0, stderrTail: "" };
  }

  /** The argv of the most recent run (empty when never called). */
  get lastArgs(): readonly string[] {
    return this.calls.at(-1)?.args ?? [];
  }
}
