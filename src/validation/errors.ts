/**
 * Typed error hierarchy (CLAUDE.md "fail fast, fail typed").
 *
 * Every error VHJS throws is a `VhjsError` subclass carrying a discriminant
 * `code`, so callers can `switch (err.code)` for exhaustive handling instead of
 * string-matching messages. The binary/probe errors serve the Phase 1 adapters;
 * the validation-rule errors (`ResolutionUpscaleError`, `BitrateExceedsSourceError`,
 * `UnsupportedCodecError`) and the run/parse errors (`TranscodeError`,
 * `PlaylistParseError`) complete the contract from CLAUDE.md.
 *
 * NOTE: `validation/` is an inner layer — it must never import from `core/`.
 */

/** Discriminant union of every error `code` in the public contract. */
export type VhjsErrorCode =
  | "FFMPEG_NOT_FOUND"
  | "FFPROBE_NOT_FOUND"
  | "PROBE_FAILED"
  | "RESOLUTION_UPSCALE"
  | "BITRATE_EXCEEDS_SOURCE"
  | "UNSUPPORTED_CODEC"
  | "TRANSCODE_FAILED"
  | "PLAYLIST_PARSE"
  | "CONFLICTING_FFMPEG_ARG"
  | "NO_AUDIO_TRACK"
  | "NO_SUBTITLE_TRACK"
  | "INVALID_FRAME_RATE"
  | "UNSUPPORTED_FFMPEG_PRESET"
  | "THUMBNAIL_TIMESTAMP_EXCEEDS_DURATION"
  | "VIDEO_DURATION_UNAVAILABLE"
  | "ALTERNATE_TRACK_NOT_FOUND"
  | "UNSAFE_PLAYLIST_URI"
  | "INVALID_THUMBNAIL_TIMESTAMP"
  | "INVALID_WATERMARK_OPTIONS"
  | "WATERMARK_FILE_NOT_FOUND"
  | "WATERMARK_FONT_FILE_NOT_FOUND";

/** Base class for all VHJS errors. Subclasses set a literal `code`. */
export abstract class VhjsError extends Error {
  /** Machine-readable discriminant for `switch`-based handling. */
  abstract readonly code: VhjsErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // `new.target` resolves to the concrete subclass, so `err.name` is accurate.
    this.name = new.target.name;
  }
}

/** ffmpeg binary was not found or is not runnable. */
export class FfmpegNotFoundError extends VhjsError {
  readonly code = "FFMPEG_NOT_FOUND" as const;

  constructor(
    /** The command/path that was tried. */
    readonly searchedPath: string,
    options?: ErrorOptions,
  ) {
    super(
      `ffmpeg was not found or is not runnable (tried "${searchedPath}"). ` +
        "Install FFmpeg and ensure it is on PATH, or pass an explicit binary path override.",
      options,
    );
  }
}

/** ffprobe binary was not found or is not runnable. */
export class FfprobeNotFoundError extends VhjsError {
  readonly code = "FFPROBE_NOT_FOUND" as const;

  constructor(
    /** The command/path that was tried. */
    readonly searchedPath: string,
    options?: ErrorOptions,
  ) {
    super(
      `ffprobe was not found or is not runnable (tried "${searchedPath}"). ` +
        "Install FFmpeg (ffprobe ships with it) and ensure it is on PATH, or pass an explicit path override.",
      options,
    );
  }
}

/**
 * ffprobe failed to run or returned data VHJS could not parse. Inherits the
 * base `(message, options)` constructor — only the discriminant differs.
 */
export class ProbeError extends VhjsError {
  readonly code = "PROBE_FAILED" as const;
}

/**
 * A requested rendition asks for a height greater than the source — VHJS never
 * upscales. Thrown by the validation layer before FFmpeg runs.
 */
export class ResolutionUpscaleError extends VhjsError {
  readonly code = "RESOLUTION_UPSCALE" as const;

  constructor(
    /** Requested output height, in pixels. */
    readonly requestedHeight: number,
    /** Source video height, in pixels. */
    readonly sourceHeight: number,
    options?: ErrorOptions,
  ) {
    super(
      `Requested rendition height ${requestedHeight}px exceeds the source height ` +
        `${sourceHeight}px. VHJS does not upscale — request a height at or below the source.`,
      options,
    );
  }
}

