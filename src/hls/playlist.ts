/**
 * HLS master-playlist parsing & generation — pure domain (no I/O, no spawning).
 *
 * VHJS's transcoder produces a master `.m3u8` with muxed-audio variants; Phase 5
 * needs to *patch* an existing master to add an alternate-audio rendition without
 * clobbering what is already there. That requires reading the existing variants
 * and rewriting their `EXT-X-STREAM-INF` lines, so a real parse → model → patch →
 * serialize round-trip is cleaner than blind text appending.
 *
 * This module supports both master and media playlists. Attribute values are
 * stored **verbatim** (surrounding quotes included) so serialization never has
 * to re-derive each attribute's quoting rules.
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

/** A parsed `#EXT-X-BYTERANGE`, with an absent offset kept as `null`. */
export interface ByteRange {
  readonly length: number;
  readonly offset: number | null;
}

/** A parsed `#EXT-X-KEY` attribute list. `METHOD=NONE` is represented by `null` on a segment. */
export interface MediaKey {
  readonly attributes: Attributes;
}

/** One `#EXTINF` entry and its media URI. */
export interface MediaSegment {
  /** Segment duration in seconds. */
  readonly duration: number;
  /** The optional `#EXTINF` title, including an intentionally empty title. */
  readonly title: string;
  readonly uri: string;
  readonly byteRange: ByteRange | null;
  /** The key in force for this segment, or `null` when it is unencrypted. */
  readonly key: MediaKey | null;
  /** Preserved tags immediately preceding this segment, e.g. discontinuities. */
  readonly tags: readonly string[];
}

