import { describe, expect, it, vi } from "vitest";
import { FfmpegNotFoundError, FfprobeNotFoundError } from "../validation/errors.js";
import {
  createBinaryResolver,
  createBinaryVerifier,
  ffmpegCandidate,
  ffprobeCandidate,
  resolveBinaries,
  type VerifyBinary,
} from "./binaries.js";
import type { ProcessResult, ProcessRunner } from "./process.js";

const ok: VerifyBinary = async () => true;
const fail: VerifyBinary = async () => false;

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

describe("candidates", () => {
  it("default to the bare binary name", () => {
    expect(ffmpegCandidate()).toBe("ffmpeg");
    expect(ffprobeCandidate()).toBe("ffprobe");
  });

  it("prefer an explicit override", () => {
    expect(ffmpegCandidate({ ffmpegPath: "/usr/local/bin/ffmpeg" })).toBe("/usr/local/bin/ffmpeg");
    expect(ffprobeCandidate({ ffprobePath: "C:\\ff\\ffprobe.exe" })).toBe("C:\\ff\\ffprobe.exe");
  });
});

describe("resolveBinaries", () => {
  it("returns the verified commands when both are runnable", async () => {
    await expect(resolveBinaries(ok, { ffmpegPath: "ff", ffprobePath: "fp" })).resolves.toEqual({
      ffmpeg: "ff",
      ffprobe: "fp",
    });
  });

  it("throws FfmpegNotFoundError when ffmpeg is not runnable", async () => {
    await expect(resolveBinaries(fail)).rejects.toBeInstanceOf(FfmpegNotFoundError);
  });

  it("throws FfprobeNotFoundError when only ffprobe is not runnable", async () => {
    const verify: VerifyBinary = async (cmd) => cmd === "ffmpeg";
    await expect(resolveBinaries(verify)).rejects.toBeInstanceOf(FfprobeNotFoundError);
  });
});

describe("createBinaryResolver", () => {
  it("verifies once and caches the result across calls", async () => {
    const verify = vi.fn<VerifyBinary>(async () => true);
    const resolve = createBinaryResolver(verify);

    const [a, b] = await Promise.all([resolve(), resolve()]);
    await resolve();

    expect(a).toEqual({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
    expect(b).toBe(a);
    // Two binaries verified, but only during the first (shared) resolution.
    expect(verify).toHaveBeenCalledTimes(2);
  });
});

describe("createBinaryVerifier", () => {
  it("is true when `<cmd> -version` exits 0", async () => {
    const run: ProcessRunner = async () => processResult({ exitCode: 0 });
    const verify = createBinaryVerifier(run);
    await expect(verify("ffmpeg")).resolves.toBe(true);
  });

  it("passes the -version argv to the runner", async () => {
    const run = vi.fn<ProcessRunner>(async () => processResult());
    await createBinaryVerifier(run)("ffprobe");
    expect(run).toHaveBeenCalledWith("ffprobe", { args: ["-version"] });
  });

  it("is false on a non-zero exit", async () => {
    const run: ProcessRunner = async () => processResult({ exitCode: 127 });
    await expect(createBinaryVerifier(run)("ffmpeg")).resolves.toBe(false);
  });

  it("is false (never throws) when the runner rejects", async () => {
    const run: ProcessRunner = async () => {
      throw new Error("ENOENT");
    };
    await expect(createBinaryVerifier(run)("ffmpeg")).resolves.toBe(false);
  });
});
