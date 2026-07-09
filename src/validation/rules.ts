/**
 * Validation rules — pure decisions over `SourceMetadata` + a requested
 * `Rendition`. This is the "probe → **validate** → run" gate: it never spawns
 * FFmpeg and never touches the filesystem, so every rule is trivially unit-
 * tested by feeding a mock `SourceMetadata`.
 *
 * Policy (CLAUDE.md, "locked defaults"):
 *  - **Upscale** (requested height > source) → hard `ResolutionUpscaleError`.
 *  - **Bitrate** → *clamp + warn* when a request is at/near the source; a hard
 *    `BitrateExceedsSourceError` only when it is *clearly* above source (above
 *    `source × hardExceedFactor`). When the source bitrate is unknown, the
 *    request passes through unchanged (nothing to measure against).
 *  - **Codec** → only the supported output codecs are accepted, else
 *    `UnsupportedCodecError`.
 *
 * Inner layer: imports `types/` + `validation/errors` only — never `core/`.
 */
import type { Bitrate } from "../types/brands.js";
import type { BitratePolicy } from "../types/config.js";
import type { SourceMetadata, VideoStream } from "../types/metadata.js";
import { displayDimensions } from "../types/orientation.js";
import {
  type Rendition,
  SUPPORTED_AUDIO_CODECS,
  SUPPORTED_VIDEO_CODECS,
} from "../types/rendition.js";
import type { ValidationWarning } from "../types/warnings.js";
import {
  BitrateExceedsSourceError,
  ResolutionUpscaleError,
  UnsupportedCodecError,
} from "./errors.js";

export type { BitratePolicy } from "../types/config.js";

/** Default policy: tolerate up to 1.5× the source before erroring. */
export const DEFAULT_BITRATE_POLICY: BitratePolicy = { hardExceedFactor: 1.5 };

/** The outcome of clamping one bitrate against a source reference. */
export interface ClampedBitrate {
  readonly value: Bitrate;
  /** Present only when the value was clamped down from the request. */
  readonly warning?: ValidationWarning;
}

/** The result of validating a single rendition: a (possibly clamped) rendition + warnings. */
export interface ValidatedRendition {
  readonly rendition: Rendition;
  readonly warnings: readonly ValidationWarning[];
}

/** The first video stream, which VHJS treats as the source to transcode. */
export function primaryVideoStream(source: SourceMetadata): VideoStream {
  const video = source.video[0];
  if (video === undefined) {
    // No video is a codec-shaped problem: there is nothing supported to encode.
    throw new UnsupportedCodecError("video", "none", [...SUPPORTED_VIDEO_CODECS]);
  }
  return video;
}

/**
 * Throw `ResolutionUpscaleError` if the rendition height is above the source's
 * *displayed* height. We compare against the display height (not the stored
 * `height`) so a rotated portrait source is measured against what the viewer
 * actually sees — see `displayDimensions`.
 */
export function assertNoUpscale(rendition: Rendition, source: SourceMetadata): void {
  const displayHeight = displayDimensions(primaryVideoStream(source)).height;
  if (rendition.height > displayHeight) {
    throw new ResolutionUpscaleError(rendition.height, displayHeight);
  }
}

/** Throw `UnsupportedCodecError` if either requested output codec is not supported. */
export function assertSupportedCodecs(rendition: Rendition): void {
  if (!SUPPORTED_VIDEO_CODECS.includes(rendition.videoCodec)) {
    throw new UnsupportedCodecError("video", rendition.videoCodec, [...SUPPORTED_VIDEO_CODECS]);
  }
  if (!SUPPORTED_AUDIO_CODECS.includes(rendition.audioCodec)) {
    throw new UnsupportedCodecError("audio", rendition.audioCodec, [...SUPPORTED_AUDIO_CODECS]);
  }
}

/**
 * Clamp one requested bitrate against a source reference per the policy. Returns
 * the request unchanged when the reference is unknown (`null`) or the request is
 * at/below source; clamps + warns for a mild overshoot; throws for a clear one.
 */
export function clampBitrate(
  kind: "video" | "audio",
  requested: Bitrate,
  reference: Bitrate | null,
  policy: BitratePolicy = DEFAULT_BITRATE_POLICY,
): ClampedBitrate {
  if (reference === null || requested <= reference) {
    return { value: requested };
  }
  if (requested > reference * policy.hardExceedFactor) {
    throw new BitrateExceedsSourceError(kind, requested, reference);
  }
  return {
    value: reference,
    warning: {
      code: "BITRATE_CLAMPED",
      message:
        `Requested ${kind} bitrate ${requested} bps is above the source ` +
        `${reference} bps; clamped down to the source bitrate.`,
    },
  };
}

/** Default tolerance for the audio/video duration check (2s). */
export const DEFAULT_AUDIO_DURATION_TOLERANCE_MS = 2_000;

/**
 * Compare an added audio track's duration to the video's. Returns an
 * `AUDIO_DURATION_MISMATCH` warning when they drift apart by more than
 * `toleranceMs`, or `null` when they agree or either duration is unknown
 * (`null` — nothing to measure). Pure: warns, never throws (CLAUDE.md Phase-5
 * "warn on mismatch").
 */
export function checkAudioDurationMatch(
  videoDurationMs: number | null,
  audioDurationMs: number | null,
  toleranceMs: number = DEFAULT_AUDIO_DURATION_TOLERANCE_MS,
): ValidationWarning | null {
  if (videoDurationMs === null || audioDurationMs === null) {
    return null;
  }
  const drift = Math.abs(videoDurationMs - audioDurationMs);
  if (drift <= toleranceMs) {
    return null;
  }
  return {
    code: "AUDIO_DURATION_MISMATCH",
    message:
      `Added audio duration ${Math.round(audioDurationMs)}ms differs from the video ` +
      `duration ${Math.round(videoDurationMs)}ms by ${Math.round(drift)}ms ` +
      `(tolerance ${toleranceMs}ms); the track may drift out of sync.`,
  };
}

/** The source reference bitrate for a track, falling back sensibly when unknown. */
function videoReference(source: SourceMetadata): Bitrate | null {
  return primaryVideoStream(source).bitrate ?? source.formatBitrate;
}

function audioReference(source: SourceMetadata): Bitrate | null {
  return source.audio[0]?.bitrate ?? null;
}

/**
 * Validate a single requested rendition against the source. Throws the matching
 * typed error for a hard violation (upscale / unsupported codec / bitrate far
 * above source); otherwise returns the rendition with any clamped bitrates
 * applied and the corresponding warnings.
 */
export function validateRendition(
  rendition: Rendition,
  source: SourceMetadata,
  policy: BitratePolicy = DEFAULT_BITRATE_POLICY,
): ValidatedRendition {
  assertSupportedCodecs(rendition);
  assertNoUpscale(rendition, source);

  const video = clampBitrate("video", rendition.videoBitrate, videoReference(source), policy);
  const audio = clampBitrate("audio", rendition.audioBitrate, audioReference(source), policy);

  const warnings: ValidationWarning[] = [];
  if (video.warning) {
    warnings.push(video.warning);
  }
  if (audio.warning) {
    warnings.push(audio.warning);
  }

  return {
    rendition: { ...rendition, videoBitrate: video.value, audioBitrate: audio.value },
    warnings,
  };
}
