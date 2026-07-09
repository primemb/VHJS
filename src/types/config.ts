/**
 * Public job configuration. The `ladder` member is a discriminated union so a
 * caller must supply renditions when choosing an explicit ladder, while an
 * omitted ladder means "derive one from the source".
 *
 * This module deliberately depends only on other public types. Validation owns
 * the policy's behaviour, but its shape belongs here because it is user input.
 */
import type { ProgressEvent } from "./progress.js";
import type { Rendition } from "./rendition.js";

/** Tunable thresholds for the source-bitrate validation policy. */
export interface BitratePolicy {
  /** A request above this multiple of the source bitrate is rejected. */
  readonly hardExceedFactor: number;
}

/** Defaults applied by the transcoder when a job does not override them. */
export const DEFAULT_HLS_JOB_OPTIONS = {
  segmentDuration: 6,
  masterPlaylistName: "master.m3u8",
  preset: "veryfast",
} as const;

/** A ladder derived from the probed source. This is the default strategy. */
export interface AutoLadderConfig {
  readonly mode: "auto";
}

/** A caller-provided adaptive-bitrate ladder. */
export interface ExplicitLadderConfig {
  readonly mode: "explicit";
  readonly renditions: readonly Rendition[];
}

/** The ladder strategy for an HLS job. */
export type HlsLadderConfig = AutoLadderConfig | ExplicitLadderConfig;

/** Options shared by every HLS job, independent of its ladder strategy. */
export interface HlsJobOptions {
  readonly input: string;
  readonly outputDir: string;
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

/** A job that lets VHJS derive a ladder from the source metadata. */
export interface AutoHlsJobConfig extends HlsJobOptions {
  /** Omit `ladder` for the same auto-ladder default. */
  readonly ladder?: AutoLadderConfig;
}

/** A job with an explicit ladder. `renditions` is required by the discriminant. */
export interface ExplicitHlsJobConfig extends HlsJobOptions {
  readonly ladder: ExplicitLadderConfig;
}

/**
 * The canonical Phase-4 job shape. `ladder.mode` narrows the configuration:
 * "explicit" always carries renditions; absent or "auto" derives them.
 */
export type HlsJobConfig = AutoHlsJobConfig | ExplicitHlsJobConfig;

/**
 * Compatibility shape accepted by the Phase-3 API. It remains public so moving
 * to `HlsJobConfig` is additive instead of making existing applications break.
 */
export interface LegacyHlsJobRequest extends HlsJobOptions {
  readonly ladder?: never;
  /** Omit or pass an empty array to auto-derive a ladder. */
  readonly renditions?: readonly Rendition[];
}

/** Any request accepted by the public transcode APIs. */
export type TranscodeRequest = HlsJobConfig | LegacyHlsJobRequest;
