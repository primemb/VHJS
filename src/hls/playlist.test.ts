import { describe, expect, it } from "vitest";
import { PlaylistParseError } from "../validation/errors.js";
import {
  addAlternateAudio,
  addAlternateSubtitle,
  formatAttributeList,
  getAttribute,
  parseAttributeList,
  parseMasterPlaylist,
  serializeMasterPlaylist,
  sumMediaPlaylistDurationMs,
  unquote,
  variantHasMuxedAudio,
} from "./playlist.js";

/** First element or a loud failure — keeps tests honest under noUncheckedIndexedAccess. */
function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error("expected at least one element");
  }
  return item;
}

const MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  '#EXT-X-STREAM-INF:BANDWIDTH=5350000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  "stream_1080p/stream.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=2996000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
  "stream_720p/stream.m3u8",
  "",
].join("\n");

const MEDIA = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  "#EXT-X-TARGETDURATION:6",
  "#EXT-X-PLAYLIST-TYPE:VOD",
  "#EXTINF:6.000000,",
  "data000.ts",
  "#EXTINF:4.500000,",
  "data001.ts",
  "#EXT-X-ENDLIST",
  "",
].join("\n");

describe("parseAttributeList", () => {
  it("keeps quoted values with embedded commas intact", () => {
    const attrs = parseAttributeList('BANDWIDTH=100,CODECS="avc1.42c01e,mp4a.40.2",AUDIO="a"');
    expect(attrs).toEqual([
      ["BANDWIDTH", "100"],
      ["CODECS", '"avc1.42c01e,mp4a.40.2"'],
      ["AUDIO", '"a"'],
    ]);
  });

  it("round-trips through formatAttributeList", () => {
    const src = 'TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="a/audio.m3u8"';
    expect(formatAttributeList(parseAttributeList(src))).toBe(src);
  });

  it("throws PlaylistParseError on an attribute with no '='", () => {
    expect(() => parseAttributeList("BANDWIDTH=1,BROKEN")).toThrow(PlaylistParseError);
  });

  it("ignores trailing empty attribute segments", () => {
    expect(parseAttributeList("A=1,")).toEqual([["A", "1"]]);
  });
});

describe("addAlternateSubtitle", () => {
  const base = parseMasterPlaylist(MASTER);

  it("adds an EXT-X-MEDIA subtitle rendition and references it from every variant", () => {
    const patched = addAlternateSubtitle(base, {
      groupId: "subs",
      name: "English",
      language: "en",
      uri: "subtitles_subs_en/subtitles.m3u8",
      isDefault: false,
      autoselect: true,
      forced: false,
    });
    const attrs = first(patched.media).attributes;
    expect(getAttribute(attrs, "TYPE")).toBe("SUBTITLES");
    expect(unquote(getAttribute(attrs, "GROUP-ID") ?? "")).toBe("subs");
    expect(getAttribute(attrs, "FORCED")).toBe("NO");
    expect(patched.version).toBe(4);
    expect(
      patched.variants.every(
        (variant) => unquote(getAttribute(variant.attributes, "SUBTITLES") ?? "") === "subs",
      ),
    ).toBe(true);
  });

  it("supports forced subtitles and makes a default rendition autoselectable", () => {
    const patched = addAlternateSubtitle(base, {
      groupId: "subs",
      name: "Signs",
      language: "en",
      uri: "forced/subtitles.m3u8",
      isDefault: true,
      autoselect: false,
      forced: true,
    });
    const attrs = first(patched.media).attributes;
    expect(getAttribute(attrs, "DEFAULT")).toBe("YES");
    expect(getAttribute(attrs, "AUTOSELECT")).toBe("YES");
    expect(getAttribute(attrs, "FORCED")).toBe("YES");
  });

  it("accumulates languages without duplicating the SUBTITLES variant attribute", () => {
    const en = addAlternateSubtitle(base, {
      groupId: "subs",
      name: "English",
      language: "en",
      uri: "en/subtitles.m3u8",
      isDefault: false,
      autoselect: true,
      forced: false,
    });
    const both = addAlternateSubtitle(en, {
      groupId: "subs",
      name: "Deutsch",
      language: "de",
      uri: "de/subtitles.m3u8",
      isDefault: false,
      autoselect: false,
      forced: false,
    });
    expect(both.media).toHaveLength(2);
    expect(first(both.variants).attributes.filter(([key]) => key === "SUBTITLES")).toHaveLength(1);
    expect(getAttribute(both.media[1]?.attributes ?? [], "AUTOSELECT")).toBe("NO");
  });
});

