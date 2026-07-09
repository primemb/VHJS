/**
 * `Rendition` factory for tests. Defaults to a 1080p H.264 + AAC rung matching
 * the default `makeSourceMetadata` source; pass `overrides` to shape a rung.
 */
import { asBitrate, asPixels } from "../../src/types/brands.js";
import type { Rendition } from "../../src/types/rendition.js";

export function makeRendition(overrides: Partial<Rendition> = {}): Rendition {
  return {
    height: asPixels(1080),
    videoBitrate: asBitrate(5_000_000),
    audioBitrate: asBitrate(128_000),
    videoCodec: "h264",
    audioCodec: "aac",
    ...overrides,
  };
}
