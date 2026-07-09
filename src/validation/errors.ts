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
  | "NO_AUDIO_TRACK";

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