/**
 * A requested bitrate is *clearly* above the source's (per the clamp-and-warn
 * policy, only a large overshoot is a hard error; a mild one is clamped + warned).
 */
export class BitrateExceedsSourceError extends VhjsError {
  readonly code = "BITRATE_EXCEEDS_SOURCE" as const;

  constructor(
    /** Which track the bitrate applies to. */
    readonly kind: "video" | "audio",
    /** Requested bitrate, in bits per second. */
    readonly requested: number,
    /** Source bitrate the request is measured against, in bits per second. */
    readonly source: number,
    options?: ErrorOptions,
  ) {
    super(
      `Requested ${kind} bitrate ${requested} bps is far above the source ${kind} ` +
        `bitrate ${source} bps. Re-encoding above the source only inflates size without ` +
        "adding quality; lower the requested bitrate to at or below the source.",
      options,
    );
  }
}

/** A requested or source codec VHJS does not handle (MVP outputs H.264 + AAC). */
export class UnsupportedCodecError extends VhjsError {
  readonly code = "UNSUPPORTED_CODEC" as const;

  constructor(
    /** Which track the codec applies to. */
    readonly kind: "video" | "audio",
    /** The offending codec name. */
    readonly codec: string,
    /** The codecs VHJS currently supports for this track. */
    readonly supported: readonly string[],
    options?: ErrorOptions,
  ) {
    super(
      `Unsupported ${kind} codec "${codec}". VHJS currently handles: ` + `${supported.join(", ")}.`,
      options,
    );
  }
}

/**
 * ffmpeg exited non-zero. Wraps the exit code and a tail of stderr so callers
 * get a typed failure instead of a raw stderr blob (CLAUDE.md: fail typed).
 */
export class TranscodeError extends VhjsError {
  readonly code = "TRANSCODE_FAILED" as const;

  constructor(
    /** ffmpeg's process exit code, or `null` if it was killed by a signal. */
    readonly exitCode: number | null,
    /** The retained tail of ffmpeg's stderr, for diagnostics. */
    readonly stderrTail: string,
    options?: ErrorOptions,
  ) {
    super(`ffmpeg exited with code ${exitCode ?? "null"}. Last output:\n${stderrTail}`, options);
  }
}

/**
 * A `.m3u8` playlist could not be parsed when patching an existing HLS package.
 * Inherits the base `(message, options)` constructor.
 */
export class PlaylistParseError extends VhjsError {
  readonly code = "PLAYLIST_PARSE" as const;
}

/**
 * An audio operation was asked to work on a source (or a specific track index)
 * that has no audio stream — e.g. extracting audio from a video-only file, or
 * adding an audio track whose input carries no audio. Thrown before FFmpeg runs.
 */
export class NoAudioTrackError extends VhjsError {
  readonly code = "NO_AUDIO_TRACK" as const;

  constructor(
    /** The input that was expected to carry an audio track. */
    readonly input: string,
    /** The requested audio track index, when a specific one was asked for. */
    readonly trackIndex?: number,
    options?: ErrorOptions,
  ) {
    super(
      trackIndex === undefined
        ? `No audio stream found in "${input}". This operation requires an input with audio.`
        : `Audio track index ${trackIndex} does not exist in "${input}".`,
      options,
    );
  }
}

/** A subtitle input has no usable subtitle stream at the requested index. */
export class NoSubtitleTrackError extends VhjsError {
  readonly code = "NO_SUBTITLE_TRACK" as const;

  constructor(
    readonly input: string,
    readonly trackIndex?: number,
    options?: ErrorOptions,
  ) {
    super(
      trackIndex === undefined
        ? `No subtitle stream found in "${input}". This operation requires a subtitle input.`
        : `Subtitle track index ${trackIndex} does not exist in "${input}".`,
      options,
    );
  }
}

/**
 * Caller-supplied custom ffmpeg args collided with flags VHJS manages itself
 * (mapping, codecs, rate control, the HLS muxer, …). Passing these verbatim
 * would produce a duplicate/conflicting command, so it is rejected up front.
 */
export class ConflictingFfmpegArgError extends VhjsError {
  readonly code = "CONFLICTING_FFMPEG_ARG" as const;

  constructor(
    /** The offending flags the caller passed. */
    readonly conflicts: readonly string[],
    options?: ErrorOptions,
  ) {
    super(
      `Custom ffmpeg arg(s) ${conflicts.map((c) => `"${c}"`).join(", ")} conflict with flags ` +
        "VHJS sets itself (stream mapping, codecs, rate control, or the HLS muxer). " +
        "Remove them — VHJS owns those; pass only additive options (e.g. -tune, -crf, -pix_fmt, -hwaccel).",
      options,
    );
  }
}

