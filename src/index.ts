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
  addAudioTrack,
  addSubtitleTrack,
  createVhjs,
  extractAudio,
  generateThumbnail,
  probe,
  removeAudioTrack,
  removeSubtitleTrack,
  startTranscodeToHls,
  transcodeToHls,
  type Vhjs,
  type VhjsOptions,
  vhjs,
} from "./composition.js";
export {
  type AlternateTrackTools,
  type AlternateTrackToolsDeps,
  createAlternateTrackTools,
  renditionDirectory,
} from "./hls/alternate-track.js";
export {
  type AudioExtractBuildOptions,
  type AudioHlsBuildOptions,
  type AudioTools,
  type AudioToolsDeps,
  buildAudioExtractCommand,
  buildAudioHlsCommand,
  createAudioTools,
} from "./hls/audio.js";
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
// --- Playlist parse / serialize / patch (Phase 7, pulled forward) ---
export {
  type AlternateAudioOptions,
  type AlternateSubtitleOptions,
  type Attributes,
  addAlternateAudio,
  addAlternateSubtitle,
  type ByteRange,
  type MasterPlaylist,
  type MediaKey,
  type MediaPlaylist,
  type MediaRendition,
  type MediaSegment,
  parseMasterPlaylist,
  parseMediaPlaylist,
  type RemovedAlternateRendition,
  removeAlternateRendition,
  serializeMasterPlaylist,
  serializeMediaPlaylist,
  sumMediaPlaylistDurationMs,
  type VariantStream,
  variantHasMuxedAudio,
} from "./hls/playlist.js";
// --- Audio use cases (builders + types) ---
export {
  buildSubtitleHlsCommand,
  createSubtitleTools,
  type SubtitleHlsBuildOptions,
  type SubtitleTools,
  type SubtitleToolsDeps,
} from "./hls/subtitle.js";
export {
  buildThumbnailCommand,
  createThumbnailTools,
  DEFAULT_THUMBNAIL_TIMESTAMP_SECONDS,
  type ThumbnailBuildOptions,
  type ThumbnailTools,
  type ThumbnailToolsDeps,
} from "./hls/thumbnail.js";
// --- Transcoder use-case types ---
export {
  type DryRunResult,
  isDryRun,
  type TranscodeOutcome,
  type TranscodeRequest,
  type Transcoder,
  type TranscoderDeps,
} from "./hls/transcoder.js";
// --- Audio request/result types ---
export {
  type AddAudioTrackRequest,
  type AddAudioTrackResult,
  type AudioDryRunResult,
  type AudioExtractMode,
  type ExtractAudioRequest,
  type ExtractAudioResult,
  isAudioDryRun,
} from "./types/audio.js";
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
export { FFMPEG_PRESETS, type FfmpegPreset, isFfmpegPreset } from "./types/encoding.js";
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
// --- Subtitle request/result types ---
export {
  type AddSubtitleTrackRequest,
  type AddSubtitleTrackResult,
  isSubtitleDryRun,
  type SubtitleDryRunResult,
} from "./types/subtitle.js";
export {
  type GenerateThumbnailRequest,
  type GenerateThumbnailResult,
  isThumbnailDryRun,
  type ThumbnailDryRunResult,
} from "./types/thumbnail.js";
export type {
  AlternateTrackRemovalMode,
  RemoveAlternateTrackRequest,
  RemoveAlternateTrackResult,
  RemoveAudioTrackRequest,
  RemoveSubtitleTrackRequest,
} from "./types/tracks.js";
export type { ValidationWarning, ValidationWarningCode } from "./types/warnings.js";
// --- Errors ---
export type { VhjsErrorCode } from "./validation/errors.js";
export {
  AlternateTrackNotFoundError,
  BitrateExceedsSourceError,
  ConflictingFfmpegArgError,
  FfmpegNotFoundError,
  FfprobeNotFoundError,
  InvalidFrameRateError,
  InvalidThumbnailTimestampError,
  NoAudioTrackError,
  NoSubtitleTrackError,
  PlaylistParseError,
  ProbeError,
  ResolutionUpscaleError,
  ThumbnailTimestampExceedsDurationError,
  TranscodeError,
  UnsafePlaylistUriError,
  UnsupportedCodecError,
  UnsupportedFfmpegPresetError,
  VhjsError,
  VideoDurationUnavailableError,
} from "./validation/errors.js";
// --- Validation ---
export {
  assertSupportedFfmpegPreset,
  assertValidFrameRate,
  checkAudioDurationMatch,
  clampBitrate,
  DEFAULT_AUDIO_DURATION_TOLERANCE_MS,
  DEFAULT_BITRATE_POLICY,
  validateRendition,
} from "./validation/rules.js";
