/**
 * Audio features (Phase 5): the pure command builders + the use cases that
 * orchestrate them over injected ports.
 *
 * Two capabilities:
 *  - **Extract / demux** one audio track from a video into a standalone file
 *    (`copy` verbatim, or re-encode to `aac`).
 *  - **Add an alternate-audio rendition** to an existing HLS package: segment the
 *    new audio into its own audio-only HLS media playlist and patch the master to
 *    reference it (`EXT-X-MEDIA:TYPE=AUDIO`), preserving existing renditions.
 *
 * Like `hls/command`, the arg-builders are pure *decisions* (no I/O); the use
 * cases do the I/O through **ports** (`ProbeService`, `FfmpegRunner`,
 * `FileSystem`, `Clock`). Inner layer: never imports `core/`.
 */
import { dirname, join } from "node:path";
import type { Clock, FfmpegRunner, FileSystem, Logger, ProbeService } from "../ports/index.js";
import type {
  AddAudioTrackRequest,
  AddAudioTrackResult,
  AudioDryRunResult,
  ExtractAudioRequest,
  ExtractAudioResult,
} from "../types/audio.js";
import type { ProgressEvent } from "../types/progress.js";
import type { ValidationWarning } from "../types/warnings.js";
import {
  ConflictingFfmpegArgError,
  NoAudioTrackError,
  ProbeError,
  TranscodeError,
} from "../validation/errors.js";
import { checkAudioDurationMatch } from "../validation/rules.js";
import {
  addAlternateAudio,
  parseMasterPlaylist,
  serializeMasterPlaylist,
  sumMediaPlaylistDurationMs,
  variantHasMuxedAudio,
} from "./playlist.js";

const AUDIO_ENCODER = "aac";
const DEFAULT_AUDIO_BITRATE = 128_000;
const DEFAULT_CHANNELS = 2;
const DEFAULT_SEGMENT_DURATION_SEC = 6;
const DEFAULT_GROUP_ID = "audio";
const DEFAULT_MASTER_NAME = "master.m3u8";
const AUDIO_PLAYLIST_NAME = "audio.m3u8";

/**
 * Flag "heads" the audio builders set themselves — a caller-supplied flag whose
 * head matches one of these (or targets the HLS muxer) is rejected as additive
 * custom args must not fight VHJS-managed flags.
 */
const RESERVED_HEADS: ReadonlySet<string> = new Set([
  "-i",
  "-hide_banner",
  "-nostdin",
  "-y",
  "-map",
  "-vn",
  "-c",
  "-b",
  "-ac",
  "-f",
  "-master_pl_name",
]);

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

/** Reject caller args colliding with the flags the audio builders manage. */
function assertNoReservedArgs(args: readonly string[]): void {
  const conflicts = args.filter(isReservedFlag);
  if (conflicts.length > 0) {
    throw new ConflictingFfmpegArgError(conflicts);
  }
}

/** Normalize a path to forward slashes (ffmpeg accepts them on every platform). */
function toPosix(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Filesystem-safe token for a rendition sub-directory name. */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/** Options for `buildAudioExtractCommand`. */
export interface AudioExtractBuildOptions {
  readonly input: string;
  readonly output: string;
  readonly mode: "copy" | "aac";
  readonly trackIndex?: number;
  readonly audioBitrate?: number;
  readonly channels?: number;
  readonly inputArgs?: readonly string[];
  readonly outputArgs?: readonly string[];
}

/**
 * Build the ffmpeg argv that extracts one audio track into a standalone file.
 * `-map 0:a:<track>` selects the Nth audio stream; `-vn` drops video. `copy`
 * keeps the source bitstream; `aac` re-encodes (with a stereo downmix default).
 */
export function buildAudioExtractCommand(options: AudioExtractBuildOptions): {
  readonly args: readonly string[];
} {
  const {
    input,
    output,
    mode,
    trackIndex = 0,
    audioBitrate = DEFAULT_AUDIO_BITRATE,
    channels = DEFAULT_CHANNELS,
    inputArgs = [],
    outputArgs = [],
  } = options;

  assertNoReservedArgs(inputArgs);
  assertNoReservedArgs(outputArgs);

  const codecArgs =
    mode === "copy"
      ? ["-c:a", "copy"]
      : ["-c:a", AUDIO_ENCODER, "-b:a", `${audioBitrate}`, "-ac", `${channels}`];

  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    ...inputArgs,
    "-i",
    input,
    "-map",
    `0:a:${trackIndex}`,
    "-vn",
    ...codecArgs,
    ...outputArgs,
    output,
  ];
  return { args };
}

/** Options for `buildAudioHlsCommand`. */
export interface AudioHlsBuildOptions {
  readonly input: string;
  /** Directory the audio playlist + segments are written into. */
  readonly outputDir: string;
  readonly playlistName?: string;
  readonly trackIndex?: number;
  readonly audioBitrate?: number;
  readonly channels?: number;
  readonly segmentDuration?: number;
  readonly inputArgs?: readonly string[];
  readonly outputArgs?: readonly string[];
}

