/**
 * `SourceMetadata` factory for tests. Produces a realistic 1080p H.264 + stereo
 * AAC source by default; pass `overrides` to shape a specific scenario (the
 * validation-rule tests in Phase 2 lean on this heavily).
 */
import { asBitrate, asFrameRate, asMilliseconds, asPixels } from "../../src/types/brands.js";
import type { SourceMetadata } from "../../src/types/metadata.js";

export function makeSourceMetadata(overrides: Partial<SourceMetadata> = {}): SourceMetadata {
  return {
    durationMs: asMilliseconds(60_000),
    formatBitrate: asBitrate(5_200_000),
    video: [
      {
        index: 0,
        codec: "h264",
        width: asPixels(1920),
        height: asPixels(1080),
        rotation: 0,
        bitrate: asBitrate(5_000_000),
        frameRate: asFrameRate(30),
      },
    ],
    audio: [
      {
        index: 1,
        codec: "aac",
        bitrate: asBitrate(128_000),
        channels: 2,
        sampleRate: 48_000,
        language: "eng",
      },
    ],
    subtitle: [],
    ...overrides,
  };
}
