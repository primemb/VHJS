import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProgressEvent } from "../types/progress.js";
import { createProgressParser, extractDuration, hmsToMs, parseProgressLine } from "./progress.js";

function fixtureLines(): string[] {
  const url = new URL("../../tests/fixtures/ffmpeg/transcode-progress.stderr.txt", import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8").split("\n");
}

describe("hmsToMs", () => {
  it("converts h/m/s (with fractional seconds) to milliseconds", () => {
    expect(hmsToMs("00", "01", "00.00")).toBe(60_000);
    expect(hmsToMs("01", "00", "00")).toBe(3_600_000);
    expect(hmsToMs("00", "00", "04.5")).toBe(4_500);
  });
});

describe("extractDuration", () => {
  it("reads the Duration line from the fixture", () => {
    const line = fixtureLines().find((l) => l.includes("Duration"));
    expect(line).toBeDefined();
    expect(extractDuration(line as string)).toBe(60_000);
  });

  it("returns null for a line without a duration", () => {
    expect(extractDuration("frame= 120 fps=60")).toBeNull();
  });
});

describe("parseProgressLine", () => {
  it("parses a full stats line and computes percent against the total", () => {
    const line =
      "frame=  120 fps= 60 q=28.0 size=1024kB time=00:00:12.00 bitrate=2097.2kbits/s speed=2.0x";
    const event = parseProgressLine(line, hmsToMs("00", "01", "00"));
    expect(event).toEqual({
      percent: 20, // 12s of 60s
      timeMs: 12_000,
      fps: 60,
      speed: 2,
      currentRendition: null,
    });
  });

  it("reports a null percent when the total duration is unknown", () => {
    const line = "time=00:00:06.00 fps=30 speed=1.5x";
    expect(parseProgressLine(line, null)?.percent).toBeNull();
  });

  it("clamps percent to 100 when time overshoots the duration", () => {
    const line = "time=00:01:10.00 speed=2.0x";
    expect(parseProgressLine(line, hmsToMs("00", "01", "00"))?.percent).toBe(100);
  });

  it("leaves fps/speed null when the line omits them", () => {
    const event = parseProgressLine("time=00:00:03.00", null);
    expect(event?.fps).toBeNull();
    expect(event?.speed).toBeNull();
  });

  it("returns null for a line without a time field", () => {
    expect(parseProgressLine("Stream mapping:", null)).toBeNull();
  });
});

describe("createProgressParser", () => {
  it("latches the fixture duration and emits an event per stats line", () => {
    const events: ProgressEvent[] = [];
    const feed = createProgressParser((e) => events.push(e));
    feed(`${fixtureLines().join("\n")}\n`);

    // The fixture has four `time=` stats lines.
    expect(events).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({ percent: 100, timeMs: 60_000, speed: 2 });
  });

  it("buffers partial lines split across chunks", () => {
    const events: ProgressEvent[] = [];
    const feed = createProgressParser((e) => events.push(e));

    feed("Duration: 00:01:00.00, start: 0.0\n");
    feed("frame= 120 time=00:00:30.00 fp"); // line split mid-token
    feed("s=60 speed=2.0x\r");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ percent: 50, timeMs: 30_000, fps: 60 });
  });
});