/**
 * Build the ffmpeg argv that segments one audio track into an audio-only HLS
 * rendition (media playlist + `.ts` segments). Always re-encodes to AAC.
 */
export function buildAudioHlsCommand(options: AudioHlsBuildOptions): {
  readonly args: readonly string[];
  readonly playlistPath: string;
} {
  const {
    input,
    playlistName = AUDIO_PLAYLIST_NAME,
    trackIndex = 0,
    audioBitrate = DEFAULT_AUDIO_BITRATE,
    channels = DEFAULT_CHANNELS,
    segmentDuration = DEFAULT_SEGMENT_DURATION_SEC,
    inputArgs = [],
    outputArgs = [],
  } = options;

  assertNoReservedArgs(inputArgs);
  assertNoReservedArgs(outputArgs);

  const outputDir = toPosix(options.outputDir);
  const playlistPath = `${outputDir}/${playlistName}`;

  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    ...inputArgs,
    "-i",
    input,
    "-map",
    `0:a:${trackIndex}`,
    "-vn",
    "-c:a",
    AUDIO_ENCODER,
    "-b:a",
    `${audioBitrate}`,
    "-ac",
    `${channels}`,
    ...outputArgs,
    "-f",
    "hls",
    "-hls_time",
    `${segmentDuration}`,
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "mpegts",
    "-hls_segment_filename",
    `${outputDir}/data%03d.ts`,
    playlistPath,
  ];
  return { args, playlistPath };
}

/** Injected ports for the audio use cases (adapters wired at the composition root). */
export interface AudioToolsDeps {
  readonly probe: ProbeService;
  readonly ffmpeg: FfmpegRunner;
  readonly fs: FileSystem;
  readonly clock: Clock;
  readonly logger?: Logger;
}

/** The Phase-5 audio use cases. */
export interface AudioTools {
  /** Extract/demux one audio track from a video into a standalone file. */
  extractAudio(request: ExtractAudioRequest): Promise<ExtractAudioResult | AudioDryRunResult>;
  /** Add an alternate-audio rendition to an existing HLS package. */
  addAudioTrack(request: AddAudioTrackRequest): Promise<AddAudioTrackResult | AudioDryRunResult>;
}

/** Assert the source has an audio stream at `trackIndex`, else throw typed. */
function assertHasAudioTrack(audioCount: number, input: string, trackIndex: number): void {
  if (audioCount === 0) {
    throw new NoAudioTrackError(input);
  }
  if (trackIndex < 0 || trackIndex >= audioCount) {
    throw new NoAudioTrackError(input, trackIndex);
  }
}

/** Only pass `signal`/`onProgress` when present (exactOptionalPropertyTypes). */
function runOptions(
  args: readonly string[],
  signal: AbortSignal | undefined,
  onProgress: ((event: ProgressEvent) => void) | undefined,
): Parameters<FfmpegRunner["run"]>[0] {
  return {
    args: [...args],
    ...(signal ? { signal } : {}),
    ...(onProgress ? { onProgress } : {}),
  };
}

