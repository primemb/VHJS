/**
 * ABR ladder — build and normalize the set of renditions a job will encode.
 *
 * Two pure operations (no I/O, no FFmpeg — this is domain logic):
 *  - `autoLadder(source)` derives a sensible default ladder from the source:
 *    the standard rungs at or below the source height, with target bitrates
 *    pre-clamped to the source so they never overshoot.
 *  - `normalizeLadder(requested, source)` validates each requested rung against
 *    the source (delegating to `validation/rules`), applies bitrate clamping,
 *    drops duplicate heights, and returns the rungs sorted highest-first plus the
 *    accumulated warnings.
 *
 * Inner layer (use-case-adjacent domain): imports `types/` + `validation/` only,
 * never `core/`.
 */
import { asBitrate, asPixels, type Bitrate } from "../types/brands.js";
import type { SourceMetadata } from "../types/metadata.js";
import { displayDimensions } from "../types/orientation.js";
import { type Rendition, renditionName } from "../types/rendition.js";
import type { ValidationWarning } from "../types/warnings.js";
import {
  type BitratePolicy,
  DEFAULT_BITRATE_POLICY,
  primaryVideoStream,
  validateRendition,
} from "../validation/rules.js";

/** One standard rung: a target height and its typical H.264/AAC bitrates. */
interface LadderRung {
  readonly height: number;
  readonly videoBitrate: number;
  readonly audioBitrate: number;
}

/**
 * Standard ABR rungs (highest first). Bitrates are conventional H.264 web
 * targets; `autoLadder` clamps them down to the source so a low-bitrate source
 * never gets an inflated ladder.
 */
const STANDARD_RUNGS: readonly LadderRung[] = [
  { height: 2160, videoBitrate: 14_000_000, audioBitrate: 192_000 },
  { height: 1080, videoBitrate: 5_000_000, audioBitrate: 128_000 },
  { height: 720, videoBitrate: 2_800_000, audioBitrate: 128_000 },
  { height: 480, videoBitrate: 1_400_000, audioBitrate: 96_000 },
  { height: 360, videoBitrate: 800_000, audioBitrate: 96_000 },
  { height: 240, videoBitrate: 400_000, audioBitrate: 64_000 },
];

/** The normalized ladder plus any advisories raised while building it. */
export interface NormalizedLadder {
  readonly renditions: readonly Rendition[];
  readonly warnings: readonly ValidationWarning[];
}

/** Min of a target and an optional source reference (keeps the target if unknown). */
function capBitrate(target: number, reference: Bitrate | null): Bitrate {
  return asBitrate(reference === null ? target : Math.min(target, reference));
}

/**
 * Derive a default ABR ladder from the source: every standard rung at or below
 * the source height, with bitrates clamped to the source so nothing overshoots.
 * Always yields at least one rung (a single rung at the source height for very
 * small sources below the smallest standard rung).
 */
export function autoLadder(source: SourceMetadata): Rendition[] {
  const video = primaryVideoStream(source);
  const videoRef = video.bitrate ?? source.formatBitrate;
  const audioRef = source.audio[0]?.bitrate ?? null;

  // Key rungs off the *displayed* height: a rotated portrait clip stored as
  // 1920x1080 displays 1080 wide x 1920 tall, so its ladder tops out at 1920.
  const displayHeight = displayDimensions(video).height;
  const rungs = STANDARD_RUNGS.filter((rung) => rung.height <= displayHeight);
  const chosen =
    rungs.length > 0
      ? rungs
      : [{ height: displayHeight, videoBitrate: 400_000, audioBitrate: 64_000 }];

  return chosen.map((rung) => ({
    height: asPixels(rung.height),
    videoBitrate: capBitrate(rung.videoBitrate, videoRef),
    audioBitrate: capBitrate(rung.audioBitrate, audioRef),
    videoCodec: "h264",
    audioCodec: "aac",
  }));
}

/**
 * Validate and normalize a requested ladder against the source: clamp bitrates,
 * reject upscales / unsupported codecs (via `validateRendition`), drop duplicate
 * heights (warned as redundant), and sort the survivors highest-first.
 */
export function normalizeLadder(
  requested: readonly Rendition[],
  source: SourceMetadata,
  policy: BitratePolicy = DEFAULT_BITRATE_POLICY,
): NormalizedLadder {
  const warnings: ValidationWarning[] = [];
  const byHeight = new Map<number, Rendition>();

  for (const rung of requested) {
    const { rendition, warnings: rungWarnings } = validateRendition(rung, source, policy);
    warnings.push(...rungWarnings);

    if (byHeight.has(rendition.height)) {
      warnings.push({
        code: "REDUNDANT_RENDITION",
        message: `Dropped a duplicate ${renditionName(rendition)} rendition; keeping the first.`,
      });
      continue;
    }
    byHeight.set(rendition.height, rendition);
  }

  const renditions = [...byHeight.values()].sort((a, b) => b.height - a.height);
  return { renditions, warnings };
}
