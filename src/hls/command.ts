/**
 * HLS command builder — the pure "decision" half of transcoding.
 *
 * Given a normalized ladder + output location, this produces the exact ffmpeg
 * argv (and the output paths that argv will create). It is deterministic domain
 * logic: no filesystem, no spawning. That is why it lives in `hls/` (a domain/
 * use-case layer) rather than in `core/` — per CLAUDE.md, "the decision goes in
 * the domain (pure, tested); the I/O goes in an adapter." The adapter that
 * *runs* this argv is `core/ffmpeg` (the `FfmpegRunner` port); `dryRun` surfaces
 * the argv without running anything.
 *
 * ## The HLS command
 *
 *   ffmpeg -i in.mp4
 *     -filter_complex "[0:v]split=N[v0][v1]…;[v0]scale=-2:1080[vout0];…"
 *     -map [vout0] -map [vout1] …            # one video output per rung
 *     -map 0:a:0   -map 0:a:0   …            # source audio, once per rung
 *     -c:v:0 libx264 -b:v:0 … -maxrate:v:0 … -bufsize:v:0 …   (per video stream)
 *     -c:a:0 aac     -b:a:0 …                                 (per audio stream)
 *     -f hls -hls_time 6 -hls_playlist_type vod -hls_flags independent_segments
 *     -hls_segment_filename out/stream_%v/data%03d.ts
 *     -master_pl_name master.m3u8
 *     -var_stream_map "v:0,a:0,name:1080p v:1,a:1,name:720p …"
 *     out/stream_%v/stream.m3u8
 *
 * `scale=-2:<h>` scales to the target height while preserving aspect ratio and
 * forcing an even width (H.264 requires even dimensions). `%v` expands to each
 * rung's `name`, so segments/playlists land in `stream_<name>/` sub-directories
 * (the caller must create them — see `hls/transcoder`).
 *
 * Inner layer: imports `types/` only, never `core/`.
 */

import { DEFAULT_HLS_JOB_OPTIONS } from "../types/config.js";
import type { FfmpegPreset } from "../types/encoding.js";
import { type Rendition, renditionName } from "../types/rendition.js";
import { ConflictingFfmpegArgError } from "../validation/errors.js";
import { assertSupportedFfmpegPreset, assertValidFrameRate } from "../validation/rules.js";

/** HLS build defaults (overridable per job). */
export const DEFAULT_SEGMENT_DURATION_SEC = DEFAULT_HLS_JOB_OPTIONS.segmentDuration;
export const DEFAULT_MASTER_PLAYLIST_NAME = DEFAULT_HLS_JOB_OPTIONS.masterPlaylistName;
export const DEFAULT_PRESET = DEFAULT_HLS_JOB_OPTIONS.preset;

/** Encoder names for the supported output codecs. */
const VIDEO_ENCODER = "libx264";
const AUDIO_ENCODER = "aac";

/** Options for building an HLS ffmpeg command. */
export interface HlsBuildOptions {
  readonly input: string;
  readonly outputDir: string;
  readonly renditions: readonly Rendition[];
  /** Target segment length in seconds (default 6). */
  readonly segmentDuration?: number;
  /** Master playlist filename (default `master.m3u8`). */
  readonly masterPlaylistName?: string;
  /** libx264 preset (default `veryfast`). */
  readonly preset?: FfmpegPreset;
  /** Target constant frame rate. Adds FFmpeg's `fps` filter when set. */
  readonly frameRate?: number;
  /** When set, forces the keyframe interval (frames) for clean segment splits. */
  readonly gopSize?: number;
  /**
   * Whether the source has an audio track to map into each variant (default
   * `true`). When `false`, video-only variants are produced and the audio maps /
   * codec args / `var_stream_map` audio references are omitted (mapping a
   * non-existent `0:a:0` makes ffmpeg fail).
   */
  readonly includeAudio?: boolean;
  /**
   * Extra ffmpeg args inserted **before `-i`** (global/input options, e.g.
   * `["-hwaccel", "cuda"]`). Additive only — a flag VHJS already manages throws
   * `ConflictingFfmpegArgError`.
   */
  readonly inputArgs?: readonly string[];
  /**
   * Extra ffmpeg args inserted **before the HLS muxer** (per-output options,
   * e.g. `["-tune", "film", "-crf", "20"]`). Additive only — a flag VHJS already
   * manages (mapping, codecs, rate control, `-preset`, gop, the HLS muxer)
   * throws `ConflictingFfmpegArgError`.
   */
  readonly outputArgs?: readonly string[];
}

