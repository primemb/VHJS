/**
 * Subtitle features (Phase 6): pure FFmpeg argument construction plus the use
 * case that segments WebVTT (or converts SRT on ingest) and patches a master.
 */
import { join } from "node:path";
import type { Clock, FfmpegRunner, FileSystem, Logger, ProbeService } from "../ports/index.js";
import type { ProgressEvent } from "../types/progress.js";
import type {
  AddSubtitleTrackRequest,
  AddSubtitleTrackResult,
  SubtitleDryRunResult,
} from "../types/subtitle.js";
import { NoSubtitleTrackError, ProbeError, TranscodeError } from "../validation/errors.js";
import { addAlternateSubtitle, parseMasterPlaylist, serializeMasterPlaylist } from "./playlist.js";

const DEFAULT_SEGMENT_DURATION_SEC = 6;
const DEFAULT_GROUP_ID = "subtitles";
const DEFAULT_MASTER_NAME = "master.m3u8";
const SUBTITLE_PLAYLIST_NAME = "subtitles.m3u8";

/** Normalize a path to forward slashes (FFmpeg accepts them cross-platform). */
function toPosix(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Filesystem-safe token for a rendition sub-directory name. */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/** Options for `buildSubtitleHlsCommand`. */
export interface SubtitleHlsBuildOptions {
  readonly input: string;
  readonly outputDir: string;
  readonly playlistName?: string;
  readonly trackIndex?: number;
  readonly segmentDuration?: number;
}

/**
 * Build an FFmpeg command that emits a VOD M3U8 list of WebVTT segments.
 * `-c:s webvtt` is deliberately used for every input: WebVTT is normalized and
 * SubRip/SRT is converted during ingest. The generic segment muxer produces the
 * subtitle media playlist because MPEG-TS cannot carry WebVTT segments.
 */
export function buildSubtitleHlsCommand(options: SubtitleHlsBuildOptions): {
  readonly args: readonly string[];
  readonly playlistPath: string;
} {
  const {
    input,
    playlistName = SUBTITLE_PLAYLIST_NAME,
    trackIndex = 0,
    segmentDuration = DEFAULT_SEGMENT_DURATION_SEC,
  } = options;
  const outputDir = toPosix(options.outputDir);
  const playlistPath = `${outputDir}/${playlistName}`;
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-map",
    `0:s:${trackIndex}`,
    "-c:s",
    "webvtt",
    "-f",
    "segment",
    "-segment_time",
    `${segmentDuration}`,
    "-segment_list",
    playlistPath,
    "-segment_list_type",
    "m3u8",
    "-segment_format",
    "webvtt",
    `${outputDir}/data%03d.vtt`,
  ];
  return { args, playlistPath };
}

/** Injected ports for the subtitle use case. */
export interface SubtitleToolsDeps {
  readonly probe: ProbeService;
  readonly ffmpeg: FfmpegRunner;
  readonly fs: FileSystem;
  readonly clock: Clock;
  readonly logger?: Logger;
}

/** Subtitle use cases bound to adapters at the composition root. */
export interface SubtitleTools {
  addSubtitleTrack(
    request: AddSubtitleTrackRequest,
  ): Promise<AddSubtitleTrackResult | SubtitleDryRunResult>;
}

function assertHasSubtitleTrack(count: number, input: string, trackIndex: number): void {
  if (count === 0) {
    throw new NoSubtitleTrackError(input);
  }
  if (trackIndex < 0 || trackIndex >= count) {
    throw new NoSubtitleTrackError(input, trackIndex);
  }
}

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

/** Create subtitle tools over injected ports; no adapter imports enter this layer. */
export function createSubtitleTools(deps: SubtitleToolsDeps): SubtitleTools {
  async function addSubtitleTrack(
    request: AddSubtitleTrackRequest,
  ): Promise<AddSubtitleTrackResult | SubtitleDryRunResult> {
    const masterName = request.masterPlaylistName ?? DEFAULT_MASTER_NAME;
    const masterPath = join(request.packageDir, masterName);
    if (!(await deps.fs.exists(masterPath))) {
      throw new ProbeError(`Master playlist not found: ${masterPath}`);
    }
    if (!(await deps.fs.exists(request.subtitleInput))) {
      throw new ProbeError(`Subtitle input not found: ${request.subtitleInput}`);
    }

    const master = parseMasterPlaylist(await deps.fs.readFile(masterPath));
    const metadata = await deps.probe.probe(request.subtitleInput, request.signal);
    const trackIndex = request.trackIndex ?? 0;
    assertHasSubtitleTrack(metadata.subtitle.length, request.subtitleInput, trackIndex);

    const groupId = request.groupId ?? DEFAULT_GROUP_ID;
    const forced = request.forced ?? false;
    const subtitleDirName = `subtitles_${slug(groupId)}_${slug(request.language)}`;
    const subtitleDir = `${toPosix(request.packageDir)}/${subtitleDirName}`;
    const renditionUri = `${subtitleDirName}/${SUBTITLE_PLAYLIST_NAME}`;
    const { args, playlistPath } = buildSubtitleHlsCommand({
      input: request.subtitleInput,
      outputDir: subtitleDir,
      trackIndex,
      ...(request.segmentDuration !== undefined
        ? { segmentDuration: request.segmentDuration }
        : {}),
    });

    if (request.dryRun) {
      return { dryRun: true, args, warnings: [] };
    }

    const startedAt = deps.clock.now();
    await deps.fs.mkdirp(subtitleDir);
    deps.logger?.info("Adding subtitle track", {
      packageDir: request.packageDir,
      language: request.language,
      groupId,
      forced,
    });
    const result = await deps.ffmpeg.run(runOptions(args, request.signal, request.onProgress));
    if (result.exitCode !== 0) {
      throw new TranscodeError(result.exitCode, result.stderrTail);
    }

    const patched = addAlternateSubtitle(master, {
      groupId,
      name: request.name,
      language: request.language,
      uri: renditionUri,
      isDefault: request.isDefault ?? false,
      autoselect: request.autoselect ?? true,
      forced,
    });
    await deps.fs.writeFile(masterPath, serializeMasterPlaylist(patched));

    return {
      masterPlaylistPath: masterPath,
      subtitlePlaylistPath: playlistPath,
      groupId,
      name: request.name,
      language: request.language,
      forced,
      elapsedMs: deps.clock.now() - startedAt,
      warnings: [],
    };
  }

  return { addSubtitleTrack };
}
