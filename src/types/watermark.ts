/**
 * Public configuration for an image watermark applied while transcoding HLS.
 *
 * The watermark is scaled and positioned separately for each rendition, so a
 * single request remains proportionate across an adaptive-bitrate ladder.
 */

/** Named locations for a static watermark. */
export const WATERMARK_POSITIONS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;

/** A named static watermark location. */
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

/**
 * A custom static location. Both values are normalized within the usable area
 * after the configured margin: `0` is the top/left edge and `1` is the
 * bottom/right edge.
 */
export interface CustomWatermarkPosition {
  readonly x: number;
  readonly y: number;
}

/** Options shared by fixed and animated image watermarks. */
interface WatermarkOptionsBase {
  /** Path to an image FFmpeg can decode, such as PNG, WebP, or JPEG. */
  readonly input: string;
  /** Fraction of each rendition's width occupied by the watermark (default `0.15`). */
  readonly relativeWidth?: number;
  /** Fraction of the shorter rendition side reserved at each edge (default `0.03`). */
  readonly margin?: number;
}

/** A watermark that stays in one named or custom location. */
export interface StaticWatermarkConfig extends WatermarkOptionsBase {
  /** Static is the default when motion is omitted. */
  readonly motion?: "static";
  /** Static placement; defaults to `bottom-right`. */
  readonly position?: WatermarkPosition | CustomWatermarkPosition;
}

/** A watermark that continually bounces between opposite corners. */
export interface BouncingWatermarkConfig extends WatermarkOptionsBase {
  readonly motion: "bounce";
  /** Complete corner-to-corner-and-back cycles per second (default `0.1`). */
  readonly speed?: number;
}

/** An image watermark for an HLS transcode. */
export type ImageWatermarkConfig = StaticWatermarkConfig | BouncingWatermarkConfig;

/** Options shared by fixed and animated text watermarks. */
interface TextWatermarkOptionsBase {
  /** Discriminant selecting FFmpeg's `drawtext` filter instead of an image overlay. */
  readonly type: "text";
  /** Text to render; literal text is used without FFmpeg expansion. */
  readonly text: string;
  /** Optional font file for reproducible rendering across hosts. */
  readonly fontFile?: string;
  /** Fraction of each rendition's height used as font size (default `0.05`). */
  readonly relativeFontSize?: number;
  /** FFmpeg color name or `#RRGGBB`/`#RRGGBBAA` value (default `white`). */
  readonly color?: string;
  /** Fraction of the shorter rendition side reserved at each edge (default `0.03`). */
  readonly margin?: number;
}

/** Text that stays in one named or custom location. */
export interface StaticTextWatermarkConfig extends TextWatermarkOptionsBase {
  /** Static is the default when motion is omitted. */
  readonly motion?: "static";
  /** Static placement; defaults to `bottom-right`. */
  readonly position?: WatermarkPosition | CustomWatermarkPosition;
}

/** Text that continually bounces between opposite corners. */
export interface BouncingTextWatermarkConfig extends TextWatermarkOptionsBase {
  readonly motion: "bounce";
  /** Complete corner-to-corner-and-back cycles per second (default `0.1`). */
  readonly speed?: number;
}

/** A text watermark for an HLS transcode. */
export type TextWatermarkConfig = StaticTextWatermarkConfig | BouncingTextWatermarkConfig;

/** An optional image or text watermark for an HLS transcode. */
export type WatermarkConfig = ImageWatermarkConfig | TextWatermarkConfig;