/** A requested output frame rate is not a positive, finite number. */
export class InvalidFrameRateError extends VhjsError {
  readonly code = "INVALID_FRAME_RATE" as const;

  constructor(
    readonly frameRate: number,
    options?: ErrorOptions,
  ) {
    super(`Frame rate must be a positive finite number, got ${frameRate}.`, options);
  }
}

/** A caller selected an encoder preset that VHJS does not support. */
export class UnsupportedFfmpegPresetError extends VhjsError {
  readonly code = "UNSUPPORTED_FFMPEG_PRESET" as const;

  constructor(
    readonly preset: string,
    readonly supported: readonly string[],
    options?: ErrorOptions,
  ) {
    super(
      `Unsupported FFmpeg preset "${preset}". Supported presets: ${supported.join(", ")}.`,
      options,
    );
  }
}

/** A thumbnail timestamp falls after the end of a video. */
export class ThumbnailTimestampExceedsDurationError extends VhjsError {
  readonly code = "THUMBNAIL_TIMESTAMP_EXCEEDS_DURATION" as const;

  constructor(
    readonly timestampMs: number,
    readonly durationMs: number,
    options?: ErrorOptions,
  ) {
    super(
      `Thumbnail timestamp ${timestampMs}ms exceeds the video duration ${durationMs}ms.`,
      options,
    );
  }
}

/** A thumbnail timestamp is not a non-negative, finite number of seconds. */
export class InvalidThumbnailTimestampError extends VhjsError {
  readonly code = "INVALID_THUMBNAIL_TIMESTAMP" as const;

  constructor(
    readonly timestampSeconds: number,
    options?: ErrorOptions,
  ) {
    super(
      `Thumbnail timestamp must be a non-negative finite number of seconds, got ${timestampSeconds}.`,
      options,
    );
  }
}

/** A feature requiring source duration cannot validate an input with no duration metadata. */
export class VideoDurationUnavailableError extends VhjsError {
  readonly code = "VIDEO_DURATION_UNAVAILABLE" as const;

  constructor(
    readonly input: string,
    options?: ErrorOptions,
  ) {
    super(
      `Video duration is unavailable for "${input}", so VHJS cannot validate the request.`,
      options,
    );
  }
}

/** The selected alternate audio or subtitle rendition does not exist in the master playlist. */
export class AlternateTrackNotFoundError extends VhjsError {
  readonly code = "ALTERNATE_TRACK_NOT_FOUND" as const;

  constructor(
    readonly kind: "AUDIO" | "SUBTITLES",
    readonly groupId: string,
    readonly trackName: string,
    options?: ErrorOptions,
  ) {
    super(
      `No ${kind.toLowerCase()} track named "${trackName}" exists in group "${groupId}".`,
      options,
    );
  }
}

/** A playlist URI would escape its HLS package directory if used for hard deletion. */
export class UnsafePlaylistUriError extends VhjsError {
  readonly code = "UNSAFE_PLAYLIST_URI" as const;

  constructor(
    readonly uri: string,
    options?: ErrorOptions,
  ) {
    super(`Playlist URI "${uri}" is not a safe relative path within the HLS package.`, options);
  }
}

/** A watermark request contains an invalid image path, size, placement, or motion value. */
export class InvalidWatermarkOptionsError extends VhjsError {
  readonly code = "INVALID_WATERMARK_OPTIONS" as const;

  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid watermark options: ${reason}.`, options);
  }
}

/** The configured watermark image is not readable at the supplied path. */
export class WatermarkFileNotFoundError extends VhjsError {
  readonly code = "WATERMARK_FILE_NOT_FOUND" as const;

  constructor(
    readonly input: string,
    options?: ErrorOptions,
  ) {
    super(`Watermark image not found: "${input}".`, options);
  }
}

/** A configured text-watermark font file is not readable at the supplied path. */
export class WatermarkFontFileNotFoundError extends VhjsError {
  readonly code = "WATERMARK_FONT_FILE_NOT_FOUND" as const;

  constructor(
    readonly input: string,
    options?: ErrorOptions,
  ) {
    super(`Watermark font file not found: "${input}".`, options);
  }
}