/**
 * Flag "heads" VHJS sets itself. A caller-supplied flag conflicts when its head
 * (the part before any `:` stream-specifier, e.g. `-c` for `-c:v:0`) is one of
 * these, or when it targets the HLS muxer (`-hls*`).
 */
const RESERVED_HEADS: ReadonlySet<string> = new Set([
  // input / global
  "-i",
  "-hide_banner",
  "-nostdin",
  "-y",
  // stream mapping + filtergraph
  "-map",
  "-filter_complex",
  // codec + rate-control families (colon-specified variants share the head)
  "-c",
  "-b",
  "-maxrate",
  "-bufsize",
  "-ac",
  // encode tuning VHJS sets
  "-preset",
  "-g",
  "-keyint_min",
  "-sc_threshold",
  // muxer + output
  "-f",
  "-master_pl_name",
  "-var_stream_map",
]);

/** Whether a single token is a flag VHJS manages (and must not be overridden). */
function isReservedFlag(token: string): boolean {
  if (!token.startsWith("-")) {
    return false;
  }
  if (token.startsWith("-hls")) {
    return true;
  }
  const head = token.split(":")[0] ?? token;
  return RESERVED_HEADS.has(head);
}

/**
 * Reject caller args that collide with VHJS-managed flags. Only tokens that look
 * like flags (`-…`) are inspected; their values pass through untouched.
 */
function assertNoReservedArgs(args: readonly string[]): void {
  const conflicts = args.filter(isReservedFlag);
  if (conflicts.length > 0) {
    throw new ConflictingFfmpegArgError(conflicts);
  }
}

/** Where a single variant's output will be written. */
export interface HlsVariant {
  readonly rendition: Rendition;
  readonly name: string;
  /** The `stream_<name>` sub-directory this variant writes into. */
  readonly dir: string;
  /** This variant's media playlist path. */
  readonly playlistPath: string;
}

/** A built HLS command: the argv plus the paths it will produce. */
export interface HlsCommand {
  readonly args: readonly string[];
  readonly masterPlaylistPath: string;
  readonly variants: readonly HlsVariant[];
}

