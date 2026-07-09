/**
 * Fluent public DX over the discriminated `HlsJobConfig`. The builder is
 * immutable: every modifier returns a new builder, so derived jobs cannot
 * accidentally change one another before they are run.
 */
import type { TranscodeOutcome } from "../hls/transcoder.js";
import type { BitratePolicy, HlsJobConfig, TranscodeRequest } from "../types/config.js";
import type { ProgressEvent } from "../types/progress.js";
import type { Rendition } from "../types/rendition.js";
import type { TranscodeJob } from "./transcode-job.js";

/** The small client surface the builder needs; `Vhjs` and test doubles fit it. */
export interface HlsJobClient {
  transcodeToHls(request: TranscodeRequest): Promise<TranscodeOutcome>;
  startTranscodeToHls(request: TranscodeRequest): TranscodeJob;
}

/** Initial builder state: output is intentionally required before a job can run. */
export interface HlsJobBuilderStart {
  output(outputDir: string): HlsJobBuilder;
}

/** A configured fluent HLS job. Call `run()` or `start()` to execute it. */
export interface HlsJobBuilder {
  rendition(rendition: Rendition): HlsJobBuilder;
  segmentDuration(seconds: number): HlsJobBuilder;
  masterPlaylist(name: string): HlsJobBuilder;
  preset(name: string): HlsJobBuilder;
  bitratePolicy(policy: BitratePolicy): HlsJobBuilder;
  inputArgs(...args: string[]): HlsJobBuilder;
  outputArgs(...args: string[]): HlsJobBuilder;
  dryRun(enabled?: boolean): HlsJobBuilder;
  signal(signal: AbortSignal): HlsJobBuilder;
  onProgress(listener: (event: ProgressEvent) => void): HlsJobBuilder;
  /** Start a promise-only run. Prefer `start()` when progress is consumed as a stream. */
  run(): Promise<TranscodeOutcome>;
  /** Start and return the EventEmitter + AsyncIterable job handle. */
  start(): TranscodeJob;
}

interface HlsJobDraft {
  readonly input: string;
  readonly outputDir: string;
  readonly renditions: readonly Rendition[];
  readonly segmentDuration?: number;
  readonly masterPlaylistName?: string;
  readonly preset?: string;
  readonly bitratePolicy?: BitratePolicy;
  readonly inputArgs?: readonly string[];
  readonly outputArgs?: readonly string[];
  readonly dryRun?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: ProgressEvent) => void;
}

/** Begin a fluent job. `output()` is required before the job can be run. */
export function createHlsJobBuilder(input: string, client: HlsJobClient): HlsJobBuilderStart {
  return {
    output: (outputDir) => createConfiguredBuilder({ input, outputDir, renditions: [] }, client),
  };
}

/** Construct an immutable builder around an already-configured output directory. */
function createConfiguredBuilder(draft: HlsJobDraft, client: HlsJobClient): HlsJobBuilder {
  const next = (changes: Partial<HlsJobDraft>): HlsJobBuilder =>
    createConfiguredBuilder({ ...draft, ...changes }, client);

  return {
    rendition: (rendition) => next({ renditions: [...draft.renditions, rendition] }),
    segmentDuration: (segmentDuration) => next({ segmentDuration }),
    masterPlaylist: (masterPlaylistName) => next({ masterPlaylistName }),
    preset: (preset) => next({ preset }),
    bitratePolicy: (bitratePolicy) => next({ bitratePolicy }),
    inputArgs: (...inputArgs) => next({ inputArgs }),
    outputArgs: (...outputArgs) => next({ outputArgs }),
    dryRun: (enabled = true) => next({ dryRun: enabled }),
    signal: (signal) => next({ signal }),
    onProgress: (onProgress) => next({ onProgress }),
    run: () => client.transcodeToHls(toConfig(draft)),
    start: () => client.startTranscodeToHls(toConfig(draft)),
  };
}

/** Convert builder state into the canonical discriminated configuration. */
function toConfig(draft: HlsJobDraft): HlsJobConfig {
  const options = {
    input: draft.input,
    outputDir: draft.outputDir,
    ...(draft.segmentDuration === undefined ? {} : { segmentDuration: draft.segmentDuration }),
    ...(draft.masterPlaylistName === undefined
      ? {}
      : { masterPlaylistName: draft.masterPlaylistName }),
    ...(draft.preset === undefined ? {} : { preset: draft.preset }),
    ...(draft.bitratePolicy === undefined ? {} : { bitratePolicy: draft.bitratePolicy }),
    ...(draft.inputArgs === undefined ? {} : { inputArgs: draft.inputArgs }),
    ...(draft.outputArgs === undefined ? {} : { outputArgs: draft.outputArgs }),
    ...(draft.dryRun === undefined ? {} : { dryRun: draft.dryRun }),
    ...(draft.signal === undefined ? {} : { signal: draft.signal }),
    ...(draft.onProgress === undefined ? {} : { onProgress: draft.onProgress }),
  };
  return draft.renditions.length === 0
    ? { ...options, ladder: { mode: "auto" } }
    : { ...options, ladder: { mode: "explicit", renditions: draft.renditions } };
}
