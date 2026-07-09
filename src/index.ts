/**
 * VHJS — public API surface (single entry, re-exports only).
 *
 * The transcode/probe use cases and the fluent builder land across Phases 3–4
 * (see TODO.md). This barrel currently exposes the stable foundation that is
 * already part of the public contract: the typed error hierarchy, the source
 * metadata / progress types, and the branded scalar types + constructors.
 */
export const VHJS_VERSION = "0.1.0";

export type { Bitrate, Brand, FrameRate, Milliseconds, Pixels } from "./types/brands.js";
export { asBitrate, asFrameRate, asMilliseconds, asPixels } from "./types/brands.js";

export type {
  AudioStream,
  SourceMetadata,
  SubtitleStream,
  VideoStream,
} from "./types/metadata.js";
export type { ProgressEvent } from "./types/progress.js";
export type { VhjsErrorCode } from "./validation/errors.js";
export {
  FfmpegNotFoundError,
  FfprobeNotFoundError,
  ProbeError,
  VhjsError,
} from "./validation/errors.js";