/** Normalize a path to forward slashes (ffmpeg accepts them on every platform). */
function toPosix(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Build the `-filter_complex` graph that splits the source and scales each rung.
 *
 * Rotation note: we do **not** add an explicit `transpose`. Modern ffmpeg
 * (verified on 8.1.2) applies the source's display-matrix rotation at decode
 * time by default (`-autorotate`, on), so `[0:v]` is already display-oriented
 * even inside a complex filtergraph — a portrait phone clip enters this graph
 * portrait. Because ffprobe reports the *stored* dimensions (pre-rotation), the
 * rung heights fed here must be the *displayed* heights (see `hls/ladder`); we
 * then just `scale=-2:<h>` to each — `-2` keeps aspect and forces an even width
 * (H.264 requires even dimensions). Adding our own transpose would double-rotate
 * and ship sideways video.
 */
function buildFilterGraph(renditions: readonly Rendition[], frameRate: number | undefined): string {
  const labels = renditions.map((_, i) => `[v${i}]`).join("");
  const split = `[0:v]split=${renditions.length}${labels}`;
  const fps = frameRate === undefined ? "" : `fps=${frameRate},`;
  const scales = renditions.map((r, i) => `[v${i}]${fps}scale=-2:${r.height}[vout${i}]`);
  return [split, ...scales].join(";");
}

/**
 * Build the full HLS ffmpeg command and the output paths it will create. Pure:
 * no filesystem access, no spawning — the returned `args` are exactly what is
 * handed to the `FfmpegRunner` (and what `dryRun` surfaces).
 */
export function buildHlsCommand(options: HlsBuildOptions): HlsCommand {
  const {
    input,
    renditions,
    segmentDuration = DEFAULT_SEGMENT_DURATION_SEC,
    masterPlaylistName = DEFAULT_MASTER_PLAYLIST_NAME,
    preset = DEFAULT_PRESET,
    frameRate,
    gopSize,
    includeAudio = true,
    inputArgs = [],
    outputArgs = [],
  } = options;

  if (renditions.length === 0) {
    throw new RangeError("buildHlsCommand requires at least one rendition");
  }
  assertSupportedFfmpegPreset(preset);
  if (frameRate !== undefined) {
    assertValidFrameRate(frameRate);
  }

  // Custom args are additive only — they must not fight the flags VHJS owns.
  assertNoReservedArgs(inputArgs);
  assertNoReservedArgs(outputArgs);

  const outputDir = toPosix(options.outputDir);
  const variants: HlsVariant[] = renditions.map((rendition) => {
    const name = renditionName(rendition);
    const dir = `${outputDir}/stream_${name}`;
    return { rendition, name, dir, playlistPath: `${dir}/stream.m3u8` };
  });

  const videoMaps = renditions.flatMap((_, i) => ["-map", `[vout${i}]`]);
  const audioMaps = includeAudio ? renditions.flatMap(() => ["-map", "0:a:0"]) : [];

  const videoCodecArgs = renditions.flatMap((r, i) => [
    `-c:v:${i}`,
    VIDEO_ENCODER,
    `-b:v:${i}`,
    `${r.videoBitrate}`,
    `-maxrate:v:${i}`,
    `${Math.round(r.videoBitrate * 1.07)}`,
    `-bufsize:v:${i}`,
    `${Math.round(r.videoBitrate * 1.5)}`,
  ]);
  const audioCodecArgs = includeAudio
    ? renditions.flatMap((r, i) => [`-c:a:${i}`, AUDIO_ENCODER, `-b:a:${i}`, `${r.audioBitrate}`])
    : [];
  const audioChannelArgs = includeAudio ? ["-ac", "2"] : [];

  const gopArgs =
    gopSize === undefined
      ? []
      : ["-g", `${gopSize}`, "-keyint_min", `${gopSize}`, "-sc_threshold", "0"];

  // With no audio, `var_stream_map` must reference video only, or ffmpeg errors
  // trying to bind a non-existent audio stream.
  const varStreamMap = variants
    .map((v, i) => (includeAudio ? `v:${i},a:${i},name:${v.name}` : `v:${i},name:${v.name}`))
    .join(" ");

  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    ...inputArgs,
    "-i",
    input,
    "-filter_complex",
    buildFilterGraph(renditions, frameRate),
    ...videoMaps,
    ...audioMaps,
    ...videoCodecArgs,
    ...audioCodecArgs,
    "-preset",
    preset,
    ...gopArgs,
    ...audioChannelArgs,
    ...outputArgs,
    "-f",
    "hls",
    "-hls_time",
    `${segmentDuration}`,
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_type",
    "mpegts",
    "-hls_segment_filename",
    `${outputDir}/stream_%v/data%03d.ts`,
    "-master_pl_name",
    masterPlaylistName,
    "-var_stream_map",
    varStreamMap,
    `${outputDir}/stream_%v/stream.m3u8`,
  ];

  return { args, masterPlaylistPath: `${outputDir}/${masterPlaylistName}`, variants };
}
