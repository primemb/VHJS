import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FakeClock,
  FakeFfmpegRunner,
  FakeFileSystem,
  FakeProbeService,
} from "../../tests/fakes/index.js";
import { makeSourceMetadata } from "../../tests/fixtures/metadata.js";
import { isAudioDryRun } from "../types/audio.js";
import { asBitrate, asMilliseconds } from "../types/brands.js";
import type { SourceMetadata } from "../types/metadata.js";
import {
  ConflictingFfmpegArgError,
  NoAudioTrackError,
  PlaylistParseError,
  ProbeError,
  TranscodeError,
} from "../validation/errors.js";
import {
  type AudioToolsDeps,
  buildAudioExtractCommand,
  buildAudioHlsCommand,
  createAudioTools,
} from "./audio.js";
import { getAttribute, parseMasterPlaylist, unquote } from "./playlist.js";

// --- Pure builders ---------------------------------------------------------

describe("buildAudioExtractCommand", () => {
  it("copies the source bitstream in copy mode", () => {
    const { args } = buildAudioExtractCommand({ input: "in.mkv", output: "out.m4a", mode: "copy" });
    const joined = args.join(" ");
    expect(joined).toContain("-i in.mkv");
    expect(joined).toContain("-map 0:a:0");
    expect(joined).toContain("-vn");
    expect(joined).toContain("-c:a copy");
    expect(args.at(-1)).toBe("out.m4a");
    expect(joined).not.toContain("-b:a");
  });

  it("re-encodes with bitrate, channels and track selection in aac mode", () => {
    const { args } = buildAudioExtractCommand({
      input: "in.mkv",
      output: "out.m4a",
      mode: "aac",
      trackIndex: 2,
      audioBitrate: 192_000,
      channels: 1,
    });
    const joined = args.join(" ");
    expect(joined).toContain("-map 0:a:2");
    expect(joined).toContain("-c:a aac -b:a 192000 -ac 1");
  });

  it("rejects custom args that collide with managed flags", () => {
    expect(() =>
      buildAudioExtractCommand({
        input: "in",
        output: "out",
        mode: "aac",
        outputArgs: ["-c:a", "flac"],
      }),
    ).toThrow(ConflictingFfmpegArgError);
  });

  it("passes additive custom args through", () => {
    const { args } = buildAudioExtractCommand({
      input: "in",
      output: "out",
      mode: "aac",
      outputArgs: ["-ar", "44100"],
    });
    expect(args.join(" ")).toContain("-ar 44100");
  });
});

describe("buildAudioHlsCommand", () => {
  it("segments audio into an audio-only HLS rendition (posix paths)", () => {
    const { args, playlistPath } = buildAudioHlsCommand({
      input: "fr.m4a",
      outputDir: "C:\\out\\hls\\audio_fr\\",
      segmentDuration: 4,
    });
    const joined = args.join(" ");
    expect(joined).toContain("-map 0:a:0");
    expect(joined).toContain("-c:a aac -b:a 128000 -ac 2");
    expect(joined).toContain("-f hls");
    expect(joined).toContain("-hls_time 4");
    expect(joined).toContain("-hls_segment_filename C:/out/hls/audio_fr/data%03d.ts");
    expect(playlistPath).toBe("C:/out/hls/audio_fr/audio.m3u8");
    expect(args.at(-1)).toBe(playlistPath);
  });

  it("rejects reserved custom args", () => {
    expect(() =>
      buildAudioHlsCommand({ input: "a", outputDir: "d", inputArgs: ["-hls_time", "2"] }),
    ).toThrow(ConflictingFfmpegArgError);
  });
});

// --- Use cases -------------------------------------------------------------

interface Harness {
  readonly deps: AudioToolsDeps;
  readonly ffmpeg: FakeFfmpegRunner;
  readonly fs: FakeFileSystem;
}

function harness(
  metadata: SourceMetadata,
  ffmpeg = new FakeFfmpegRunner(),
  fs = new FakeFileSystem(),
): Harness {
  const deps: AudioToolsDeps = {
    probe: new FakeProbeService(metadata),
    ffmpeg,
    fs,
    clock: new FakeClock(),
  };
  return { deps, ffmpeg, fs };
}

