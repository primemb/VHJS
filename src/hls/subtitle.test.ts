import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FakeClock,
  FakeFfmpegRunner,
  FakeFileSystem,
  FakeLogger,
  FakeProbeService,
} from "../../tests/fakes/index.js";
import { makeSourceMetadata } from "../../tests/fixtures/metadata.js";
import { asMilliseconds } from "../types/brands.js";
import type { SourceMetadata } from "../types/metadata.js";
import { isSubtitleDryRun } from "../types/subtitle.js";
import {
  NoSubtitleTrackError,
  PlaylistParseError,
  ProbeError,
  TranscodeError,
} from "../validation/errors.js";
import { getAttribute, parseMasterPlaylist, unquote } from "./playlist.js";
import {
  buildSubtitleHlsCommand,
  createSubtitleTools,
  type SubtitleToolsDeps,
} from "./subtitle.js";

describe("buildSubtitleHlsCommand", () => {
  it("segments WebVTT and writes an M3U8 media playlist with cross-platform paths", () => {
    const { args, playlistPath } = buildSubtitleHlsCommand({
      input: "captions.vtt",
      outputDir: "C:\\out\\hls\\subtitles_en\\",
      trackIndex: 2,
      segmentDuration: 4,
    });

    const joined = args.join(" ");
    expect(joined).toContain("-map 0:s:2");
    expect(joined).toContain("-c:s webvtt");
    expect(joined).toContain("-f segment -segment_time 4");
    expect(joined).toContain("-segment_list C:/out/hls/subtitles_en/subtitles.m3u8");
    expect(joined).toContain("-segment_list_type m3u8 -segment_format webvtt");
    expect(args.at(-1)).toBe("C:/out/hls/subtitles_en/data%03d.vtt");
    expect(playlistPath).toBe("C:/out/hls/subtitles_en/subtitles.m3u8");
  });

  it("converts SRT inputs to WebVTT with the default track and segment duration", () => {
    const { args } = buildSubtitleHlsCommand({ input: "captions.srt", outputDir: "subs" });
    expect(args.join(" ")).toContain(
      "-i captions.srt -map 0:s:0 -c:s webvtt -f segment -segment_time 6",
    );
  });

  it("supports a custom media-playlist filename", () => {
    const built = buildSubtitleHlsCommand({
      input: "captions.vtt",
      outputDir: "subs",
      playlistName: "english.m3u8",
    });
    expect(built.playlistPath).toBe("subs/english.m3u8");
  });
});

const PACKAGE_DIR = "out/hls";
const MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  '#EXT-X-STREAM-INF:BANDWIDTH=5350000,CODECS="avc1.640028,mp4a.40.2"',
  "stream_1080p/stream.m3u8",
  "",
].join("\n");

const SUBTITLE_META = makeSourceMetadata({
  video: [],
  audio: [],
  subtitle: [{ index: 0, codec: "webvtt", language: "en" }],
});

interface Harness {
  readonly deps: SubtitleToolsDeps;
  readonly ffmpeg: FakeFfmpegRunner;
  readonly fs: FakeFileSystem;
  readonly logger: FakeLogger;
}

function harness(
  metadata: SourceMetadata = SUBTITLE_META,
  ffmpeg = new FakeFfmpegRunner(),
): Harness {
  const fs = new FakeFileSystem();
  const logger = new FakeLogger();
  return {
    deps: {
      probe: new FakeProbeService(metadata),
      ffmpeg,
      fs,
      clock: new FakeClock(),
      logger,
    },
    ffmpeg,
    fs,
    logger,
  };
}

function seedPackage(fs: FakeFileSystem, subtitleInput = "captions.vtt"): void {
  fs.dirs.add(PACKAGE_DIR);
  fs.files.set(join(PACKAGE_DIR, "master.m3u8"), MASTER);
  fs.files.set(subtitleInput, "");
}

