/**
 * HLS master-playlist parsing & generation — pure domain (no I/O, no spawning).
 *
 * VHJS's transcoder produces a master `.m3u8` with muxed-audio variants; Phase 5
 * needs to *patch* an existing master to add an alternate-audio rendition without
 * clobbering what is already there. That requires reading the existing variants
 * and rewriting their `EXT-X-STREAM-INF` lines, so a real parse → model → patch →
 * serialize round-trip is cleaner than blind text appending.
 *
 * This is the minimal slice of Phase 7's `hls/playlist.ts` pulled forward: the
 * master playlist plus an `#EXTINF` summer for media playlists. Attribute values
 * are stored **verbatim** (surrounding quotes included) so serialization is
 * loss-free without re-deriving each attribute's quoting rules.
 *
 * Inner layer: imports `types/`/`validation/errors` only — never `core/`.
 */
import { PlaylistParseError } from "../validation/errors.js";

/** An ordered attribute list from an `EXT-X-*` tag; values kept verbatim (quotes included). */
export type Attributes = readonly (readonly [string, string])[];

/** A parsed `#EXT-X-MEDIA` alternate-rendition entry. */
export interface MediaRendition {
  readonly attributes: Attributes;
}

/** A parsed `#EXT-X-STREAM-INF` variant plus the URI line that follows it. */
export interface VariantStream {
  readonly attributes: Attributes;
  readonly uri: string;
}

/** The parsed model of a master playlist. */
export interface MasterPlaylist {
  /** `#EXT-X-VERSION` value, or `null` when the playlist omits it. */
  readonly version: number | null;
  /** `#EXT-X-MEDIA` alternate renditions, in file order. */
  readonly media: readonly MediaRendition[];
  /** `#EXT-X-STREAM-INF` variant streams, in file order. */
  readonly variants: readonly VariantStream[];
  /** Other top-level tags preserved verbatim (e.g. `#EXT-X-INDEPENDENT-SEGMENTS`). */
  readonly otherTags: readonly string[];
}

/** Options for adding one alternate-audio rendition to a master playlist. */
export interface AlternateAudioOptions {
  readonly groupId: string;
  readonly name: string;
  readonly language: string;
  /** Relative URI of the audio rendition's media playlist. */
  readonly uri: string;
  readonly isDefault: boolean;
  readonly autoselect: boolean;
  /** Channel count advertised via the `CHANNELS` attribute, when known. */
  readonly channels?: number;
}

/** Options for adding one alternate subtitle rendition to a master playlist. */
export interface AlternateSubtitleOptions {
  readonly groupId: string;
  readonly name: string;
  readonly language: string;
  /** Relative URI of the subtitle rendition's media playlist. */
  readonly uri: string;
  readonly isDefault: boolean;
  readonly autoselect: boolean;
  readonly forced: boolean;
}

const MEDIA_TAG = "#EXT-X-MEDIA:";
const STREAM_INF_TAG = "#EXT-X-STREAM-INF:";
const VERSION_TAG = "#EXT-X-VERSION:";
/** Alternate renditions require HLS protocol version ≥ 4. */
const MIN_ALTERNATE_RENDITION_VERSION = 4;

