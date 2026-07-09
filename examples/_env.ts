/**
 * Shared helpers for the example scripts.
 *
 * FFmpeg/ffprobe are resolved from PATH by default; if they are not on PATH (as
 * on this dev machine, where FFmpeg is installed under a winget package dir),
 * point the examples at the binaries via the `VHJS_FFMPEG_PATH` /
 * `VHJS_FFPROBE_PATH` environment variables:
 *
 *   VHJS_FFMPEG_PATH=/path/to/ffmpeg VHJS_FFPROBE_PATH=/path/to/ffprobe \
 *     pnpm example 03-abr-ladder
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { VhjsOptions } from "vhjs";

const here = dirname(fileURLToPath(import.meta.url));

/** Binary overrides from the environment (empty when relying on PATH). */
export function binaryOptions(): VhjsOptions {
  const { VHJS_FFMPEG_PATH, VHJS_FFPROBE_PATH } = process.env;
  return {
    ...(VHJS_FFMPEG_PATH ? { ffmpegPath: VHJS_FFMPEG_PATH } : {}),
    ...(VHJS_FFPROBE_PATH ? { ffprobePath: VHJS_FFPROBE_PATH } : {}),
  };
}

/** The bundled sample clip used by the examples. */
export function sampleInput(): string {
  return resolve(here, "assets", "1min.mp4");
}

/** A gitignored output directory for an example, under `examples/.out/<name>`. */
export function outputDir(name: string): string {
  return resolve(here, ".out", name);
}
