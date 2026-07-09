/**
 * VHJS — public API surface (single entry, re-exports only).
 *
 * The composed entry points (`probe`, `transcodeToHls`) wire real FFmpeg/ffprobe
 * adapters; everything else here is the stable typed contract: the error
 * hierarchy, source-metadata / progress / rendition types, the branded scalars,
 * and the pure ladder/command helpers for callers who want to build a job by hand.
 */
export const VHJS_VERSION = "0.1.0";

// --- Fluent builder + streaming job ---
export {
  createHlsJobBuilder,
  type HlsJobBuilder,
  type HlsJobBuilderStart,
  type HlsJobClient,
} from "./builder/job-builder.js";
export { startTranscodeJob, TranscodeJob } from "./builder/transcode-job.js";
// --- Composed entry points (composition root) ---
export {
  createVhjs,
  probe,
  startTranscodeToHls,
  transcodeToHls,
  type Vhjs,
  type VhjsOptions,
  vhjs,
} from "./composition.js";
export {
  buildHlsCommand,
  DEFAULT_MASTER_PLAYLIST_NAME,
  DEFAULT_PRESET,
  DEFAULT_SEGMENT_DURATION_SEC,
  type HlsBuildOptions,
  type HlsCommand,
  type HlsVariant,
} from "./hls/command.js";

// --- Pure ladder + command helpers ---
export { autoLadder, type NormalizedLadder, normalizeLadder } from "./hls/ladder.js";
// --- Transcoder use-case types ---
export {
  type DryRunResult,
  isDryRun,
  type TranscodeOutcome,
  type TranscodeRequest,
  type Transcoder,
  type TranscoderDeps,
} from "./hls/transcoder.js";
// --- Branded scalars ---
export type { Bitrate, Brand, FrameRate, Milliseconds, Pixels } from "./types/brands.js";
export { asBitrate, asFrameRate, asMilliseconds, asPixels } from "./types/brands.js";
export {
  type AutoHlsJobConfig,
  type AutoLadderConfig,
  type BitratePolicy,
  DEFAULT_HLS_JOB_OPTIONS,
  type ExplicitHlsJobConfig,
  type ExplicitLadderConfig,
  type HlsJobConfig,
  type HlsJobOptions,
  type HlsLadderConfig,
  type LegacyHlsJobRequest,
} from "./types/config.js";
// --- Domain types ---
export type {
  AudioStream,
  SourceMetadata,
  SubtitleStream,
  VideoStream,
} from "./types/metadata.js";
export {
  type DisplayDimensions,
  displayDimensions,
  isQuarterTurned,
} from "./types/orientation.js";
export type { ProgressEvent } from "./types/progress.js";
export {
  type AudioCodec,
  type Rendition,
  type RenditionOutput,
  renditionName,
  SUPPORTED_AUDIO_CODECS,
  SUPPORTED_VIDEO_CODECS,
  type TranscodeResult,
  type VideoCodec,
} from "./types/rendition.js";
export type { ValidationWarning, ValidationWarningCode } from "./types/warnings.js";
// --- Errors ---
export type { VhjsErrorCode } from "./validation/errors.js";
export {
  BitrateExceedsSourceError,
  ConflictingFfmpegArgError,
  FfmpegNotFoundError,
  FfprobeNotFoundError,
  PlaylistParseError,
  ProbeError,
  ResolutionUpscaleError,
  TranscodeError,
  UnsupportedCodecError,
  VhjsError,
} from "./validation/errors.js";
// --- Validation ---
export {
  clampBitrate,
  DEFAULT_BITRATE_POLICY,
  validateRendition,
} from "./validation/rules.js";