/** Create the audio use cases bound to a set of ports. */
export function createAudioTools(deps: AudioToolsDeps): AudioTools {
  async function extractAudio(
    request: ExtractAudioRequest,
  ): Promise<ExtractAudioResult | AudioDryRunResult> {
    if (!(await deps.fs.exists(request.input))) {
      throw new ProbeError(`Input file not found: ${request.input}`);
    }
    const source = await deps.probe.probe(request.input, request.signal);
    const trackIndex = request.trackIndex ?? 0;
    assertHasAudioTrack(source.audio.length, request.input, trackIndex);

    const { args } = buildAudioExtractCommand({
      input: request.input,
      output: request.output,
      mode: request.mode,
      trackIndex,
      ...(request.audioBitrate !== undefined ? { audioBitrate: request.audioBitrate } : {}),
      ...(request.channels !== undefined ? { channels: request.channels } : {}),
      ...(request.inputArgs ? { inputArgs: request.inputArgs } : {}),
      ...(request.outputArgs ? { outputArgs: request.outputArgs } : {}),
    });

    if (request.dryRun) {
      return { dryRun: true, args, warnings: [] };
    }

    await deps.fs.mkdirp(dirname(request.output));
    const startedAt = deps.clock.now();
    deps.logger?.info("Extracting audio", { input: request.input, mode: request.mode });
    const result = await deps.ffmpeg.run(runOptions(args, request.signal, request.onProgress));
    if (result.exitCode !== 0) {
      throw new TranscodeError(result.exitCode, result.stderrTail);
    }
    return {
      outputPath: request.output,
      mode: request.mode,
      elapsedMs: deps.clock.now() - startedAt,
      warnings: [],
    };
  }

  async function addAudioTrack(
    request: AddAudioTrackRequest,
  ): Promise<AddAudioTrackResult | AudioDryRunResult> {
    const masterName = request.masterPlaylistName ?? DEFAULT_MASTER_NAME;
    const masterPath = join(request.packageDir, masterName);
    if (!(await deps.fs.exists(masterPath))) {
      throw new ProbeError(`Master playlist not found: ${masterPath}`);
    }
    if (!(await deps.fs.exists(request.audioInput))) {
      throw new ProbeError(`Audio input not found: ${request.audioInput}`);
    }

    const master = parseMasterPlaylist(await deps.fs.readFile(masterPath));

    const audioMeta = await deps.probe.probe(request.audioInput, request.signal);
    const trackIndex = request.trackIndex ?? 0;
    assertHasAudioTrack(audioMeta.audio.length, request.audioInput, trackIndex);

    const groupId = request.groupId ?? DEFAULT_GROUP_ID;
    const channels = request.channels ?? DEFAULT_CHANNELS;
    const audioDirName = `audio_${slug(groupId)}_${slug(request.language)}`;
    const audioDir = `${toPosix(request.packageDir)}/${audioDirName}`;
    const renditionUri = `${audioDirName}/${AUDIO_PLAYLIST_NAME}`;

    const { args, playlistPath } = buildAudioHlsCommand({
      input: request.audioInput,
      outputDir: audioDir,
      trackIndex,
      channels,
      ...(request.audioBitrate !== undefined ? { audioBitrate: request.audioBitrate } : {}),
      ...(request.segmentDuration !== undefined
        ? { segmentDuration: request.segmentDuration }
        : {}),
    });

    if (request.dryRun) {
      return { dryRun: true, args, warnings: [] };
    }

    const startedAt = deps.clock.now();
    await deps.fs.mkdirp(audioDir);
    deps.logger?.info("Adding alternate audio track", {
      packageDir: request.packageDir,
      language: request.language,
      groupId,
    });
    const result = await deps.ffmpeg.run(runOptions(args, request.signal, request.onProgress));
    if (result.exitCode !== 0) {
      throw new TranscodeError(result.exitCode, result.stderrTail);
    }

    const warnings = await collectAddAudioWarnings(deps, request, master, audioMeta.durationMs);

    const patched = addAlternateAudio(master, {
      groupId,
      name: request.name,
      language: request.language,
      uri: renditionUri,
      isDefault: request.isDefault ?? false,
      autoselect: request.autoselect ?? true,
      channels,
    });
    await deps.fs.writeFile(masterPath, serializeMasterPlaylist(patched));

    for (const warning of warnings) {
      deps.logger?.warn(warning.message, { code: warning.code });
    }

    return {
      masterPlaylistPath: masterPath,
      audioPlaylistPath: playlistPath,
      groupId,
      name: request.name,
      language: request.language,
      elapsedMs: deps.clock.now() - startedAt,
      warnings,
    };
  }

  return { extractAudio, addAudioTrack };
}

/**
 * Duration-sync + muxed-audio advisories for `addAudioTrack`. Video duration is
 * summed from an existing variant's media playlist (`#EXTINF`) — no extra probe.
 */
async function collectAddAudioWarnings(
  deps: AudioToolsDeps,
  request: AddAudioTrackRequest,
  master: ReturnType<typeof parseMasterPlaylist>,
  audioDurationMs: number | null,
): Promise<ValidationWarning[]> {
  const warnings: ValidationWarning[] = [];

  const videoDurationMs = await firstVariantDurationMs(deps.fs, request.packageDir, master);
  const durationWarning = checkAudioDurationMatch(
    videoDurationMs,
    audioDurationMs,
    request.durationToleranceMs,
  );
  if (durationWarning) {
    warnings.push(durationWarning);
  }

  if (master.variants.some(variantHasMuxedAudio)) {
    warnings.push({
      code: "MUXED_AUDIO_PRESENT",
      message:
        "The package's variants carry muxed audio; the added alternate-audio group is " +
        "spec-legal but some players may prefer the muxed track. For a clean alternate-audio " +
        "setup, generate the base package with video-only variants.",
    });
  }
  return warnings;
}

/** Sum the first variant's media-playlist `#EXTINF` durations, or `null` if unreadable. */
async function firstVariantDurationMs(
  fs: FileSystem,
  packageDir: string,
  master: ReturnType<typeof parseMasterPlaylist>,
): Promise<number | null> {
  const uri = master.variants[0]?.uri;
  if (uri === undefined) {
    return null;
  }
  const mediaPath = join(packageDir, uri);
  if (!(await fs.exists(mediaPath))) {
    return null;
  }
  const total = sumMediaPlaylistDurationMs(await fs.readFile(mediaPath));
  return total > 0 ? total : null;
}
