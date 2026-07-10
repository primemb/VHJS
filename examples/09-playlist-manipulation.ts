/**
 * Parse, inspect, and safely reserialize an HLS media playlist.
 *
 * This is pure playlist work: it needs no FFmpeg or media files.
 * Run: `pnpm example 09-playlist-manipulation`
 */
import { parseMediaPlaylist, serializeMediaPlaylist } from "vhjs";

const playlistText = [
  "#EXTM3U",
  "#EXT-X-VERSION:4",
  "#EXT-X-TARGETDURATION:6",
  '#EXT-X-KEY:METHOD=AES-128,URI="keys/video.key"',
  "#EXTINF:6,Opening",
  "#EXT-X-BYTERANGE:1200@0",
  "video.ts",
  "#EXTINF:4.5,",
  "#EXT-X-BYTERANGE:900",
  "video.ts",
  "#EXT-X-KEY:METHOD=NONE",
  "#EXTINF:3,Closing",
  "closing.ts",
  "#EXT-X-ENDLIST",
].join("\n");

const playlist = parseMediaPlaylist(playlistText);

console.log(`Segments: ${playlist.segments.length}`);
console.log(`Target duration: ${playlist.targetDuration ?? "not declared"} seconds`);

for (const [index, segment] of playlist.segments.entries()) {
  const range =
    segment.byteRange === null
      ? "whole resource"
      : `${segment.byteRange.length} bytes${
          segment.byteRange.offset === null
            ? " (implicit offset)"
            : ` at ${segment.byteRange.offset}`
        }`;
  const method = segment.key?.attributes.find(([name]) => name === "METHOD")?.[1] ?? "NONE";
  console.log(`${index}: ${segment.duration}s, ${segment.uri}, ${range}, encryption: ${method}`);
}

// `serializeMediaPlaylist` emits a canonical playlist while preserving the
// parsed segment information, byte ranges, key transitions, and unknown tags.
console.log("\nCanonical playlist:\n");
console.log(serializeMediaPlaylist(playlist));
