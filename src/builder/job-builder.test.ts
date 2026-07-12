import { describe, expect, it, vi } from "vitest";
import type { TranscodeOutcome, TranscodeRequest } from "../hls/transcoder.js";
import { asBitrate, asFrameRate, asPixels } from "../types/brands.js";
import { createHlsJobBuilder, type HlsJobClient } from "./job-builder.js";
import { TranscodeJob } from "./transcode-job.js";

const rendition = {
  height: asPixels(720),
  videoBitrate: asBitrate(2_800_000),
  audioBitrate: asBitrate(128_000),
  videoCodec: "h264" as const,
  audioCodec: "aac" as const,
};

const outcome: TranscodeOutcome = {
  masterPlaylistPath: "out/master.m3u8",
  renditions: [],
  elapsedMs: 0,
  warnings: [],
};

function createClient(): HlsJobClient & {
  readonly requests: TranscodeRequest[];
  readonly started: TranscodeRequest[];
} {
  const requests: TranscodeRequest[] = [];
  const started: TranscodeRequest[] = [];
  return {
    requests,
    started,
    async transcodeToHls(request) {
      requests.push(request);
      return outcome;
    },
    startTranscodeToHls(request) {
      started.push(request);
      return new TranscodeJob(async () => outcome);
    },
  };
}

describe("createHlsJobBuilder", () => {
  it("builds an explicit-ladder job and preserves every configured option", async () => {
    const client = createClient();
    const signal = new AbortController().signal;
    const onProgress = vi.fn();

    await createHlsJobBuilder("in.mp4", client)
      .output("out")
      .rendition(rendition)
      .segmentDuration(4)
      .masterPlaylist("playlist.m3u8")
      .preset("slow")
      .frameRate(asFrameRate(24))
      .bitratePolicy({ hardExceedFactor: 2 })
      .inputArgs("-hwaccel", "cuda")
      .outputArgs("-tune", "film")
      .watermark({ input: "logo.png", position: "bottom-right" })
      .dryRun()
      .signal(signal)
      .onProgress(onProgress)
      .run();

    expect(client.requests).toEqual([
      {
        input: "in.mp4",
        outputDir: "out",
        ladder: { mode: "explicit", renditions: [rendition] },
        segmentDuration: 4,
        masterPlaylistName: "playlist.m3u8",
        preset: "slow",
        frameRate: 24,
        bitratePolicy: { hardExceedFactor: 2 },
        inputArgs: ["-hwaccel", "cuda"],
        outputArgs: ["-tune", "film"],
        watermark: { input: "logo.png", position: "bottom-right" },
        dryRun: true,
        signal,
        onProgress,
      },
    ]);
  });

  it("uses the auto ladder with no renditions and supports an explicitly false dry run", async () => {
    const client = createClient();

    await createHlsJobBuilder("in.mp4", client).output("out").dryRun(false).run();

    expect(client.requests[0]).toEqual({
      input: "in.mp4",
      outputDir: "out",
      ladder: { mode: "auto" },
      dryRun: false,
    });
  });

  it("returns new builders so derived jobs do not share rendition state", async () => {
    const client = createClient();
    const base = createHlsJobBuilder("in.mp4", client).output("out");

    await base.rendition(rendition).run();
    await base.run();

    expect(client.requests.map((request) => request.ladder?.mode)).toEqual(["explicit", "auto"]);
  });

  it("delegates start to the streaming client API", async () => {
    const client = createClient();
    const job = createHlsJobBuilder("in.mp4", client).output("out").start();

    await expect(job.result).resolves.toEqual(outcome);
    expect(client.started[0]).toMatchObject({ ladder: { mode: "auto" } });
  });
});
