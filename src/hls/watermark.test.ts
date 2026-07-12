import { describe, expect, it } from "vitest";
import { makeRendition } from "../../tests/fixtures/rendition.js";
import { asBitrate, asPixels } from "../types/brands.js";
import { normalizeWatermark } from "../validation/watermark.js";
import { buildHlsFilterGraph, watermarkCoordinates } from "./watermark.js";

const ladder = [
  makeRendition({ height: asPixels(720), videoBitrate: asBitrate(2_800_000) }),
  makeRendition({ height: asPixels(480), videoBitrate: asBitrate(1_400_000) }),
];

describe("watermarkCoordinates", () => {
  it.each([
    ["top-left", "top-left", "min(main_w\\,main_h)*0.03", "min(main_w\\,main_h)*0.03"],
    ["top", "top", "/2", "min(main_w\\,main_h)*0.03"],
    ["top-right", "top-right", "main_w-overlay_w", "min(main_w\\,main_h)*0.03"],
    ["left", "left", "min(main_w\\,main_h)*0.03", "/2"],
    ["center", "center", "/2", "/2"],
    ["right", "right", "main_w-overlay_w", "/2"],
    ["bottom-left", "bottom-left", "min(main_w\\,main_h)*0.03", "main_h-overlay_h"],
    ["bottom", "bottom", "/2", "main_h-overlay_h"],
    ["bottom-right", "bottom-right", "main_w-overlay_w", "main_h-overlay_h"],
  ] as const)("maps %s to the expected axes", (_, position, xPart, yPart) => {
    const coordinates = watermarkCoordinates(normalizeWatermark({ input: "logo.png", position }));
    expect(coordinates.x).toContain(xPart);
    expect(coordinates.y).toContain(yPart);
  });

  it("maps custom coordinates into the usable area", () => {
    const coordinates = watermarkCoordinates(
      normalizeWatermark({ input: "logo.png", position: { x: 0.25, y: 0.75 } }),
    );
    expect(coordinates.x).toContain("*0.25");
    expect(coordinates.y).toContain("*0.75");
  });

  it("uses a timestamp-driven triangular path for bounce motion", () => {
    const coordinates = watermarkCoordinates(
      normalizeWatermark({ input: "logo.png", motion: "bounce", speed: 0.5 }),
    );
    expect(coordinates.x).toContain("mod(t*0.5\\,1)");
    expect(coordinates.y).toContain("mod(t*0.5\\,1)");
  });
});

describe("buildHlsFilterGraph", () => {
  it("preserves the legacy graph when no watermark is configured", () => {
    expect(buildHlsFilterGraph(ladder, undefined, undefined)).toBe(
      "[0:v]split=2[v0][v1];[v0]scale=-2:720[vout0];[v1]scale=-2:480[vout1]",
    );
  });

  it("scales and overlays one watermark branch for every rendition", () => {
    const graph = buildHlsFilterGraph(
      ladder,
      24,
      normalizeWatermark({ input: "logo.png", relativeWidth: 0.25, position: "top-left" }),
    );
    expect(graph).toContain("[1:v]split=2[wm0][wm1]");
    expect(graph).toContain("[v0]fps=24,scale=-2:720,split=2[base0][ref0]");
    expect(graph).toContain("[wm1][ref1]scale=w=rw*0.25:h=ow/dar[scaledwm1]");
    expect(graph).toContain(
      "overlay=x=min(main_w\\,main_h)*0.03:y=min(main_w\\,main_h)*0.03:shortest=1[vout0]",
    );
  });

  it("uses safely escaped drawtext filters without a second image input", () => {
    const graph = buildHlsFilterGraph(
      ladder,
      undefined,
      normalizeWatermark({
        type: "text",
        text: "O'Reilly: VHJS",
        color: "#ff0000",
        position: "center",
      }),
    );
    expect(graph).not.toContain("[1:v]");
    expect(graph).toContain("drawtext=text='O\\'Reilly\\: VHJS'");
    expect(graph).toContain("fontcolor=0xff0000");
    expect(graph).toContain("expansion=none");
    expect(graph).toContain("text_w");
  });
});
