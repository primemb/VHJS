/** Encoding choices supported by VHJS's libx264 HLS pipeline. */

/** libx264 encoding-speed presets, from fastest/largest to slowest/smallest. */
export const FFMPEG_PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
  "placebo",
] as const;

/** One of libx264's supported encoding-speed presets. */
export type FfmpegPreset = (typeof FFMPEG_PRESETS)[number];

/** Return whether a runtime value is a preset VHJS can pass to libx264. */
export function isFfmpegPreset(value: string): value is FfmpegPreset {
  return (FFMPEG_PRESETS as readonly string[]).includes(value);
}