/** Split a source into lines, tolerating both `\n` and `\r\n`. */
function toLines(text: string): string[] {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/**
 * Split an attribute-list string on commas that are **not** inside a quoted
 * value, so `CODECS="avc1.4d401f,mp4a.40.2"` stays one attribute.
 */
function splitAttributes(list: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of list) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** Parse an `EXT-X-*` attribute list into ordered `[key, verbatim-value]` pairs. */
export function parseAttributeList(list: string): Attributes {
  const attributes: [string, string][] = [];
  for (const raw of splitAttributes(list)) {
    const part = raw.trim();
    if (part.length === 0) {
      continue;
    }
    const eq = part.indexOf("=");
    if (eq === -1) {
      throw new PlaylistParseError(`Malformed playlist attribute (no "="): "${part}".`);
    }
    attributes.push([part.slice(0, eq), part.slice(eq + 1)]);
  }
  return attributes;
}

/** Render ordered attributes back into a `KEY=VALUE,KEY=VALUE` string. */
export function formatAttributeList(attributes: Attributes): string {
  return attributes.map(([key, value]) => `${key}=${value}`).join(",");
}

/** Read one attribute's verbatim value (quotes included), or `undefined`. */
export function getAttribute(attributes: Attributes, key: string): string | undefined {
  return attributes.find(([k]) => k === key)?.[1];
}

/** Strip a single pair of surrounding double quotes from an attribute value. */
export function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

/** Upsert an attribute, preserving position when it already exists. */
function withAttribute(attributes: Attributes, key: string, value: string): Attributes {
  const next = attributes.map((pair) => pair);
  const index = next.findIndex(([k]) => k === key);
  if (index === -1) {
    return [...next, [key, value]];
  }
  next[index] = [key, value];
  return next;
}

/**
 * Parse a master playlist into its model. Throws `PlaylistParseError` when the
 * `#EXTM3U` header is missing, a `#EXT-X-STREAM-INF` has no following URI line,
 * or a bare URI appears with no preceding variant tag.
 */
export function parseMasterPlaylist(text: string): MasterPlaylist {
  const lines = toLines(text);
  const firstMeaningful = lines.find((line) => line.trim().length > 0)?.trim();
  if (firstMeaningful !== "#EXTM3U") {
    throw new PlaylistParseError('Not a valid m3u8: missing "#EXTM3U" header.');
  }

  let version: number | null = null;
  const media: MediaRendition[] = [];
  const variants: VariantStream[] = [];
  const otherTags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line.length === 0 || line === "#EXTM3U") {
      continue;
    }
    if (line.startsWith(VERSION_TAG)) {
      const parsed = Number.parseInt(line.slice(VERSION_TAG.length), 10);
      version = Number.isNaN(parsed) ? version : parsed;
      continue;
    }
    if (line.startsWith(MEDIA_TAG)) {
      media.push({ attributes: parseAttributeList(line.slice(MEDIA_TAG.length)) });
      continue;
    }
    if (line.startsWith(STREAM_INF_TAG)) {
      const attributes = parseAttributeList(line.slice(STREAM_INF_TAG.length));
      const uri = nextUri(lines, i);
      if (uri === null) {
        throw new PlaylistParseError("#EXT-X-STREAM-INF has no following URI line.");
      }
      variants.push({ attributes, uri: uri.value });
      i = uri.index;
      continue;
    }
    if (line.startsWith("#")) {
      otherTags.push(line);
      continue;
    }
    throw new PlaylistParseError(`Unexpected URI line with no preceding variant tag: "${line}".`);
  }

  return { version, media, variants, otherTags };
}

/** Find the next non-empty, non-comment line after `from` (the variant's URI). */
function nextUri(lines: string[], from: number): { value: string; index: number } | null {
  for (let i = from + 1; i < lines.length; i++) {
    const candidate = (lines[i] ?? "").trim();
    if (candidate.length === 0) {
      continue;
    }
    if (candidate.startsWith("#")) {
      return null;
    }
    return { value: candidate, index: i };
  }
  return null;
}

/** Serialize a master playlist model back to text (canonical tag order). */
export function serializeMasterPlaylist(playlist: MasterPlaylist): string {
  const lines: string[] = ["#EXTM3U"];
  if (playlist.version !== null) {
    lines.push(`${VERSION_TAG}${playlist.version}`);
  }
  lines.push(...playlist.otherTags);
  for (const rendition of playlist.media) {
    lines.push(`${MEDIA_TAG}${formatAttributeList(rendition.attributes)}`);
  }
  for (const variant of playlist.variants) {
    lines.push(`${STREAM_INF_TAG}${formatAttributeList(variant.attributes)}`);
    lines.push(variant.uri);
  }
  return `${lines.join("\n")}\n`;
}

