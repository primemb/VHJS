import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeFileSystem } from "../../tests/fakes/fake-file-system.js";
import { AlternateTrackNotFoundError, UnsafePlaylistUriError } from "../validation/errors.js";
import { createAlternateTrackTools, renditionDirectory } from "./alternate-track.js";
import { getAttribute, parseMasterPlaylist, unquote } from "./playlist.js";

const PACKAGE_DIR = "out/hls";
const MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:4",
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",URI="audio_en/audio.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Deutsch",LANGUAGE="de",URI="audio_de/audio.m3u8"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs_en/subtitles.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="audio",SUBTITLES="subs"',
  "stream/stream.m3u8",
  "",
].join("\n");

function setup() {
  const fs = new FakeFileSystem();
  fs.dirs.add(PACKAGE_DIR);
  fs.dirs.add(`${PACKAGE_DIR}/audio_en`);
  fs.dirs.add(`${PACKAGE_DIR}/audio_de`);
  fs.dirs.add(`${PACKAGE_DIR}/subs_en`);
  fs.files.set(join(PACKAGE_DIR, "master.m3u8"), MASTER);
  fs.files.set(`${PACKAGE_DIR}/audio_en/audio.m3u8`, "#EXTM3U");
  fs.files.set(`${PACKAGE_DIR}/audio_en/data000.ts`, "audio");
  fs.files.set(`${PACKAGE_DIR}/audio_de/audio.m3u8`, "#EXTM3U");
  fs.files.set(`${PACKAGE_DIR}/subs_en/subtitles.m3u8`, "#EXTM3U");
  fs.files.set(`${PACKAGE_DIR}/subs_en/data000.vtt`, "WEBVTT");
  return { fs, tools: createAlternateTrackTools({ fs }) };
}

describe("renditionDirectory", () => {
  it("returns the rendition directory only for a safe package-relative URI", () => {
    expect(renditionDirectory("out/hls", "audio_en/audio.m3u8")).toBe("out/hls/audio_en");
  });

  it.each([
    "../outside/audio.m3u8",
    "/absolute/audio.m3u8",
    "audio\\audio.m3u8",
    "audio.m3u8",
  ])("rejects unsafe hard-removal URI %s", (uri) => {
    expect(() => renditionDirectory("out/hls", uri)).toThrow(UnsafePlaylistUriError);
  });
});

describe("removeAlternateTrack", () => {
  it("soft-removes one audio rendition but retains its generated playlist and segments", async () => {
    const { fs, tools } = setup();
    const result = await tools.removeAlternateTrack("AUDIO", {
      packageDir: PACKAGE_DIR,
      groupId: "audio",
      name: "English",
    });

    expect(result).toMatchObject({ mode: "soft", removedUri: "audio_en/audio.m3u8" });
    expect(fs.files.has(`${PACKAGE_DIR}/audio_en/audio.m3u8`)).toBe(true);
    const patched = parseMasterPlaylist(fs.files.get(join(PACKAGE_DIR, "master.m3u8")) ?? "");
    expect(patched.media).toHaveLength(2);
    expect(unquote(getAttribute(patched.variants[0]?.attributes ?? [], "AUDIO") ?? "")).toBe(
      "audio",
    );
  });

  it("hard-removes subtitle playlist and segments, and removes its last group reference", async () => {
    const { fs, tools } = setup();
    const result = await tools.removeAlternateTrack("SUBTITLES", {
      packageDir: PACKAGE_DIR,
      groupId: "subs",
      name: "English",
      mode: "hard",
    });

    expect(result.kind).toBe("SUBTITLES");
    expect(fs.files.has(`${PACKAGE_DIR}/subs_en/subtitles.m3u8`)).toBe(false);
    expect(fs.files.has(`${PACKAGE_DIR}/subs_en/data000.vtt`)).toBe(false);
    const patched = parseMasterPlaylist(fs.files.get(join(PACKAGE_DIR, "master.m3u8")) ?? "");
    expect(getAttribute(patched.variants[0]?.attributes ?? [], "SUBTITLES")).toBeUndefined();
  });

  it("fails with a typed error when the selected rendition is absent", async () => {
    const { tools } = setup();
    await expect(
      tools.removeAlternateTrack("AUDIO", {
        packageDir: PACKAGE_DIR,
        groupId: "audio",
        name: "Missing",
      }),
    ).rejects.toThrow(AlternateTrackNotFoundError);
  });
});
