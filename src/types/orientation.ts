/**
 * Orientation geometry — pure helpers for reasoning about a video stream's
 * *displayed* size once its rotation metadata is applied.
 *
 * Why this exists: `ffprobe` reports the **stored** (coded) `width`/`height`,
 * but mobile cameras record in sensor orientation and tag a rotation (90°/270°
 * for portrait). ffmpeg's decoder auto-applies that rotation (`-autorotate`, on
 * by default), so the *encoded output* is display-oriented — yet ffprobe still
 * reports the pre-rotation stored size. The ABR ladder and the upscale check
 * must therefore reason about what the user will actually *see* (the display
 * dimensions), so they match the oriented output ffmpeg produces.
 *
 * Pure domain logic: no I/O, no ffmpeg vocabulary. The pixels are rotated by
 * ffmpeg itself, not by us — see the rotation note in `hls/command`.
 */
import type { Pixels } from "./brands.js";
import type { VideoStream } from "./metadata.js";

/** The oriented (displayed) dimensions of a video stream. */
export interface DisplayDimensions {
  readonly width: Pixels;
  readonly height: Pixels;
}

/**
 * Whether a rotation is an odd quarter-turn (90° or 270°), which swaps the
 * displayed width and height. `180` and `0` leave dimensions unchanged. Accepts
 * any integer degree value and normalizes it, so negative/over-360 inputs work.
 */
export function isQuarterTurned(rotationDegrees: number): boolean {
  return (((Math.round(rotationDegrees) % 360) + 360) % 360) % 180 === 90;
}

/**
 * The displayed dimensions of a video stream after applying its rotation: for a
 * 90°/270° rotation the stored width/height are swapped, otherwise returned
 * as-is.
 */
export function displayDimensions(
  video: Pick<VideoStream, "width" | "height" | "rotation">,
): DisplayDimensions {
  return isQuarterTurned(video.rotation)
    ? { width: video.height, height: video.width }
    : { width: video.width, height: video.height };
}
