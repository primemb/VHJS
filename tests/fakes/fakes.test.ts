import { describe, expect, it } from "vitest";
import { asMilliseconds } from "../../src/types/brands.js";
import type { ProgressEvent } from "../../src/types/progress.js";
import { makeSourceMetadata } from "../fixtures/metadata.js";
import { FakeClock } from "./fake-clock.js";
import { FakeFfmpegRunner } from "./fake-ffmpeg-runner.js";
import { FakeFileSystem } from "./fake-file-system.js";
import { FakeLogger } from "./fake-logger.js";
import { FakeProbeService } from "./fake-probe-service.js";

describe("FakeClock", () => {
  it("advances and sets deterministically", () => {
    const clock = new FakeClock(1000);
    expect(clock.now()).toBe(1000);
    expect(clock.advance(500)).toBe(1500);
    clock.set(0);
    expect(clock.now()).toBe(0);
  });
});

describe("FakeLogger", () => {
  it("records entries and filters messages by level", () => {
    const logger = new FakeLogger();
    logger.info("started", { job: 1 });
    logger.warn("clamped");
    logger.error("boom");

    expect(logger.entries).toHaveLength(3);
    expect(logger.entries[0]).toEqual({ level: "info", message: "started", meta: { job: 1 } });
    expect(logger.messages("warn")).toEqual(["clamped"]);
    expect(logger.messages()).toEqual(["started", "clamped", "boom"]);
  });

  it("omits meta when none is given", () => {
    const logger = new FakeLogger();
    logger.debug("plain");
    expect(logger.entries[0]).toEqual({ level: "debug", message: "plain" });
  });
});

describe("FakeFileSystem", () => {
  it("writes, reads, and reports existence", async () => {
    const fs = new FakeFileSystem();
    expect(await fs.exists("out/a.m3u8")).toBe(false);
    await fs.mkdirp("out");
    await fs.writeFile("out/a.m3u8", "#EXTM3U");

    expect(await fs.exists("out")).toBe(true);
    expect(await fs.exists("out/a.m3u8")).toBe(true);
    expect(await fs.readFile("out/a.m3u8")).toBe("#EXTM3U");
  });

  it("throws when reading a missing file", async () => {
    const fs = new FakeFileSystem();
    await expect(fs.readFile("nope")).rejects.toThrow(/no such file/);
  });

  it("lists immediate children by directory prefix", async () => {
    const fs = new FakeFileSystem();
    await fs.writeFile("out/master.m3u8", "");
    await fs.writeFile("out/720p/seg0.ts", "");
    await fs.writeFile("out/720p/seg1.ts", "");

    expect((await fs.readDir("out")).sort()).toEqual(["720p", "master.m3u8"]);
    expect(await fs.readDir("out/720p")).toEqual(["seg0.ts", "seg1.ts"]);
  });
});

describe("FakeFfmpegRunner", () => {
  const tick: ProgressEvent = {
    percent: 50,
    timeMs: asMilliseconds(30_000),
    fps: 60,
    speed: 2,
    currentRendition: "720p",
  };

  it("records argv and replays scripted progress before resolving", async () => {
    const events: ProgressEvent[] = [];
    const runner = new FakeFfmpegRunner({
      progress: [tick],
      result: { exitCode: 0, stderrTail: "" },
    });

    const result = await runner.run({ args: ["-i", "in.mp4"], onProgress: (e) => events.push(e) });

    expect(runner.lastArgs).toEqual(["-i", "in.mp4"]);
    expect(events).toEqual([tick]);
    expect(result.exitCode).toBe(0);
  });

  it("rejects when scripted with an error", async () => {
    const runner = new FakeFfmpegRunner({ error: new Error("scripted") });
    await expect(runner.run({ args: [] })).rejects.toThrow("scripted");
  });

  it("defaults lastArgs to empty before any call", () => {
    expect(new FakeFfmpegRunner().lastArgs).toEqual([]);
  });
});

describe("FakeProbeService", () => {
  it("returns preset metadata and records inputs", async () => {
    const service = new FakeProbeService(makeSourceMetadata());
    const meta = await service.probe("clip.mp4");
    expect(meta.video[0]?.height).toBe(1080);
    expect(service.inputs).toEqual(["clip.mp4"]);
  });
});