/** The parsed model of an HLS media playlist. */
export interface MediaPlaylist {
  readonly version: number | null;
  readonly targetDuration: number | null;
  readonly mediaSequence: number | null;
  readonly playlistType: string | null;
  readonly segments: readonly MediaSegment[];
  /** Unrecognised tags before the first segment. */
  readonly otherTags: readonly string[];
  /** Unrecognised tags after the last segment, preserved before `#EXT-X-ENDLIST`. */
  readonly trailingTags: readonly string[];
  readonly hasEndList: boolean;
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

/** One alternate rendition removed from a master playlist. */
export interface RemovedAlternateRendition {
  readonly kind: "AUDIO" | "SUBTITLES";
  readonly groupId: string;
  readonly name: string;
  readonly uri: string;
}

const MEDIA_TAG = "#EXT-X-MEDIA:";
const STREAM_INF_TAG = "#EXT-X-STREAM-INF:";
const VERSION_TAG = "#EXT-X-VERSION:";
const TARGET_DURATION_TAG = "#EXT-X-TARGETDURATION:";
const MEDIA_SEQUENCE_TAG = "#EXT-X-MEDIA-SEQUENCE:";
const PLAYLIST_TYPE_TAG = "#EXT-X-PLAYLIST-TYPE:";
const EXTINF_TAG = "#EXTINF:";
const BYTE_RANGE_TAG = "#EXT-X-BYTERANGE:";
const KEY_TAG = "#EXT-X-KEY:";
const ENDLIST_TAG = "#EXT-X-ENDLIST";
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

/** Return an attribute list with `key` removed, preserving every other field. */
function withoutAttribute(attributes: Attributes, key: string): Attributes {
  return attributes.filter(([attributeKey]) => attributeKey !== key);
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

/** Parse a non-negative integer playlist field, with a useful typed failure. */
function parseNonNegativeInteger(value: string, tag: string): number {
  if (!/^\d+$/.test(value)) {
    throw new PlaylistParseError(
      `${tag} must contain a non-negative integer, received "${value}".`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new PlaylistParseError(`${tag} is outside JavaScript's safe integer range.`);
  }
  return parsed;
}

/** Parse the duration and optional title after `#EXTINF:`. */
function parseExtinf(value: string): { duration: number; title: string } {
  const comma = value.indexOf(",");
  if (comma === -1) {
    throw new PlaylistParseError("#EXTINF must contain a duration followed by a comma and title.");
  }
  const durationText = value.slice(0, comma).trim();
  const duration = Number(durationText);
  if (!Number.isFinite(duration) || duration < 0) {
    throw new PlaylistParseError(`#EXTINF has an invalid duration: "${durationText}".`);
  }
  return { duration, title: value.slice(comma + 1) };
}

/** Parse `length[@offset]` from an `#EXT-X-BYTERANGE` tag. */
function parseByteRange(value: string): ByteRange {
  const match = /^(\d+)(?:@(\d+))?$/.exec(value);
  if (match === null) {
    throw new PlaylistParseError(`#EXT-X-BYTERANGE is malformed: "${value}".`);
  }
  const length = parseNonNegativeInteger(match[1] ?? "", "#EXT-X-BYTERANGE length");
  const offsetText = match[2];
  return {
    length,
    offset:
      offsetText === undefined
        ? null
        : parseNonNegativeInteger(offsetText, "#EXT-X-BYTERANGE offset"),
  };
}

/** Return whether two possibly absent keys have the same ordered attributes. */
function sameKey(left: MediaKey | null, right: MediaKey | null): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null || left.attributes.length !== right.attributes.length) {
    return false;
  }
  return left.attributes.every(
    ([key, value], index) =>
      right.attributes[index]?.[0] === key && right.attributes[index]?.[1] === value,
  );
}

/** Serialize a media playlist model in canonical HLS order. */
export function serializeMediaPlaylist(playlist: MediaPlaylist): string {
  const lines: string[] = ["#EXTM3U"];
  if (playlist.version !== null) {
    lines.push(`${VERSION_TAG}${playlist.version}`);
  }
  if (playlist.targetDuration !== null) {
    lines.push(`${TARGET_DURATION_TAG}${playlist.targetDuration}`);
  }
  if (playlist.mediaSequence !== null) {
    lines.push(`${MEDIA_SEQUENCE_TAG}${playlist.mediaSequence}`);
  }
  if (playlist.playlistType !== null) {
    lines.push(`${PLAYLIST_TYPE_TAG}${playlist.playlistType}`);
  }
  lines.push(...playlist.otherTags);

  let previousKey: MediaKey | null = null;
  for (const segment of playlist.segments) {
    if (!sameKey(previousKey, segment.key)) {
      lines.push(
        segment.key === null
          ? `${KEY_TAG}METHOD=NONE`
          : `${KEY_TAG}${formatAttributeList(segment.key.attributes)}`,
      );
      previousKey = segment.key;
    }
    lines.push(...segment.tags);
    lines.push(`${EXTINF_TAG}${segment.duration},${segment.title}`);
    if (segment.byteRange !== null) {
      lines.push(
        `${BYTE_RANGE_TAG}${segment.byteRange.length}${
          segment.byteRange.offset === null ? "" : `@${segment.byteRange.offset}`
        }`,
      );
    }
    lines.push(segment.uri);
  }
  lines.push(...playlist.trailingTags);
  if (playlist.hasEndList) {
    lines.push(ENDLIST_TAG);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Parse a media playlist, including segments, byte ranges and the key in force
 * for each segment. Unknown tags are preserved either globally or alongside the
 * following segment, so valid playlists can be safely parsed and reserialized.
 */
export function parseMediaPlaylist(text: string): MediaPlaylist {
  const lines = toLines(text);
  const firstMeaningful = lines.find((line) => line.trim().length > 0)?.trim();
  if (firstMeaningful !== "#EXTM3U") {
    throw new PlaylistParseError('Not a valid m3u8: missing "#EXTM3U" header.');
  }

  let version: number | null = null;
  let targetDuration: number | null = null;
  let mediaSequence: number | null = null;
  let playlistType: string | null = null;
  let hasEndList = false;
  let activeKey: MediaKey | null = null;
  let pendingExtinf: { duration: number; title: string } | null = null;
  let pendingByteRange: ByteRange | null = null;
  const otherTags: string[] = [];
  const pendingTags: string[] = [];
  const segments: MediaSegment[] = [];

  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (line.length === 0 || line === "#EXTM3U") {
      continue;
    }
    if (hasEndList) {
      throw new PlaylistParseError("Playlist contains content after #EXT-X-ENDLIST.");
    }
    if (line.startsWith(VERSION_TAG)) {
      version = parseNonNegativeInteger(line.slice(VERSION_TAG.length), "#EXT-X-VERSION");
      continue;
    }
    if (line.startsWith(TARGET_DURATION_TAG)) {
      targetDuration = parseNonNegativeInteger(
        line.slice(TARGET_DURATION_TAG.length),
        "#EXT-X-TARGETDURATION",
      );
      continue;
    }
    if (line.startsWith(MEDIA_SEQUENCE_TAG)) {
      mediaSequence = parseNonNegativeInteger(
        line.slice(MEDIA_SEQUENCE_TAG.length),
        "#EXT-X-MEDIA-SEQUENCE",
      );
      continue;
    }
    if (line.startsWith(PLAYLIST_TYPE_TAG)) {
      playlistType = line.slice(PLAYLIST_TYPE_TAG.length);
      if (playlistType.length === 0) {
        throw new PlaylistParseError("#EXT-X-PLAYLIST-TYPE cannot be empty.");
      }
      continue;
    }
    if (line.startsWith(KEY_TAG)) {
      const attributes = parseAttributeList(line.slice(KEY_TAG.length));
      const method = getAttribute(attributes, "METHOD");
      if (method === undefined) {
        throw new PlaylistParseError("#EXT-X-KEY must include METHOD.");
      }
      activeKey = method === "NONE" ? null : { attributes };
      continue;
    }
    if (line.startsWith(EXTINF_TAG)) {
      if (pendingExtinf !== null) {
        throw new PlaylistParseError("#EXTINF has no following segment URI.");
      }
      pendingExtinf = parseExtinf(line.slice(EXTINF_TAG.length));
      continue;
    }
    if (line.startsWith(BYTE_RANGE_TAG)) {
      if (pendingExtinf === null || pendingByteRange !== null) {
        throw new PlaylistParseError(
          "#EXT-X-BYTERANGE must appear once after #EXTINF and before its URI.",
        );
      }
      pendingByteRange = parseByteRange(line.slice(BYTE_RANGE_TAG.length));
      continue;
    }
    if (line === ENDLIST_TAG) {
      if (pendingExtinf !== null) {
        throw new PlaylistParseError("#EXTINF has no following segment URI.");
      }
      hasEndList = true;
      continue;
    }
    if (line.startsWith("#")) {
      if (segments.length === 0 && pendingExtinf === null) {
        otherTags.push(line);
      } else {
        pendingTags.push(line);
      }
      continue;
    }
    if (pendingExtinf === null) {
      throw new PlaylistParseError(`Unexpected segment URI without #EXTINF: "${line}".`);
    }
    segments.push({
      duration: pendingExtinf.duration,
      title: pendingExtinf.title,
      uri: line,
      byteRange: pendingByteRange,
      key: activeKey,
      tags: [...pendingTags],
    });
    pendingExtinf = null;
    pendingByteRange = null;
    pendingTags.length = 0;
  }

  if (pendingExtinf !== null) {
    throw new PlaylistParseError("#EXTINF has no following segment URI.");
  }
  return {
    version,
    targetDuration,
    mediaSequence,
    playlistType,
    segments,
    otherTags,
    trailingTags: pendingTags,
    hasEndList,
  };
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
 * Remove one alternate audio or subtitle rendition. If the removed rendition
 * was the last member of its group, the matching group reference is also
 * removed from every variant; otherwise the remaining group members continue
 * to be referenced. The source model is never mutated.
 */
export function removeAlternateRendition(
  playlist: MasterPlaylist,
  kind: "AUDIO" | "SUBTITLES",
  groupId: string,
  name: string,
): { readonly playlist: MasterPlaylist; readonly removed: RemovedAlternateRendition | null } {
  const matching = (rendition: MediaRendition): boolean =>
    getAttribute(rendition.attributes, "TYPE") === kind &&
    unquote(getAttribute(rendition.attributes, "GROUP-ID") ?? "") === groupId &&
    unquote(getAttribute(rendition.attributes, "NAME") ?? "") === name;
  const removedRendition = playlist.media.find(matching);
  if (removedRendition === undefined) {
    return { playlist, removed: null };
  }
  const uri = getAttribute(removedRendition.attributes, "URI");
  if (uri === undefined) {
    throw new PlaylistParseError(`Alternate ${kind.toLowerCase()} rendition has no URI.`);
  }
  const media = playlist.media.filter((rendition) => rendition !== removedRendition);
  const groupStillExists = media.some(
    (rendition) =>
      getAttribute(rendition.attributes, "TYPE") === kind &&
      unquote(getAttribute(rendition.attributes, "GROUP-ID") ?? "") === groupId,
  );
  const variants = groupStillExists
    ? playlist.variants
    : playlist.variants.map((variant) => {
        const reference = getAttribute(variant.attributes, kind);
        return reference !== undefined && unquote(reference) === groupId
          ? { ...variant, attributes: withoutAttribute(variant.attributes, kind) }
          : variant;
      });
  return {
    playlist: { ...playlist, media, variants },
    removed: { kind, groupId, name, uri: unquote(uri) },
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
