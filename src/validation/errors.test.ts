import { describe, expect, it } from "vitest";
import { FfmpegNotFoundError, FfprobeNotFoundError, ProbeError, VhjsError } from "./errors.js";

describe("FfmpegNotFoundError", () => {
  const err = new FfmpegNotFoundError("/opt/ffmpeg");

  it("is a VhjsError and an Error", () => {
    expect(err).toBeInstanceOf(VhjsError);
    expect(err).toBeInstanceOf(Error);
  });

  it("carries the discriminant code and searched path", () => {
    expect(err.code).toBe("FFMPEG_NOT_FOUND");
    expect(err.searchedPath).toBe("/opt/ffmpeg");
  });

  it("names itself after the concrete subclass and mentions the path", () => {
    expect(err.name).toBe("FfmpegNotFoundError");
    expect(err.message).toContain("/opt/ffmpeg");
  });
});

describe("FfprobeNotFoundError", () => {
  it("carries its own code and path", () => {
    const err = new FfprobeNotFoundError("ffprobe");
    expect(err.code).toBe("FFPROBE_NOT_FOUND");
    expect(err.searchedPath).toBe("ffprobe");
    expect(err.name).toBe("FfprobeNotFoundError");
  });
});

describe("ProbeError", () => {
  it("carries the PROBE_FAILED code and preserves the cause", () => {
    const cause = new Error("boom");
    const err = new ProbeError("bad json", { cause });
    expect(err.code).toBe("PROBE_FAILED");
    expect(err.message).toBe("bad json");
    expect(err.cause).toBe(cause);
  });

  it("supports discriminating by code", () => {
    const err: VhjsError = new ProbeError("x");
    const label = err.code === "PROBE_FAILED" ? "probe" : "other";
    expect(label).toBe("probe");
  });
});
