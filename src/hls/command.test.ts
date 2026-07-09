import { describe, expect, it } from "vitest";
import { makeRendition } from "../../tests/fixtures/rendition.js";
import { asBitrate, asPixels } from "../types/brands.js";
import { ConflictingFfmpegArgError } from "../validation/errors.js";
import { buildHlsCommand } from "./command.js";

const ladder = [
  makeRendition({ height: asPixels(1080), videoBitrate: asBitrate(5_000_000) }),
  makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) }),
];

describe("buildHlsCommand", () => {
  it("throws when given no renditions", () => {
    expect(() => buildHlsCommand({ input: "in.mp4", outputDir: "out", renditions: [] })).toThrow(
      RangeError,
    );
  });

  it("derives variant dirs, playlists and master path (posix-normalized)", () => {
    const cmd = buildHlsCommand({
      input: "in.mp4",
      outputDir: "C:\\out\\hls\\",
      renditions: ladder,
    });
    expect(cmd.masterPlaylistPath).toBe("C:/out/hls/master.m3u8");
    expect(cmd.variants.map((v) => v.name)).toEqual(["1080p", "720p"]);
    expect(cmd.variants[0]?.dir).toBe("C:/out/hls/stream_1080p");
    expect(cmd.variants[1]?.playlistPath).toBe("C:/out/hls/stream_720p/stream.m3u8");
  });

  it("builds a split+scale filter graph for each rung", () => {
    const { args } = buildHlsCommand({ input: "in.mp4", outputDir: "out", renditions: ladder });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toBe("[0:v]split=2[v0][v1];[v0]scale=-2:1080[vout0];[v1]scale=-2:720[vout1]");
  });

  it("maps one video output and one source-audio map per rung", () => {
    const { args } = buildHlsCommand({ input: "in.mp4", outputDir: "out", renditions: ladder });
    expect(args.filter((a) => a === "[vout0]" || a === "[vout1]")).toHaveLength(2);
    expect(args.filter((a) => a === "0:a:0")).toHaveLength(2);
  });

  it("emits per-stream codec, bitrate, maxrate and bufsize", () => {
    const { args } = buildHlsCommand({ input: "in.mp4", outputDir: "out", renditions: ladder });
    const joined = args.join(" ");
    expect(joined).toContain("-c:v:0 libx264 -b:v:0 5000000");
    expect(joined).toContain("-maxrate:v:0 5350000"); // 5_000_000 * 1.07
    expect(joined).toContain("-bufsize:v:0 7500000"); // 5_000_000 * 1.5
    expect(joined).toContain("-c:a:0 aac -b:a:0 128000");
    expect(joined).toContain("-c:v:1 libx264 -b:v:1 2800000");
  });

  it("wires the HLS muxer options and var_stream_map with names", () => {
    const { args } = buildHlsCommand({ input: "in.mp4", outputDir: "out", renditions: ladder });
    const joined = args.join(" ");
    expect(joined).toContain("-f hls");
    expect(joined).toContain("-hls_time 6");
    expect(joined).toContain("-hls_playlist_type vod");
    expect(joined).toContain("-hls_segment_filename out/stream_%v/data%03d.ts");
    expect(joined).toContain("-master_pl_name master.m3u8");
    expect(args[args.indexOf("-var_stream_map") + 1]).toBe("v:0,a:0,name:1080p v:1,a:1,name:720p");
    expect(args.at(-1)).toBe("out/stream_%v/stream.m3u8");
  });

  it("honours custom segment duration, preset, master name and gop size", () => {
    const { args } = buildHlsCommand({
      input: "in.mp4",
      outputDir: "out",
      renditions: ladder,
      segmentDuration: 4,
      masterPlaylistName: "index.m3u8",
      preset: "slow",
      gopSize: 96,
    });
    const joined = args.join(" ");
    expect(joined).toContain("-hls_time 4");
    expect(joined).toContain("-preset slow");
    expect(joined).toContain("-master_pl_name index.m3u8");
    expect(joined).toContain("-g 96 -keyint_min 96 -sc_threshold 0");
  });

  it("omits gop args when no gop size is given", () => {
    const { args } = buildHlsCommand({ input: "in.mp4", outputDir: "out", renditions: ladder });
    expect(args).not.toContain("-g");
  });

  it("omits all audio mapping/codec args and audio in var_stream_map when includeAudio is false", () => {
    const { args } = buildHlsCommand({
      input: "in.mp4",
      outputDir: "out",
      renditions: ladder,
      includeAudio: false,
    });
    expect(args).not.toContain("0:a:0");
    expect(args.join(" ")).not.toContain("-c:a:0");
    expect(args).not.toContain("-ac");
    expect(args[args.indexOf("-var_stream_map") + 1]).toBe("v:0,name:1080p v:1,name:720p");
  });

  describe("custom args", () => {
    it("injects inputArgs before -i and outputArgs before the HLS muxer", () => {
      const { args } = buildHlsCommand({
        input: "in.mp4",
        outputDir: "out",
        renditions: ladder,
        inputArgs: ["-hwaccel", "cuda"],
        outputArgs: ["-tune", "film", "-crf", "20"],
      });
      // inputArgs sit before -i
      expect(args.indexOf("-hwaccel")).toBeLessThan(args.indexOf("-i"));
      // outputArgs sit after -preset and before -f hls
      expect(args.indexOf("-tune")).toBeGreaterThan(args.indexOf("-preset"));
      expect(args.indexOf("-tune")).toBeLessThan(args.indexOf("-f"));
      expect(args.join(" ")).toContain("-tune film -crf 20");
    });

    it("rejects outputArgs that collide with a VHJS-managed codec flag", () => {
      expect(() =>
        buildHlsCommand({
          input: "in.mp4",
          outputDir: "out",
          renditions: ladder,
          outputArgs: ["-c:v", "libx265"],
        }),
      ).toThrow(ConflictingFfmpegArgError);
    });

    it("rejects outputArgs that collide with -preset or any -hls_* flag", () => {
      expect(() =>
        buildHlsCommand({
          input: "i",
          outputDir: "o",
          renditions: ladder,
          outputArgs: ["-preset", "slow"],
        }),
      ).toThrow(ConflictingFfmpegArgError);
      expect(() =>
        buildHlsCommand({
          input: "i",
          outputDir: "o",
          renditions: ladder,
          outputArgs: ["-hls_time", "2"],
        }),
      ).toThrow(/hls_time/);
    });

    it("rejects inputArgs that collide with -i", () => {
      expect(() =>
        buildHlsCommand({
          input: "i",
          outputDir: "o",
          renditions: ladder,
          inputArgs: ["-i", "other.mp4"],
        }),
      ).toThrow(ConflictingFfmpegArgError);
    });

    it("allows additive flags whose value happens to start with a dash-free token", () => {
      const { args } = buildHlsCommand({
        input: "in.mp4",
        outputDir: "out",
        renditions: ladder,
        outputArgs: ["-metadata", "title=My Movie", "-threads", "4"],
      });
      expect(args.join(" ")).toContain("-metadata title=My Movie -threads 4");
    });
  });
});