describe("extractAudio", () => {
  it("runs ffmpeg and reports the output path + mode", async () => {
    const { deps, ffmpeg, fs } = harness(makeSourceMetadata());
    fs.files.set("in.mkv", "");

    const result = await createAudioTools(deps).extractAudio({
      input: "in.mkv",
      output: "out/audio.m4a",
      mode: "aac",
    });

    expect(result).toMatchObject({ outputPath: "out/audio.m4a", mode: "aac", warnings: [] });
    expect(ffmpeg.calls).toHaveLength(1);
    expect(ffmpeg.lastArgs.join(" ")).toContain("-c:a aac");
    expect(fs.dirs.has("out")).toBe(true); // parent dir created
  });

  it("dry-runs without spawning ffmpeg or writing files", async () => {
    const { deps, ffmpeg, fs } = harness(makeSourceMetadata());
    fs.files.set("in.mkv", "");

    const result = await createAudioTools(deps).extractAudio({
      input: "in.mkv",
      output: "out/audio.m4a",
      mode: "copy",
      dryRun: true,
    });

    expect(isAudioDryRun(result)).toBe(true);
    if (isAudioDryRun(result)) {
      expect(result.args.join(" ")).toContain("-c:a copy");
    }
    expect(ffmpeg.calls).toHaveLength(0);
    expect(fs.dirs.size).toBe(0);
  });

  it("throws ProbeError when the input file is missing", async () => {
    const { deps } = harness(makeSourceMetadata());
    await expect(
      createAudioTools(deps).extractAudio({ input: "nope.mkv", output: "o.m4a", mode: "aac" }),
    ).rejects.toThrow(ProbeError);
  });

  it("throws NoAudioTrackError for a video-only source", async () => {
    const { deps, fs } = harness(makeSourceMetadata({ audio: [] }));
    fs.files.set("in.mkv", "");
    await expect(
      createAudioTools(deps).extractAudio({ input: "in.mkv", output: "o.m4a", mode: "aac" }),
    ).rejects.toThrow(NoAudioTrackError);
  });

  it("throws NoAudioTrackError when the track index is out of range", async () => {
    const { deps, fs } = harness(makeSourceMetadata());
    fs.files.set("in.mkv", "");
    await expect(
      createAudioTools(deps).extractAudio({
        input: "in.mkv",
        output: "o.m4a",
        mode: "aac",
        trackIndex: 5,
      }),
    ).rejects.toThrow(NoAudioTrackError);
  });

  it("wraps a non-zero ffmpeg exit in TranscodeError", async () => {
    const ffmpeg = new FakeFfmpegRunner({ result: { exitCode: 1, stderrTail: "boom" } });
    const { deps, fs } = harness(makeSourceMetadata(), ffmpeg);
    fs.files.set("in.mkv", "");
    await expect(
      createAudioTools(deps).extractAudio({ input: "in.mkv", output: "o.m4a", mode: "aac" }),
    ).rejects.toThrow(TranscodeError);
  });
});

// A muxed-audio master + one media playlist to patch, seeded under a package dir.
const PACKAGE_DIR = "out/hls";
const MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  '#EXT-X-STREAM-INF:BANDWIDTH=5350000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  "stream_1080p/stream.m3u8",
  "",
].join("\n");
const MEDIA = ["#EXTM3U", "#EXTINF:6.000000,", "d0.ts", "#EXTINF:4.500000,", "d1.ts", ""].join(
  "\n",
);

/** Seed a FakeFileSystem with a base HLS package + a to-be-added audio input. */
function seedPackage(fs: FakeFileSystem): void {
  fs.dirs.add(PACKAGE_DIR);
  fs.files.set(join(PACKAGE_DIR, "master.m3u8"), MASTER);
  fs.files.set(join(PACKAGE_DIR, "stream_1080p/stream.m3u8"), MEDIA);
  fs.files.set("fr.m4a", "");
}

