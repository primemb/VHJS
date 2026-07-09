/**
 * Ports — the interfaces the inner layers depend on.
 *
 * Use cases (`hls/`) and adapters (`core/`) both point at these interfaces:
 * inner layers *call* them, outer adapters *implement* them, and the
 * composition root wires the two together. Because every side effect (spawning
 * ffmpeg, reading the clock, touching the filesystem) sits behind a port, the
 * domain and use-case logic is testable with in-memory fakes and never spawns a
 * real process. Ports are intentionally narrow (Interface Segregation): a
 * consumer depends only on the capability it uses.
 *
 * This file is type-only — it must never import from `core/`.
 */
import type { SourceMetadata } from "../types/metadata.js";
import type { ProgressEvent } from "../types/progress.js";

/** Probe a source file into typed `SourceMetadata`. Implemented by `core/ffprobe`. */
export interface ProbeService {
  probe(input: string, signal?: AbortSignal): Promise<SourceMetadata>;
}

/** Options for a single ffmpeg invocation. */
export interface FfmpegRunOptions {
  /** The fully-built ffmpeg argument vector (see `core/ffmpeg` arg-builders). */
  readonly args: readonly string[];
  /** Cancels the run when aborted. */
  readonly signal?: AbortSignal;
  /** Invoked for each parsed progress tick while ffmpeg runs. */
  readonly onProgress?: (event: ProgressEvent) => void;
}

/** Outcome of an ffmpeg invocation. */
export interface FfmpegRunResult {
  /** Process exit code (`0` on success). */
  readonly exitCode: number;
  /** Tail of stderr, retained for diagnostics / `TranscodeError`. */
  readonly stderrTail: string;
}

/** Run ffmpeg with a prebuilt argv, streaming progress. Implemented by `core/ffmpeg`. */
export interface FfmpegRunner {
  run(options: FfmpegRunOptions): Promise<FfmpegRunResult>;
}

/**
 * The subset of filesystem operations VHJS needs. Writes must stay under the
 * user's chosen output directory (enforced by callers, not this port).
 */
export interface FileSystem {
  exists(path: string): Promise<boolean>;
  /** Create a directory (and parents); a no-op if it already exists. */
  mkdirp(path: string): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<string>;
  /** List entry names directly under `path`. */
  readDir(path: string): Promise<string[]>;
}

/** A source of wall-clock time — injected so job timings are deterministic in tests. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

/** Structured, level-based logging. Adapters decide where the lines actually go. */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
