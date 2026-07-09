import { describe, expect, it, vi } from "vitest";
import type { ProgressEvent } from "../types/progress.js";
import { createFfmpegRunner } from "./ffmpeg.js";
import type { ProcessResult, ProcessRunner } from "./process.js";

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    aborted: false,
    ...overrides,
  };
}

describe("createFfmpegRunner", () => {
  it("passes the argv to the process runner and returns the exit code", async () => {
    const run = vi.fn<ProcessRunner>(async () => processResult({ exitCode: 0 }));
    const runner = createFfmpegRunner({ run, ffmpegPath: "ffmpeg" });

    const result = await runner.run({ args: ["-i", "in.mp4"] });

    expect(run).toHaveBeenCalledWith("ffmpeg", expect.objectContaining({ args: ["-i", "in.mp4"] }));
    expect(result.exitCode).toBe(0);
  });

  it("parses stderr progress into onProgress", async () => {
    const run: ProcessRunner = async (_cmd, options) => {
      options?.onStderr?.("Duration: 00:01:00.00, start: 0.0\n");
      options?.onStderr?.("frame=120 time=00:00:30.00 fps=60 speed=2.0x\r");
      return processResult();
    };
    const events: ProgressEvent[] = [];
    const runner = createFfmpegRunner({ run, ffmpegPath: "ffmpeg" });

    await runner.run({ args: [], onProgress: (e) => events.push(e) });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ percent: 50, timeMs: 30_000 });
  });

  it("retains only the trailing bytes of stderr", async () => {
    const run: ProcessRunner = async (_cmd, options) => {
      options?.onStderr?.("A".repeat(50));
      options?.onStderr?.("BCDEF");
      return processResult({ exitCode: 1 });
    };
    const runner = createFfmpegRunner({ run, ffmpegPath: "ffmpeg", stderrTailBytes: 5 });

    const result = await runner.run({ args: [] });

    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toBe("BCDEF");
  });

  it("maps a null exit code (killed) to -1", async () => {
    const run: ProcessRunner = async () => processResult({ exitCode: null });
    const runner = createFfmpegRunner({ run, ffmpegPath: "ffmpeg" });
    expect((await runner.run({ args: [] })).exitCode).toBe(-1);
  });

  it("forwards an abort signal and rejects with its reason when aborted", async () => {
    const reason = new Error("cancelled by user");
    const run: ProcessRunner = async () => processResult({ aborted: true });
    const runner = createFfmpegRunner({ run, ffmpegPath: "ffmpeg" });
    const controller = new AbortController();
    controller.abort(reason);

    await expect(runner.run({ args: [], signal: controller.signal })).rejects.toBe(reason);
  });

  it("rejects with a generic error when aborted without an Error reason", async () => {
    const run: ProcessRunner = async () => processResult({ aborted: true });
    const runner = createFfmpegRunner({ run, ffmpegPath: "ffmpeg" });
    await expect(runner.run({ args: [] })).rejects.toThrow(/aborted/);
  });
});
