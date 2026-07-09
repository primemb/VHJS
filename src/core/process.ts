/**
 * Child-process lifecycle adapter (the "do" side of decide-from-do).
 *
 * A thin, promise-returning wrapper around `child_process.spawn` that captures
 * stdout/stderr, honours an `AbortSignal`, and enforces an optional timeout.
 * The `spawn` implementation is injected (defaulting to Node's), so the whole
 * lifecycle is unit-testable with a fake child — no real process required.
 *
 * This is an adapter: it is the only place (with the other `core/` modules)
 * allowed to touch `node:child_process`.
 */
import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";

/** Options for a single process run. */
export interface ProcessRunOptions {
  readonly args?: readonly string[];
  /** Kills the child when aborted. */
  readonly signal?: AbortSignal;
  /** Kill the child with SIGKILL after this many milliseconds. */
  readonly timeoutMs?: number;
  /** Called with each stdout chunk (already decoded to string). */
  readonly onStdout?: (chunk: string) => void;
  /** Called with each stderr chunk (already decoded to string). */
  readonly onStderr?: (chunk: string) => void;
}

/** The captured outcome of a process run. */
export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  /** `true` when the run was killed by the `timeoutMs` deadline. */
  readonly timedOut: boolean;
  /** `true` when the run was killed via the provided `AbortSignal`. */
  readonly aborted: boolean;
}

/** The narrow slice of `child_process.spawn` this module depends on (injectable). */
export type SpawnFn = (command: string, args: readonly string[]) => ChildProcess;

/** Runs a command to completion, resolving with the captured result. */
export type ProcessRunner = (
  command: string,
  options?: ProcessRunOptions,
) => Promise<ProcessResult>;

const defaultSpawn: SpawnFn = (command, args) => nodeSpawn(command, [...args]);

/**
 * Build a {@link ProcessRunner}. The runner rejects only when the process
 * cannot be spawned (e.g. ENOENT) or is aborted before starting; a non-zero
 * exit resolves normally so callers can inspect `exitCode`/`stderr`.
 */
export function createProcessRunner(spawnFn: SpawnFn = defaultSpawn): ProcessRunner {
  return (command, options = {}) =>
    new Promise<ProcessResult>((resolvePromise, reject) => {
      const { args = [], signal, timeoutMs, onStdout, onStderr } = options;

      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }

      const child = spawnFn(command, args);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let aborted = false;
      let settled = false;

      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              child.kill("SIGKILL");
            }, timeoutMs);

      const onAbort = () => {
        aborted = true;
        child.kill("SIGKILL");
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        signal?.removeEventListener("abort", onAbort);
      };

      child.stdout?.on("data", (chunk: unknown) => {
        const text = String(chunk);
        stdout += text;
        onStdout?.(text);
      });
      child.stderr?.on("data", (chunk: unknown) => {
        const text = String(chunk);
        stderr += text;
        onStderr?.(text);
      });

      child.on("error", (err) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(err);
      });

      child.on("close", (code, closeSignal) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolvePromise({
          exitCode: code,
          signal: closeSignal,
          stdout,
          stderr,
          timedOut,
          aborted,
        });
      });
    });
}

/** Prefer the signal's own reason when it is an `Error`, else a generic one. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Process aborted before it started");
}
