/** Pure validation and defaulting for public image and text watermark requests. */
import type {
  CustomWatermarkPosition,
  ImageWatermarkConfig,
  TextWatermarkConfig,
  WatermarkConfig,
  WatermarkPosition,
} from "../types/watermark.js";
import { WATERMARK_POSITIONS } from "../types/watermark.js";
import { InvalidWatermarkOptionsError } from "./errors.js";

/** Defaults used when watermark options are omitted. */
export const DEFAULT_WATERMARK_OPTIONS = {
  relativeWidth: 0.15,
  margin: 0.03,
  position: "bottom-right" satisfies WatermarkPosition,
  speed: 0.1,
  relativeFontSize: 0.05,
  color: "white",
} as const;

interface NormalizedWatermarkBase {
  readonly input: string;
  readonly relativeWidth: number;
  readonly margin: number;
}

/** A validated static watermark with all defaults materialized. */
export interface NormalizedStaticWatermark extends NormalizedWatermarkBase {
  readonly motion: "static";
  readonly position: WatermarkPosition | CustomWatermarkPosition;
}

/** A validated animated watermark with all defaults materialized. */
export interface NormalizedBouncingWatermark extends NormalizedWatermarkBase {
  readonly motion: "bounce";
  readonly speed: number;
}

interface NormalizedTextWatermarkBase {
  readonly type: "text";
  readonly text: string;
  readonly relativeFontSize: number;
  readonly color: string;
  readonly margin: number;
  readonly fontFile?: string;
}

/** A validated static text watermark with all defaults materialized. */
export interface NormalizedStaticTextWatermark extends NormalizedTextWatermarkBase {
  readonly motion: "static";
  readonly position: WatermarkPosition | CustomWatermarkPosition;
}

/** A validated animated text watermark with all defaults materialized. */
export interface NormalizedBouncingTextWatermark extends NormalizedTextWatermarkBase {
  readonly motion: "bounce";
  readonly speed: number;
}

/** A validated image or text watermark ready for deterministic graph construction. */
export type NormalizedWatermark =
  | NormalizedStaticWatermark
  | NormalizedBouncingWatermark
  | NormalizedStaticTextWatermark
  | NormalizedBouncingTextWatermark;

/** Validate and fill defaults for an image watermark without any I/O. */
export function normalizeWatermark(config: WatermarkConfig): NormalizedWatermark {
  if (isTextWatermarkConfig(config)) {
    return normalizeTextWatermark(config);
  }
  return normalizeImageWatermark(config);
}

/** Narrow the public union before dispatching to image or text normalization. */
function isTextWatermarkConfig(config: WatermarkConfig): config is TextWatermarkConfig {
  return "type" in config && config.type === "text";
}

/** Validate and default an image-overlay watermark. */
function normalizeImageWatermark(config: ImageWatermarkConfig): NormalizedWatermark {
  if (config.input.trim().length === 0) {
    throw new InvalidWatermarkOptionsError("input must be a non-empty image path");
  }

  const relativeWidth = config.relativeWidth ?? DEFAULT_WATERMARK_OPTIONS.relativeWidth;
  const margin = config.margin ?? DEFAULT_WATERMARK_OPTIONS.margin;
  assertFraction(relativeWidth, "relativeWidth", false);
  assertFraction(margin, "margin", true);
  if (relativeWidth + margin * 2 > 1) {
    throw new InvalidWatermarkOptionsError(
      "relativeWidth plus twice the margin must not exceed the rendition width",
    );
  }

  if (config.motion === "bounce") {
    const speed = config.speed ?? DEFAULT_WATERMARK_OPTIONS.speed;
    assertFraction(speed, "speed", false);
    return { input: config.input, relativeWidth, margin, motion: "bounce", speed };
  }

  return {
    input: config.input,
    relativeWidth,
    margin,
    motion: "static",
    position: normalizePosition(config.position),
  };
}

/** Validate and default a `drawtext` watermark. */
function normalizeTextWatermark(config: TextWatermarkConfig): NormalizedWatermark {
  if (config.text.trim().length === 0) {
    throw new InvalidWatermarkOptionsError("text must be non-empty");
  }
  if (config.fontFile !== undefined && config.fontFile.trim().length === 0) {
    throw new InvalidWatermarkOptionsError("fontFile must be a non-empty path when supplied");
  }

  const relativeFontSize = config.relativeFontSize ?? DEFAULT_WATERMARK_OPTIONS.relativeFontSize;
  const margin = config.margin ?? DEFAULT_WATERMARK_OPTIONS.margin;
  const color = normalizeTextColor(config.color ?? DEFAULT_WATERMARK_OPTIONS.color);
  assertFraction(relativeFontSize, "relativeFontSize", false);
  assertFraction(margin, "margin", true);

  if (config.motion === "bounce") {
    const speed = config.speed ?? DEFAULT_WATERMARK_OPTIONS.speed;
    assertFraction(speed, "speed", false);
    return {
      type: "text",
      text: config.text,
      relativeFontSize,
      color,
      margin,
      ...(config.fontFile === undefined ? {} : { fontFile: config.fontFile }),
      motion: "bounce",
      speed,
    };
  }

  return {
    type: "text",
    text: config.text,
    relativeFontSize,
    color,
    margin,
    ...(config.fontFile === undefined ? {} : { fontFile: config.fontFile }),
    motion: "static",
    position: normalizePosition(config.position),
  };
}

/** Assert a finite normalized value, allowing zero only for margins/coordinates. */
function assertFraction(value: number, name: string, allowZero: boolean): void {
  if (!Number.isFinite(value) || value > 1 || (allowZero ? value < 0 : value <= 0)) {
    throw new InvalidWatermarkOptionsError(
      `${name} must be a finite number in ${allowZero ? "[0, 1]" : "(0, 1]"}`,
    );
  }
}

/** Validate a named or normalized custom placement. */
function normalizePosition(
  position: WatermarkPosition | CustomWatermarkPosition | undefined,
): WatermarkPosition | CustomWatermarkPosition {
  const resolved = position ?? DEFAULT_WATERMARK_OPTIONS.position;
  if (typeof resolved === "string") {
    if (!(WATERMARK_POSITIONS as readonly string[]).includes(resolved)) {
      throw new InvalidWatermarkOptionsError(
        `position must be one of: ${WATERMARK_POSITIONS.join(", ")}`,
      );
    }
    return resolved;
  }
  assertFraction(resolved.x, "position.x", true);
  assertFraction(resolved.y, "position.y", true);
  return resolved;
}

/** Reject color values that could alter the surrounding FFmpeg filter graph. */
function normalizeTextColor(color: string): string {
  if (!/^(?:[a-zA-Z]+|#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)$/.test(color)) {
    throw new InvalidWatermarkOptionsError(
      "color must be a named FFmpeg color or a #RRGGBB/#RRGGBBAA value",
    );
  }
  return color.startsWith("#") ? `0x${color.slice(1)}` : color;
}

/** Narrowing helper kept separate so TypeScript preserves the discriminated branch. */
export function isBouncingWatermark(
  watermark: NormalizedWatermark,
): watermark is NormalizedBouncingWatermark | NormalizedBouncingTextWatermark {
  return watermark.motion === "bounce";
}

/** Narrow a normalized request to text-rendering rather than image-overlay mode. */
export function isTextWatermark(
  watermark: NormalizedWatermark,
): watermark is NormalizedStaticTextWatermark | NormalizedBouncingTextWatermark {
  return "type" in watermark && watermark.type === "text";
}
