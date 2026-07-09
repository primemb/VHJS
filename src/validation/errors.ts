/**
 * Typed error hierarchy (CLAUDE.md "fail fast, fail typed").
 *
 * Every error VHJS throws is a `VhjsError` subclass carrying a discriminant
 * `code`, so callers can `switch (err.code)` for exhaustive handling instead of
 * string-matching messages. This file starts with the errors the Phase 1
 * adapters need (binary resolution + probing); the validation-rule errors
 * (`ResolutionUpscaleError`, `BitrateExceedsSourceError`, …) land in Phase 2.
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
  | "PLAYLIST_PARSE";

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
