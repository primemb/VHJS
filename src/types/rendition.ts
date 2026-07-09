/**
 * Rendition & result types — the output side of the domain.
 *
 * A `Rendition` is one rung of the ABR ladder the caller asks for; the
 * validation layer clamps/rejects it against `SourceMetadata`, the ladder
 * normalizes a set of them, and `core/ffmpeg` turns them into an argv. Codecs
 * are literal unions (not free strings) so an unsupported request cannot even be
 * constructed at the type level — MVP outputs H.264 video + AAC audio.
 *
 * Pure domain types (innermost layer): no I/O, no framework, no `core/`.
 */
import type { Bitrate, Pixels } from "./brands.js";
import type { ValidationWarning } from "./warnings.js";

/** Output video codecs VHJS can emit (MVP: H.264 only). */
export type VideoCodec = "h264";

/** Output audio codecs VHJS can emit (MVP: AAC only). */
export type AudioCodec = "aac";

/** The codecs VHJS currently supports, exposed for validation messages. */
export const SUPPORTED_VIDEO_CODECS: readonly VideoCodec[] = ["h264"];
export const SUPPORTED_AUDIO_CODECS: readonly AudioCodec[] = ["aac"];

/** One rung of the requested ABR ladder. */
export interface Rendition {
  /** Output height in pixels; width is derived to preserve aspect ratio. */
  readonly height: Pixels;
  /** Target video bitrate (bits/sec). */
  readonly videoBitrate: Bitrate;
  /** Target audio bitrate (bits/sec). */
  readonly audioBitrate: Bitrate;
  /** Output video codec (defaults applied by the builder if omitted upstream). */
  readonly videoCodec: VideoCodec;
  /** Output audio codec. */
  readonly audioCodec: AudioCodec;
}

/**
 * The stable, human/URL-friendly name for a rendition, e.g. `"720p"`. Used as
 * the HLS variant stream name (`%v`) and its segment sub-directory, so the same
 * derivation must be used by the arg-builder and the directory-creating caller.
 */
export function renditionName(rendition: Rendition): string {
  return `${rendition.height}p`;
}

/** Where a single rendition's HLS output landed on disk. */
export interface RenditionOutput {
  readonly rendition: Rendition;
  /** Variant name (e.g. `"720p"`). */
  readonly name: string;
  /** Path to this rendition's media playlist. */
  readonly playlistPath: string;
}

/** The result of a completed HLS transcode job. */
export interface TranscodeResult {
  /** Path to the master `.m3u8`. */
  readonly masterPlaylistPath: string;
  /** One entry per rendition actually produced. */
  readonly renditions: readonly RenditionOutput[];
  /** Wall-clock duration of the job, in milliseconds. */
  readonly elapsedMs: number;
  /** Non-fatal advisories accumulated during validation/normalization. */
  readonly warnings: readonly ValidationWarning[];
}
