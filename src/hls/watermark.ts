/** Pure FFmpeg filter-graph decisions for optional image and text watermarks. */
import type { Rendition } from "../types/rendition.js";
import type { WatermarkPosition } from "../types/watermark.js";
import {
  isBouncingWatermark,
  isTextWatermark,
  type NormalizedBouncingTextWatermark,
  type NormalizedBouncingWatermark,
  type NormalizedStaticTextWatermark,
  type NormalizedStaticWatermark,
  type NormalizedWatermark,
} from "../validation/watermark.js";

type NormalizedImageWatermark = NormalizedStaticWatermark | NormalizedBouncingWatermark;
type NormalizedTextWatermark = NormalizedStaticTextWatermark | NormalizedBouncingTextWatermark;

/** Build the existing split/scale graph when a transcode has no watermark. */
function buildPlainFilterGraph(
  renditions: readonly Rendition[],
  frameRate: number | undefined,
): string {
  const labels = renditions.map((_, index) => `[v${index}]`).join("");
  const split = `[0:v]split=${renditions.length}${labels}`;
  const fps = frameRate === undefined ? "" : `fps=${frameRate},`;
  const scales = renditions.map(
    (rendition, index) => `[v${index}]${fps}scale=-2:${rendition.height}[vout${index}]`,
  );
  return [split, ...scales].join(";");
}

/** Build a graph that independently scales and overlays the watermark per rendition. */
function buildWatermarkedFilterGraph(
  renditions: readonly Rendition[],
  frameRate: number | undefined,
  watermark: NormalizedImageWatermark,
): string {
  const sourceLabels = renditions.map((_, index) => `[v${index}]`).join("");
  const watermarkLabels = renditions.map((_, index) => `[wm${index}]`).join("");
  const fps = frameRate === undefined ? "" : `fps=${frameRate},`;
  const { x, y } = watermarkCoordinates(watermark);
  const branches = renditions.flatMap((rendition, index) => [
    `[v${index}]${fps}scale=-2:${rendition.height}[base${index}]`,
    `[wm${index}][base${index}]scale2ref=w=iw*${watermark.relativeWidth}:h=-1[scaledwm${index}][scaledbase${index}]`,
    `[scaledbase${index}][scaledwm${index}]overlay=x=${x}:y=${y}:shortest=1[vout${index}]`,
  ]);
  return [
    `[0:v]split=${renditions.length}${sourceLabels}`,
    `[1:v]split=${renditions.length}${watermarkLabels}`,
    ...branches,
  ].join(";");
}

/** Build one `drawtext` branch for every scaled rendition. */
function buildTextFilterGraph(
  renditions: readonly Rendition[],
  frameRate: number | undefined,
  watermark: NormalizedTextWatermark,
): string {
  const labels = renditions.map((_, index) => `[v${index}]`).join("");
  const fps = frameRate === undefined ? "" : `fps=${frameRate},`;
  const { x, y } = watermarkCoordinates(watermark, {
    width: "w",
    height: "h",
    itemWidth: "text_w",
    itemHeight: "text_h",
  });
  const textOptions = [
    `text='${escapeDrawtextValue(watermark.text)}'`,
    ...(watermark.fontFile === undefined
      ? []
      : [`fontfile='${escapeDrawtextValue(watermark.fontFile)}'`]),
    `fontsize=h*${watermark.relativeFontSize}`,
    `fontcolor=${watermark.color}`,
    "expansion=none",
    `x=${x}`,
    `y=${y}`,
  ].join(":");
  const branches = renditions.map(
    (rendition, index) =>
      `[v${index}]${fps}scale=-2:${rendition.height},drawtext=${textOptions}[vout${index}]`,
  );
  return [`[0:v]split=${renditions.length}${labels}`, ...branches].join(";");
}

/** Build the HLS graph, preserving the exact legacy graph when no watermark is requested. */
export function buildHlsFilterGraph(
  renditions: readonly Rendition[],
  frameRate: number | undefined,
  watermark: NormalizedWatermark | undefined,
): string {
  return watermark === undefined
    ? buildPlainFilterGraph(renditions, frameRate)
    : isTextWatermark(watermark)
      ? buildTextFilterGraph(renditions, frameRate, watermark)
      : buildWatermarkedFilterGraph(renditions, frameRate, watermark);
}

/** Translate a validated request into FFmpeg's deterministic overlay expressions. */
export function watermarkCoordinates(
  watermark: NormalizedWatermark,
  variables: WatermarkCoordinateVariables = OVERLAY_VARIABLES,
): {
  readonly x: string;
  readonly y: string;
} {
  const margin = `min(${variables.width}\\,${variables.height})*${watermark.margin}`;
  const availableX = `(${variables.width}-${variables.itemWidth}-2*${margin})`;
  const availableY = `(${variables.height}-${variables.itemHeight}-2*${margin})`;

  if (isBouncingWatermark(watermark)) {
    const travel = `(1-abs(1-2*mod(t*${watermark.speed}\\,1)))`;
    return {
      x: `${margin}+${availableX}*${travel}`,
      y: `${margin}+${availableY}*${travel}`,
    };
  }
  if (typeof watermark.position === "object") {
    return {
      x: `${margin}+${availableX}*${watermark.position.x}`,
      y: `${margin}+${availableY}*${watermark.position.y}`,
    };
  }
  return presetCoordinates(watermark.position, margin, availableX, availableY);
}

/** Variable names exposed by FFmpeg filters that place an item inside a frame. */
interface WatermarkCoordinateVariables {
  readonly width: string;
  readonly height: string;
  readonly itemWidth: string;
  readonly itemHeight: string;
}

const OVERLAY_VARIABLES: WatermarkCoordinateVariables = {
  width: "main_w",
  height: "main_h",
  itemWidth: "overlay_w",
  itemHeight: "overlay_h",
};

/** Escape caller text for a single quoted FFmpeg drawtext option value. */
function escapeDrawtextValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll(":", "\\:")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

/** Map named locations to stable FFmpeg expressions. */
function presetCoordinates(
  position: WatermarkPosition,
  margin: string,
  availableX: string,
  availableY: string,
): { readonly x: string; readonly y: string } {
  const centerX = `${margin}+${availableX}/2`;
  const centerY = `${margin}+${availableY}/2`;
  switch (position) {
    case "top-left":
      return { x: margin, y: margin };
    case "top":
      return { x: centerX, y: margin };
    case "top-right":
      return { x: `${margin}+${availableX}`, y: margin };
    case "left":
      return { x: margin, y: centerY };
    case "center":
      return { x: centerX, y: centerY };
    case "right":
      return { x: `${margin}+${availableX}`, y: centerY };
    case "bottom-left":
      return { x: margin, y: `${margin}+${availableY}` };
    case "bottom":
      return { x: centerX, y: `${margin}+${availableY}` };
    case "bottom-right":
      return { x: `${margin}+${availableX}`, y: `${margin}+${availableY}` };
  }
}