describe("addSubtitleTrack", () => {
  it("segments a WebVTT input and patches every variant with its subtitle group", async () => {
    const { deps, ffmpeg, fs, logger } = harness();
    seedPackage(fs);

    const result = await createSubtitleTools(deps).addSubtitleTrack({
      packageDir: PACKAGE_DIR,
      subtitleInput: "captions.vtt",
      language: "en",
      name: "English",
      forced: true,
    });
    if (isSubtitleDryRun(result)) throw new Error("expected a real run");

    expect(ffmpeg.lastArgs.join(" ")).toContain("-c:s webvtt");
    expect(result.subtitlePlaylistPath).toBe("out/hls/subtitles_subtitles_en/subtitles.m3u8");
    expect(result).toMatchObject({
      groupId: "subtitles",
      language: "en",
      name: "English",
      forced: true,
      warnings: [],
    });
    expect(fs.dirs.has("out/hls/subtitles_subtitles_en")).toBe(true);
    expect(logger.messages("info")).toEqual(["Adding subtitle track"]);

    const patched = parseMasterPlaylist(fs.files.get(join(PACKAGE_DIR, "master.m3u8")) ?? "");
    expect(unquote(getAttribute(patched.media[0]?.attributes ?? [], "URI") ?? "")).toBe(
      "subtitles_subtitles_en/subtitles.m3u8",
    );
    expect(getAttribute(patched.media[0]?.attributes ?? [], "FORCED")).toBe("YES");
    expect(patched.variants.every((v) => getAttribute(v.attributes, "SUBTITLES"))).toBe(true);
  });

  it("converts SRT on ingest and forwards cancellation/progress options", async () => {
    const progress = {
      percent: 50,
      timeMs: asMilliseconds(500),
      fps: null,
      speed: 1,
      currentRendition: null,
    } as const;
    const ffmpeg = new FakeFfmpegRunner({ progress: [progress] });
    const { deps, fs } = harness(
      makeSourceMetadata({
        video: [],
        audio: [],
        subtitle: [{ index: 0, codec: "subrip", language: "de" }],
      }),
      ffmpeg,
    );
    seedPackage(fs, "captions.srt");
    const signal = new AbortController().signal;
    const events: unknown[] = [];

    await createSubtitleTools(deps).addSubtitleTrack({
      packageDir: PACKAGE_DIR,
      subtitleInput: "captions.srt",
      language: "de",
      name: "Deutsch",
      signal,
      onProgress: (event) => events.push(event),
    });

    expect(ffmpeg.lastArgs.join(" ")).toContain("-i captions.srt -map 0:s:0 -c:s webvtt");
    expect(ffmpeg.calls[0]?.signal).toBe(signal);
    expect(events).toEqual([progress]);
  });

  it("supports multiple languages in the same group across repeated calls", async () => {
    const { deps, fs } = harness();
    seedPackage(fs);
    fs.files.set("de.vtt", "");
    const tools = createSubtitleTools(deps);
    await tools.addSubtitleTrack({
      packageDir: PACKAGE_DIR,
      subtitleInput: "captions.vtt",
      language: "en",
      name: "English",
      groupId: "text",
    });
    await tools.addSubtitleTrack({
      packageDir: PACKAGE_DIR,
      subtitleInput: "de.vtt",
      language: "de",
      name: "Deutsch",
      groupId: "text",
    });

    const patched = parseMasterPlaylist(fs.files.get(join(PACKAGE_DIR, "master.m3u8")) ?? "");
    expect(patched.media).toHaveLength(2);
    expect(
      patched.media.map((item) => unquote(getAttribute(item.attributes, "GROUP-ID") ?? "")),
    ).toEqual(["text", "text"]);
  });

  it("dry-runs without invoking FFmpeg or writing files", async () => {
    const { deps, ffmpeg, fs } = harness();
    seedPackage(fs);
    const result = await createSubtitleTools(deps).addSubtitleTrack({
      packageDir: PACKAGE_DIR,
      subtitleInput: "captions.vtt",
      language: "en",
      name: "English",
      dryRun: true,
    });

    expect(isSubtitleDryRun(result)).toBe(true);
    if (isSubtitleDryRun(result)) {
      expect(result.args.join(" ")).toContain("-segment_format webvtt");
    }
    expect(ffmpeg.calls).toHaveLength(0);
    expect(fs.files.get(join(PACKAGE_DIR, "master.m3u8"))).toBe(MASTER);
  });

  it("throws ProbeError when the master playlist is missing", async () => {
    const { deps, fs } = harness();
    fs.files.set("captions.vtt", "");
    await expect(
      createSubtitleTools(deps).addSubtitleTrack({
        packageDir: PACKAGE_DIR,
        subtitleInput: "captions.vtt",
        language: "en",
        name: "English",
      }),
    ).rejects.toThrow(ProbeError);
  });

  it("throws ProbeError when the subtitle input is missing", async () => {
    const { deps, fs } = harness();
    fs.files.set(join(PACKAGE_DIR, "master.m3u8"), MASTER);
    await expect(
      createSubtitleTools(deps).addSubtitleTrack({
        packageDir: PACKAGE_DIR,
        subtitleInput: "missing.vtt",
        language: "en",
        name: "English",
      }),
    ).rejects.toThrow(ProbeError);
  });

  it("throws PlaylistParseError for a malformed master", async () => {
    const { deps, fs } = harness();
    fs.files.set(join(PACKAGE_DIR, "master.m3u8"), "not a playlist");
    fs.files.set("captions.vtt", "");
    await expect(
      createSubtitleTools(deps).addSubtitleTrack({
        packageDir: PACKAGE_DIR,
        subtitleInput: "captions.vtt",
        language: "en",
        name: "English",
      }),
    ).rejects.toThrow(PlaylistParseError);
  });

  it("throws NoSubtitleTrackError when the input has no subtitle stream", async () => {
    const { deps, fs } = harness(makeSourceMetadata({ subtitle: [] }));
    seedPackage(fs);
    await expect(
      createSubtitleTools(deps).addSubtitleTrack({
        packageDir: PACKAGE_DIR,
        subtitleInput: "captions.vtt",
        language: "en",
        name: "English",
      }),
    ).rejects.toThrow(NoSubtitleTrackError);
  });

  it("throws NoSubtitleTrackError for an out-of-range track index", async () => {
    const { deps, fs } = harness();
    seedPackage(fs);
    await expect(
      createSubtitleTools(deps).addSubtitleTrack({
        packageDir: PACKAGE_DIR,
        subtitleInput: "captions.vtt",
        language: "en",
        name: "English",
        trackIndex: 4,
      }),
    ).rejects.toThrow(NoSubtitleTrackError);
  });

  it("wraps a non-zero FFmpeg exit and leaves the master unchanged", async () => {
    const ffmpeg = new FakeFfmpegRunner({ result: { exitCode: 1, stderrTail: "bad cue" } });
    const { deps, fs } = harness(SUBTITLE_META, ffmpeg);
    seedPackage(fs);
    await expect(
      createSubtitleTools(deps).addSubtitleTrack({
        packageDir: PACKAGE_DIR,
        subtitleInput: "captions.vtt",
        language: "en",
        name: "English",
      }),
    ).rejects.toThrow(TranscodeError);
    expect(fs.files.get(join(PACKAGE_DIR, "master.m3u8"))).toBe(MASTER);
  });
});