describe("addAudioTrack", () => {
  // Audio-only metadata whose duration matches the media playlist (10.5s).
  const audioMeta = makeSourceMetadata({
    video: [],
    durationMs: asMilliseconds(10_500),
    audio: [
      {
        index: 0,
        codec: "aac",
        bitrate: asBitrate(128_000),
        channels: 2,
        sampleRate: 48_000,
        language: "fr",
      },
    ],
  });

  it("segments the audio and patches the master with EXT-X-MEDIA + AUDIO=", async () => {
    const { deps, ffmpeg, fs } = harness(audioMeta);
    seedPackage(fs);

    const result = await createAudioTools(deps).addAudioTrack({
      packageDir: PACKAGE_DIR,
      audioInput: "fr.m4a",
      language: "fr",
      name: "Français",
    });
    if (isAudioDryRun(result)) throw new Error("expected a real run");

    expect(ffmpeg.lastArgs.join(" ")).toContain("-f hls");
    expect(result.audioPlaylistPath).toBe("out/hls/audio_audio_fr/audio.m3u8");
    expect(result.groupId).toBe("audio");

    const patched = parseMasterPlaylist(fs.files.get(join(PACKAGE_DIR, "master.m3u8")) ?? "");
    expect(patched.media).toHaveLength(1);
    expect(unquote(getAttribute(patched.media[0]?.attributes ?? [], "LANGUAGE") ?? "")).toBe("fr");
    expect(patched.variants.every((v) => getAttribute(v.attributes, "AUDIO") !== undefined)).toBe(
      true,
    );
    expect(patched.version).toBe(4);
  });

  it("warns MUXED_AUDIO_PRESENT when variants carry muxed audio", async () => {
    const { deps, fs } = harness(audioMeta);
    seedPackage(fs);
    const result = await createAudioTools(deps).addAudioTrack({
      packageDir: PACKAGE_DIR,
      audioInput: "fr.m4a",
      language: "fr",
      name: "Français",
    });
    if (isAudioDryRun(result)) throw new Error("expected a real run");
    expect(result.warnings.map((w) => w.code)).toContain("MUXED_AUDIO_PRESENT");
    expect(result.warnings.map((w) => w.code)).not.toContain("AUDIO_DURATION_MISMATCH");
  });

  it("warns AUDIO_DURATION_MISMATCH when the audio is much longer/shorter", async () => {
    const longAudio = makeSourceMetadata({
      video: [],
      durationMs: asMilliseconds(60_000), // vs 10.5s of video
      audio: [
        {
          index: 0,
          codec: "aac",
          bitrate: asBitrate(128_000),
          channels: 2,
          sampleRate: 48_000,
          language: "fr",
        },
      ],
    });
    const { deps, fs } = harness(longAudio);
    seedPackage(fs);
    const result = await createAudioTools(deps).addAudioTrack({
      packageDir: PACKAGE_DIR,
      audioInput: "fr.m4a",
      language: "fr",
      name: "Français",
    });
    if (isAudioDryRun(result)) throw new Error("expected a real run");
    expect(result.warnings.map((w) => w.code)).toContain("AUDIO_DURATION_MISMATCH");
  });

  it("dry-runs without writing the master or running ffmpeg", async () => {
    const { deps, ffmpeg, fs } = harness(audioMeta);
    seedPackage(fs);
    const result = await createAudioTools(deps).addAudioTrack({
      packageDir: PACKAGE_DIR,
      audioInput: "fr.m4a",
      language: "fr",
      name: "Français",
      dryRun: true,
    });
    expect(isAudioDryRun(result)).toBe(true);
    if (isAudioDryRun(result)) {
      expect(result.args.join(" ")).toContain("-f hls");
    }
    expect(ffmpeg.calls).toHaveLength(0);
    // master untouched
    expect(fs.files.get(join(PACKAGE_DIR, "master.m3u8"))).toBe(MASTER);
  });

  it("wraps a non-zero ffmpeg exit in TranscodeError (and leaves the master unpatched)", async () => {
    const ffmpeg = new FakeFfmpegRunner({ result: { exitCode: 1, stderrTail: "boom" } });
    const { deps, fs } = harness(audioMeta, ffmpeg);
    seedPackage(fs);
    await expect(
      createAudioTools(deps).addAudioTrack({
        packageDir: PACKAGE_DIR,
        audioInput: "fr.m4a",
        language: "fr",
        name: "N",
      }),
    ).rejects.toThrow(TranscodeError);
    expect(fs.files.get(join(PACKAGE_DIR, "master.m3u8"))).toBe(MASTER);
  });

  it("skips the duration check when the master has no variants", async () => {
    const noVariants = "#EXTM3U\n#EXT-X-VERSION:3\n";
    const { deps, fs } = harness(audioMeta);
    fs.dirs.add(PACKAGE_DIR);
    fs.files.set(join(PACKAGE_DIR, "master.m3u8"), noVariants);
    fs.files.set("fr.m4a", "");
    const result = await createAudioTools(deps).addAudioTrack({
      packageDir: PACKAGE_DIR,
      audioInput: "fr.m4a",
      language: "fr",
      name: "N",
    });
    if (isAudioDryRun(result)) throw new Error("expected a real run");
    expect(result.warnings).toHaveLength(0); // no variants -> no duration/muxed warnings
  });

  it("skips the duration check when the variant's media playlist is unreadable", async () => {
    const { deps, fs } = harness(audioMeta);
    fs.dirs.add(PACKAGE_DIR);
    fs.files.set(join(PACKAGE_DIR, "master.m3u8"), MASTER); // references a media playlist we do NOT seed
    fs.files.set("fr.m4a", "");
    const result = await createAudioTools(deps).addAudioTrack({
      packageDir: PACKAGE_DIR,
      audioInput: "fr.m4a",
      language: "fr",
      name: "N",
    });
    if (isAudioDryRun(result)) throw new Error("expected a real run");
    expect(result.warnings.map((w) => w.code)).not.toContain("AUDIO_DURATION_MISMATCH");
  });

  it("throws ProbeError when the master playlist is missing", async () => {
    const { deps, fs } = harness(audioMeta);
    fs.files.set("fr.m4a", "");
    await expect(
      createAudioTools(deps).addAudioTrack({
        packageDir: PACKAGE_DIR,
        audioInput: "fr.m4a",
        language: "fr",
        name: "N",
      }),
    ).rejects.toThrow(ProbeError);
  });

  it("throws ProbeError when the audio input is missing", async () => {
    const { deps, fs } = harness(audioMeta);
    fs.dirs.add(PACKAGE_DIR);
    fs.files.set(join(PACKAGE_DIR, "master.m3u8"), MASTER);
    await expect(
      createAudioTools(deps).addAudioTrack({
        packageDir: PACKAGE_DIR,
        audioInput: "missing.m4a",
        language: "fr",
        name: "N",
      }),
    ).rejects.toThrow(ProbeError);
  });

  it("throws PlaylistParseError on a malformed master", async () => {
    const { deps, fs } = harness(audioMeta);
    fs.dirs.add(PACKAGE_DIR);
    fs.files.set(join(PACKAGE_DIR, "master.m3u8"), "not a playlist");
    fs.files.set("fr.m4a", "");
    await expect(
      createAudioTools(deps).addAudioTrack({
        packageDir: PACKAGE_DIR,
        audioInput: "fr.m4a",
        language: "fr",
        name: "N",
      }),
    ).rejects.toThrow(PlaylistParseError);
  });

  it("throws NoAudioTrackError when the audio input has no audio", async () => {
    const { deps, fs } = harness(makeSourceMetadata({ video: [], audio: [] }));
    seedPackage(fs);
    await expect(
      createAudioTools(deps).addAudioTrack({
        packageDir: PACKAGE_DIR,
        audioInput: "fr.m4a",
        language: "fr",
        name: "N",
      }),
    ).rejects.toThrow(NoAudioTrackError);
  });
});
