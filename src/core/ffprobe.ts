/**
 * ffprobe adapter — implements the `ProbeService` port.
 *
 * Two clearly separated concerns (decide-from-do):
 *  - `parseProbeOutput` is a **pure** function: raw ffprobe JSON → typed
 *    `SourceMetadata`. It spawns nothing and is exhaustively unit-tested with
 *    recorded fixtures.
 *  - `createFfprobeService` is the **I/O** side: it runs ffprobe via the
 *    injected `ProcessRunner`, then hands the JSON to the pure parser.
 *
 * ffprobe is invoked as:
 *   ffprobe -v error -print_format json -show_format -show_streams <input>
 */
import type { ProbeService } from "../ports/index.js";
import {
  asBitrate,
  asFrameRate,
  asMilliseconds,
  asPixels,
  type Bitrate,
  type FrameRate,
  type Milliseconds,
} from "../types/brands.js";
import type {
  AudioStream,
  SourceMetadata,
  SubtitleStream,
  VideoStream,
} from "../types/metadata.js";
import { ProbeError } from "../validation/errors.js";
import type { ProcessRunner } from "./process.js";

/** Build the ffprobe argv for a JSON stream+format probe of `input`. */
export function buildFfprobeArgs(input: string): string[] {
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input];
}

// ---- raw ffprobe JSON shapes (loosely typed; validated while parsing) -------

interface RawStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  bit_rate?: string;
  r_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
  tags?: Record<string, string>;
}

interface RawProbe {
  streams?: RawStream[];
  format?: { duration?: string; bit_rate?: string };
}

// ---- pure conversions -------------------------------------------------------

function toBitrate(value: string | undefined): Bitrate | null {
  const n = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(n) && n > 0 ? asBitrate(n) : null;
}

function toFrameRate(value: string | undefined): FrameRate | null {
  if (value === undefined) {
    return null;
  }
  const [numText, denText] = value.split("/");
  const num = Number(numText);
  const den = denText === undefined ? 1 : Number(denText);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0 || num <= 0) {
    return null;
  }
  return asFrameRate(num / den);
}

function toDurationMs(value: string | undefined): Milliseconds | null {
  const seconds = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(seconds) && seconds >= 0
    ? asMilliseconds(Math.round(seconds * 1000))
    : null;
}

function toChannels(value: number | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function toSampleRate(value: string | undefined): number | null {
  const n = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Convert raw ffprobe JSON into typed `SourceMetadata`. Pure and total: throws
 * `ProbeError` for structurally invalid input, otherwise ignores stream kinds
 * it does not model (data/attachment) rather than failing.
 */
export function parseProbeOutput(raw: unknown): SourceMetadata {
  if (typeof raw !== "object" || raw === null) {
    throw new ProbeError("ffprobe output was not a JSON object");
  }
  const probe = raw as RawProbe;
  if (!Array.isArray(probe.streams)) {
    throw new ProbeError("ffprobe output is missing a 'streams' array");
  }

  const video: VideoStream[] = [];
  const audio: AudioStream[] = [];
  const subtitle: SubtitleStream[] = [];

  for (const stream of probe.streams) {
    const index = typeof stream.index === "number" ? stream.index : -1;
    const codec = stream.codec_name ?? "unknown";

    switch (stream.codec_type) {
      case "video": {
        if (typeof stream.width !== "number" || typeof stream.height !== "number") {
          throw new ProbeError(`video stream ${index} is missing width/height`);
        }
        video.push({
          index,
          codec,
          width: asPixels(stream.width),
          height: asPixels(stream.height),
          bitrate: toBitrate(stream.bit_rate),
          frameRate: toFrameRate(stream.r_frame_rate),
        });
        break;
      }
      case "audio":
        audio.push({
          index,
          codec,
          bitrate: toBitrate(stream.bit_rate),
          channels: toChannels(stream.channels),
          sampleRate: toSampleRate(stream.sample_rate),
          language: stream.tags?.language ?? null,
        });
        break;
      case "subtitle":
        subtitle.push({ index, codec, language: stream.tags?.language ?? null });
        break;
      default:
        break;
    }
  }

  return {
    durationMs: toDurationMs(probe.format?.duration),
    formatBitrate: toBitrate(probe.format?.bit_rate),
    video,
    audio,
    subtitle,
  };
}

/** Dependencies for the ffprobe adapter. */
export interface FfprobeServiceDeps {
  readonly run: ProcessRunner;
  /** Resolved ffprobe command (see `core/binaries`). */
  readonly ffprobePath: string;
}

/** Create a `ProbeService` backed by a real ffprobe process. */
export function createFfprobeService(deps: FfprobeServiceDeps): ProbeService {
  return {
    async probe(input, signal): Promise<SourceMetadata> {
      const args = buildFfprobeArgs(input);
      let result: Awaited<ReturnType<ProcessRunner>>;
      try {
        result = await deps.run(deps.ffprobePath, signal ? { args, signal } : { args });
      } catch (cause) {
        throw new ProbeError(`Failed to spawn ffprobe for "${input}"`, { cause });
      }

      if (result.exitCode !== 0) {
        throw new ProbeError(
          `ffprobe exited with code ${result.exitCode} for "${input}": ${result.stderr.trim()}`,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(result.stdout);
      } catch (cause) {
        throw new ProbeError(`ffprobe produced invalid JSON for "${input}"`, { cause });
      }

      return parseProbeOutput(json);
    },
  };
}
