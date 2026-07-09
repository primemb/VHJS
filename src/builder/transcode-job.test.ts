import { describe, expect, it, vi } from "vitest";
import type { TranscodeOutcome, Transcoder } from "../hls/transcoder.js";
import { asMilliseconds } from "../types/brands.js";
import type { ProgressEvent } from "../types/progress.js";
import { startTranscodeJob, TranscodeJob } from "./transcode-job.js";

const firstEvent: ProgressEvent = {
  percent: 25,
  timeMs: asMilliseconds(1_000),
  fps: 30,
  speed: 1,
  currentRendition: null,
};
const secondEvent: ProgressEvent = { ...firstEvent, percent: 50, timeMs: asMilliseconds(2_000) };
const outcome: TranscodeOutcome = {
  masterPlaylistPath: "out/master.m3u8",
  renditions: [],
  elapsedMs: 10,
  warnings: [],
};

describe("TranscodeJob", () => {
  it("mirrors progress to EventEmitter listeners and async iteration", async () => {
    const transcoder: Pick<Transcoder, "transcodeToHls"> = {
      async transcodeToHls(request) {
        request.onProgress?.(firstEvent);
        request.onProgress?.(secondEvent);
        return outcome;
      },
    };
    const callback = vi.fn();
    const job = startTranscodeJob(transcoder, {
      input: "in.mp4",
      outputDir: "out",
      onProgress: callback,
    });
    const emitted: ProgressEvent[] = [];
    const streamed: ProgressEvent[] = [];
    job.on("progress", (event: ProgressEvent) => emitted.push(event));
    const consume = (async () => {
      for await (const event of job) {
        streamed.push(event);
      }
    })();

    await expect(job.result).resolves.toEqual(outcome);
    await consume;
    expect(emitted).toEqual([firstEvent, secondEvent]);
    expect(streamed).toEqual([firstEvent, secondEvent]);
    expect(callback).toHaveBeenCalledWith(firstEvent);
    expect(callback).toHaveBeenCalledWith(secondEvent);
  });

  it("emits completion and ends an iterator after its queued progress", async () => {
    const job = new TranscodeJob(async (publish) => {
      publish(firstEvent);
      return outcome;
    });
    const complete = vi.fn();
    job.on("complete", complete);
    const iterator = job[Symbol.asyncIterator]();

    expect(iterator[Symbol.asyncIterator]()).toBe(iterator);
    expect(await iterator.next()).toEqual({ done: false, value: firstEvent });
    await expect(job.result).resolves.toEqual(outcome);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(complete).toHaveBeenCalledWith(outcome);
  });

  it("reports a failed job to listeners and pending iterators", async () => {
    const failure = new Error("ffmpeg failed");
    const job = new TranscodeJob(async () => Promise.reject(failure));
    const failed = vi.fn();
    job.on("failed", failed);
    const iterator = job[Symbol.asyncIterator]();
    const next = iterator.next();

    await expect(job.result).rejects.toBe(failure);
    await expect(next).rejects.toBe(failure);
    await expect(iterator.next()).rejects.toBe(failure);
    expect(failed).toHaveBeenCalledWith(failure);
  });

  it("allows an iterator to unsubscribe without affecting the job", async () => {
    let publish: ((event: ProgressEvent) => void) | undefined;
    let finish: ((value: TranscodeOutcome) => void) | undefined;
    const job = new TranscodeJob(
      (emit) =>
        new Promise<TranscodeOutcome>((resolve) => {
          publish = emit;
          finish = resolve;
        }),
    );
    const iterator = job[Symbol.asyncIterator]();
    const pending = iterator.next();

    await Promise.resolve();
    expect(await iterator.return?.()).toEqual({ done: true, value: undefined });
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    publish?.(firstEvent);
    finish?.(outcome);
    await expect(job.result).resolves.toEqual(outcome);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  it("rejects concurrent next calls from one iterator", async () => {
    let finish: ((value: TranscodeOutcome) => void) | undefined;
    const job = new TranscodeJob(
      () =>
        new Promise<TranscodeOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    const iterator = job[Symbol.asyncIterator]();
    const pending = iterator.next();

    await Promise.resolve();
    await expect(iterator.next()).rejects.toThrow("Only one pending next() call");
    finish?.(outcome);
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
  });
});
