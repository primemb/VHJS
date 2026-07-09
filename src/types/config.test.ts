import { describe, expect, it } from "vitest";
import { DEFAULT_HLS_JOB_OPTIONS, type HlsJobConfig } from "./config.js";

describe("HLS job configuration", () => {
  it("exposes sensible transcoding defaults", () => {
    expect(DEFAULT_HLS_JOB_OPTIONS).toEqual({
      segmentDuration: 6,
      masterPlaylistName: "master.m3u8",
      preset: "veryfast",
    });
  });

  it("models auto and explicit ladders as discriminated public configurations", () => {
    const auto: HlsJobConfig = { input: "in.mp4", outputDir: "out" };
    const explicit: HlsJobConfig = {
      input: "in.mp4",
      outputDir: "out",
      ladder: { mode: "explicit", renditions: [] },
    };

    expect(auto.ladder?.mode ?? "auto").toBe("auto");
    expect(explicit.ladder.mode).toBe("explicit");
  });
});