/** Whether a variant advertises muxed AAC audio in its `CODECS` attribute. */
export function variantHasMuxedAudio(variant: VariantStream): boolean {
  const codecs = getAttribute(variant.attributes, "CODECS");
  return codecs !== undefined && unquote(codecs).toLowerCase().includes("mp4a");
}

/**
 * Add one alternate-audio rendition to a master playlist (pure). Appends an
 * `#EXT-X-MEDIA:TYPE=AUDIO` entry (reusing the same `GROUP-ID` across calls forms
 * a multi-language group), references the group from **every** variant via
 * `AUDIO="<groupId>"`, and bumps `EXT-X-VERSION` to at least 4. Existing media
 * and variants are preserved.
 */
export function addAlternateAudio(
  playlist: MasterPlaylist,
  options: AlternateAudioOptions,
): MasterPlaylist {
  // A DEFAULT rendition must also be AUTOSELECT=YES (RFC 8216 §4.3.4.1).
  const autoselect = options.autoselect || options.isDefault;
  const attributes: [string, string][] = [
    ["TYPE", "AUDIO"],
    ["GROUP-ID", `"${options.groupId}"`],
    ["NAME", `"${options.name}"`],
    ["LANGUAGE", `"${options.language}"`],
    ["DEFAULT", options.isDefault ? "YES" : "NO"],
    ["AUTOSELECT", autoselect ? "YES" : "NO"],
  ];
  if (options.channels !== undefined) {
    attributes.push(["CHANNELS", `"${options.channels}"`]);
  }
  attributes.push(["URI", `"${options.uri}"`]);

  return {
    version: Math.max(playlist.version ?? 0, MIN_ALTERNATE_RENDITION_VERSION),
    otherTags: playlist.otherTags,
    media: [...playlist.media, { attributes }],
    variants: playlist.variants.map((variant) => ({
      ...variant,
      attributes: withAttribute(variant.attributes, "AUDIO", `"${options.groupId}"`),
    })),
  };
}

/**
 * Add one WebVTT subtitle rendition and reference its group from every variant.
 * Reusing `groupId` across calls creates a multi-language subtitle group.
 */
export function addAlternateSubtitle(
  playlist: MasterPlaylist,
  options: AlternateSubtitleOptions,
): MasterPlaylist {
  const autoselect = options.autoselect || options.isDefault;
  const attributes: [string, string][] = [
    ["TYPE", "SUBTITLES"],
    ["GROUP-ID", `"${options.groupId}"`],
    ["NAME", `"${options.name}"`],
    ["LANGUAGE", `"${options.language}"`],
    ["DEFAULT", options.isDefault ? "YES" : "NO"],
    ["AUTOSELECT", autoselect ? "YES" : "NO"],
    ["FORCED", options.forced ? "YES" : "NO"],
    ["URI", `"${options.uri}"`],
  ];

  return {
    version: Math.max(playlist.version ?? 0, MIN_ALTERNATE_RENDITION_VERSION),
    otherTags: playlist.otherTags,
    media: [...playlist.media, { attributes }],
    variants: playlist.variants.map((variant) => ({
      ...variant,
      attributes: withAttribute(variant.attributes, "SUBTITLES", `"${options.groupId}"`),
    })),
  };
}

/**
 * Sum a media playlist's `#EXTINF` segment durations into milliseconds. Returns
 * `0` when the playlist has no `#EXTINF` lines. Pure — lets the audio use case
 * derive a variant's duration for the Task-4 sync check without a second ffprobe.
 */
export function sumMediaPlaylistDurationMs(text: string): number {
  let totalSeconds = 0;
  for (const line of toLines(text)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#EXTINF:")) {
      continue;
    }
    const seconds = Number.parseFloat(trimmed.slice("#EXTINF:".length));
    if (!Number.isNaN(seconds)) {
      totalSeconds += seconds;
    }
  }
  return Math.round(totalSeconds * 1000);
}