describe("getAttribute / unquote", () => {
  it("reads a verbatim value and strips surrounding quotes", () => {
    const attrs = parseAttributeList('NAME="Français",DEFAULT=YES');
    expect(getAttribute(attrs, "NAME")).toBe('"Français"');
    expect(unquote(getAttribute(attrs, "NAME") ?? "")).toBe("Français");
    expect(getAttribute(attrs, "DEFAULT")).toBe("YES");
    expect(getAttribute(attrs, "MISSING")).toBeUndefined();
  });

  it("leaves an unquoted value unchanged", () => {
    expect(unquote("YES")).toBe("YES");
  });
});

describe("parseMasterPlaylist", () => {
  it("captures version, variants (with URIs) and preserved tags", () => {
    const pl = parseMasterPlaylist(MASTER);
    expect(pl.version).toBe(3);
    expect(pl.otherTags).toEqual(["#EXT-X-INDEPENDENT-SEGMENTS"]);
    expect(pl.variants).toHaveLength(2);
    expect(pl.variants[0]?.uri).toBe("stream_1080p/stream.m3u8");
    expect(getAttribute(pl.variants[0]?.attributes ?? [], "RESOLUTION")).toBe("1920x1080");
    expect(pl.media).toHaveLength(0);
  });

  it("throws when the #EXTM3U header is missing", () => {
    expect(() => parseMasterPlaylist("#EXT-X-VERSION:3\nfoo")).toThrow(PlaylistParseError);
  });

  it("throws when a STREAM-INF has no following URI line", () => {
    const bad = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n#EXT-X-ENDLIST";
    expect(() => parseMasterPlaylist(bad)).toThrow(PlaylistParseError);
  });

  it("throws on a bare URI with no preceding variant tag", () => {
    expect(() => parseMasterPlaylist("#EXTM3U\nstream/stream.m3u8")).toThrow(PlaylistParseError);
  });

  it("throws when a STREAM-INF is the last line (only blank lines follow)", () => {
    expect(() => parseMasterPlaylist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n\n")).toThrow(
      PlaylistParseError,
    );
  });

  it("tolerates CRLF line endings", () => {
    const crlf = MASTER.replace(/\n/g, "\r\n");
    expect(parseMasterPlaylist(crlf).variants).toHaveLength(2);
  });
});

describe("serializeMasterPlaylist", () => {
  it("round-trips parse -> serialize -> parse to an equal model", () => {
    const parsed = parseMasterPlaylist(MASTER);
    const reparsed = parseMasterPlaylist(serializeMasterPlaylist(parsed));
    expect(reparsed).toEqual(parsed);
  });

  it("omits the version line when version is null", () => {
    const text = serializeMasterPlaylist({
      version: null,
      media: [],
      variants: [],
      otherTags: [],
    });
    expect(text).toBe("#EXTM3U\n");
  });
});

describe("variantHasMuxedAudio", () => {
  it("detects muxed AAC in the CODECS attribute", () => {
    const pl = parseMasterPlaylist(MASTER);
    expect(variantHasMuxedAudio(first(pl.variants))).toBe(true);
  });

  it("returns false for a video-only variant", () => {
    const videoOnly = '#EXTM3U\n#EXT-X-STREAM-INF:CODECS="avc1.640028"\nv/stream.m3u8';
    expect(variantHasMuxedAudio(first(parseMasterPlaylist(videoOnly).variants))).toBe(false);
  });
});

