/** End-to-end Phase-6 subtitle packaging against real FFmpeg/ffprobe. */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBinaryVerifier } from "../../src/core/binaries.js";
import { createProcessRunner } from "../../src/core/process.js";
import { getAttribute, parseMasterPlaylist, unquote } from "../../src/hls/playlist.js";
import { createVhjs, isSubtitleDryRun, type VhjsOptions } from "../../src/index.js";

const ffmpegPath = process.env.VHJS_FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.VHJS_FFPROBE_PATH ?? "ffprobe";
const options: VhjsOptions = { ffmpegPath, ffprobePath };
const vhjs = createVhjs(options);
const verify = createBinaryVerifier(createProcessRunner());
const available = (await verify(ffmpegPath)) && (await verify(ffprobePath));

const MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.4d401e"',
  "video/stream.m3u8",
  "",
].join("\n");

async function createPackage(root: string): Promise<string> {
  const packageDir = join(root, "hls");
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, "master.m3u8"), MASTER, "utf8");
  return packageDir;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!available)("e2e: subtitle features", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("segments WebVTT and advertises a forced subtitle rendition", async () => {
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-subtitle-vtt-"));
    const packageDir = await createPackage(dir);
    const input = join(dir, "captions.vtt");
    await writeFile(
      input,
      [
        "WEBVTT",
        "",
        "00:00:00.000 --> 00:00:00.800",
        "First cue",
        "",
        "00:00:01.200 --> 00:00:02.200",
        "Second cue",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await vhjs.addSubtitleTrack({
      packageDir,
      subtitleInput: input,
      language: "en",
      name: "English forced",
      forced: true,
      segmentDuration: 1,
    });
    if (isSubtitleDryRun(result)) throw new Error("expected a real run");

    expect(await exists(result.subtitlePlaylistPath)).toBe(true);
    const media = await readFile(result.subtitlePlaylistPath, "utf8");
    expect(media).toContain("#EXTM3U");
    expect(media).toContain("data000.vtt");
    expect(
      await readFile(join(packageDir, "subtitles_subtitles_en", "data000.vtt"), "utf8"),
    ).toContain("WEBVTT");

    const master = parseMasterPlaylist(await readFile(result.masterPlaylistPath, "utf8"));
    const attributes = master.media[0]?.attributes ?? [];
    expect(getAttribute(attributes, "TYPE")).toBe("SUBTITLES");
    expect(getAttribute(attributes, "FORCED")).toBe("YES");
    expect(unquote(getAttribute(master.variants[0]?.attributes ?? [], "SUBTITLES") ?? "")).toBe(
      "subtitles",
    );
  });

  it("converts SRT to segmented WebVTT", async () => {
    dir = await mkdtemp(join(tmpdir(), "vhjs-e2e-subtitle-srt-"));
    const packageDir = await createPackage(dir);
    const input = join(dir, "de.srt");
    await writeFile(
      input,
      [
        "1",
        "00:00:00,000 --> 00:00:00,900",
        "Hallo",
        "",
        "2",
        "00:00:01,100 --> 00:00:02,000",
        "Welt",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await vhjs.addSubtitleTrack({
      packageDir,
      subtitleInput: input,
      language: "de",
      name: "Deutsch",
      segmentDuration: 1,
    });
    if (isSubtitleDryRun(result)) throw new Error("expected a real run");

    const segment = await readFile(
      join(packageDir, "subtitles_subtitles_de", "data000.vtt"),
      "utf8",
    );
    expect(segment).toContain("WEBVTT");
    expect(segment).toContain("Hallo");
    expect(segment).not.toContain("00:00:00,000");
  });
});
