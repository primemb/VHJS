/**
 * Resolve & verify the ffmpeg / ffprobe binaries (adapter).
 *
 * Policy (CLAUDE.md): resolve from the system `PATH` by default, with an
 * explicit per-binary override — no bundled static binary. The *decision*
 * (which command to try) is a pure function; the *verification* (does
 * `<cmd> -version` exit 0?) is injected, so resolution logic and its typed
 * failures are testable without spawning anything.
 */
import { FfmpegNotFoundError, FfprobeNotFoundError } from "../validation/errors.js";
import type { ProcessRunner } from "./process.js";

/** User-supplied binary path overrides; unset falls back to `PATH` lookup. */
export interface BinaryOverrides {
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
}

/** The verified commands to invoke for each binary. */
export interface ResolvedBinaries {
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

/** Returns `true` when `command` is a runnable binary of the expected kind. */
export type VerifyBinary = (command: string) => Promise<boolean>;

const DEFAULT_FFMPEG = "ffmpeg";
const DEFAULT_FFPROBE = "ffprobe";

/** The ffmpeg command to try: the override if given, else the bare name. */
export function ffmpegCandidate(overrides: BinaryOverrides = {}): string {
  return overrides.ffmpegPath ?? DEFAULT_FFMPEG;
}

/** The ffprobe command to try: the override if given, else the bare name. */
export function ffprobeCandidate(overrides: BinaryOverrides = {}): string {
  return overrides.ffprobePath ?? DEFAULT_FFPROBE;
}

/**
 * Resolve both binaries, throwing the matching typed error if either is not
 * runnable. ffmpeg is checked first so the most common misconfiguration
 * surfaces its dedicated error.
 */
export async function resolveBinaries(
  verify: VerifyBinary,
  overrides: BinaryOverrides = {},
): Promise<ResolvedBinaries> {
  const ffmpeg = ffmpegCandidate(overrides);
  if (!(await verify(ffmpeg))) {
    throw new FfmpegNotFoundError(ffmpeg);
  }
  const ffprobe = ffprobeCandidate(overrides);
  if (!(await verify(ffprobe))) {
    throw new FfprobeNotFoundError(ffprobe);
  }
  return { ffmpeg, ffprobe };
}

/**
 * A memoizing resolver: verifies once, then returns the cached result (and
 * caches the in-flight promise so concurrent callers share one verification).
 */
export function createBinaryResolver(
  verify: VerifyBinary,
  overrides: BinaryOverrides = {},
): () => Promise<ResolvedBinaries> {
  let cached: Promise<ResolvedBinaries> | undefined;
  return () => {
    if (cached === undefined) {
      cached = resolveBinaries(verify, overrides);
    }
    return cached;
  };
}

/**
 * Build a real {@link VerifyBinary} over a {@link ProcessRunner}: a command is
 * runnable when `<command> -version` exits 0. Any spawn failure counts as
 * "not runnable" rather than propagating.
 */
export function createBinaryVerifier(run: ProcessRunner): VerifyBinary {
  return async (command) => {
    try {
      const result = await run(command, { args: ["-version"] });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  };
}