describe("addAlternateAudio", () => {
  const base = parseMasterPlaylist(MASTER);

  it("appends an EXT-X-MEDIA rendition and bumps the version to >= 4", () => {
    const patched = addAlternateAudio(base, {
      groupId: "audio",
      name: "Français",
      language: "fr",
      uri: "audio_audio_fr/audio.m3u8",
      isDefault: false,
      autoselect: true,
    });
    expect(patched.version).toBe(4);
    expect(patched.media).toHaveLength(1);
    const attrs = first(patched.media).attributes;
    expect(getAttribute(attrs, "TYPE")).toBe("AUDIO");
    expect(unquote(getAttribute(attrs, "GROUP-ID") ?? "")).toBe("audio");
    expect(unquote(getAttribute(attrs, "LANGUAGE") ?? "")).toBe("fr");
    expect(unquote(getAttribute(attrs, "URI") ?? "")).toBe("audio_audio_fr/audio.m3u8");
    expect(getAttribute(attrs, "AUTOSELECT")).toBe("YES");
    expect(getAttribute(attrs, "DEFAULT")).toBe("NO");
  });

  it("references the group from every variant via AUDIO=", () => {
    const patched = addAlternateAudio(base, {
      groupId: "aud",
      name: "N",
      language: "fr",
      uri: "u",
      isDefault: false,
      autoselect: true,
    });
    for (const variant of patched.variants) {
      expect(unquote(getAttribute(variant.attributes, "AUDIO") ?? "")).toBe("aud");
    }
    // existing renditions preserved
    expect(patched.variants).toHaveLength(2);
    expect(patched.variants[0]?.uri).toBe("stream_1080p/stream.m3u8");
  });

  it("forces AUTOSELECT=YES when the rendition is DEFAULT", () => {
    const patched = addAlternateAudio(base, {
      groupId: "audio",
      name: "N",
      language: "en",
      uri: "u",
      isDefault: true,
      autoselect: false,
    });
    const attrs = first(patched.media).attributes;
    expect(getAttribute(attrs, "DEFAULT")).toBe("YES");
    expect(getAttribute(attrs, "AUTOSELECT")).toBe("YES");
  });

  it("emits AUTOSELECT=NO for a non-default, non-autoselect rendition", () => {
    const patched = addAlternateAudio(base, {
      groupId: "audio",
      name: "N",
      language: "de",
      uri: "u",
      isDefault: false,
      autoselect: false,
    });
    expect(getAttribute(first(patched.media).attributes, "AUTOSELECT")).toBe("NO");
  });

  it("includes a CHANNELS attribute when provided", () => {
    const patched = addAlternateAudio(base, {
      groupId: "audio",
      name: "N",
      language: "en",
      uri: "u",
      isDefault: false,
      autoselect: true,
      channels: 2,
    });
    expect(unquote(getAttribute(first(patched.media).attributes, "CHANNELS") ?? "")).toBe("2");
  });

  it("accumulates multiple languages into one group (multi-language)", () => {
    const fr = addAlternateAudio(base, {
      groupId: "audio",
      name: "Français",
      language: "fr",
      uri: "audio_audio_fr/audio.m3u8",
      isDefault: false,
      autoselect: true,
    });
    const both = addAlternateAudio(fr, {
      groupId: "audio",
      name: "Deutsch",
      language: "de",
      uri: "audio_audio_de/audio.m3u8",
      isDefault: false,
      autoselect: true,
    });
    expect(both.media).toHaveLength(2);
    const groups = both.media.map((m) => unquote(getAttribute(m.attributes, "GROUP-ID") ?? ""));
    expect(groups).toEqual(["audio", "audio"]);
    // Version stays >= 4, not bumped further.
    expect(both.version).toBe(4);
  });

  it("does not duplicate the AUDIO attribute across repeated adds", () => {
    const once = addAlternateAudio(base, {
      groupId: "audio",
      name: "N",
      language: "fr",
      uri: "u1",
      isDefault: false,
      autoselect: true,
    });
    const twice = addAlternateAudio(once, {
      groupId: "audio",
      name: "M",
      language: "de",
      uri: "u2",
      isDefault: false,
      autoselect: true,
    });
    const audioAttrs = first(twice.variants).attributes.filter(([k]) => k === "AUDIO");
    expect(audioAttrs).toHaveLength(1);
  });
});

describe("sumMediaPlaylistDurationMs", () => {
  it("sums #EXTINF durations into milliseconds", () => {
    expect(sumMediaPlaylistDurationMs(MEDIA)).toBe(10_500);
  });

  it("returns 0 for a playlist with no segments", () => {
    expect(sumMediaPlaylistDurationMs("#EXTM3U\n#EXT-X-ENDLIST")).toBe(0);
  });
});
