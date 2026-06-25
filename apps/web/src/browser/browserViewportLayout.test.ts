import { describe, expect, it } from "vite-plus/test";

import { resizeFreeformViewport, resolveBrowserViewportLayout } from "./browserViewportLayout";

describe("resolveBrowserViewportLayout", () => {
  it("fills the available surface in fill mode", () => {
    expect(resolveBrowserViewportLayout({ width: 700, height: 500 }, { _tag: "fill" })).toEqual({
      canvasWidth: 700,
      canvasHeight: 500,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 700,
      viewportHeight: 500,
      fillsPanel: true,
    });
  });

  it("centers a smaller fixed viewport", () => {
    expect(
      resolveBrowserViewportLayout(
        { width: 700, height: 1000 },
        { _tag: "freeform", width: 393, height: 852 },
      ),
    ).toMatchObject({
      canvasWidth: 700,
      canvasHeight: 1000,
      viewportX: 154,
      viewportY: 74,
      viewportWidth: 393,
      viewportHeight: 852,
    });
  });

  it("creates a scrollable canvas for a larger fixed viewport", () => {
    expect(
      resolveBrowserViewportLayout(
        { width: 600, height: 700 },
        { _tag: "freeform", width: 1440, height: 900 },
      ),
    ).toMatchObject({
      canvasWidth: 1440,
      canvasHeight: 900,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
  });

  it("keeps fixed dimensions in page CSS pixels when browser zoom changes", () => {
    expect(
      resolveBrowserViewportLayout(
        { width: 800, height: 700 },
        { _tag: "freeform", width: 400, height: 300 },
        1.5,
      ),
    ).toMatchObject({
      viewportX: 100,
      viewportY: 125,
      viewportWidth: 600,
      viewportHeight: 450,
    });
    expect(resizeFreeformViewport({ width: 400, height: 300 }, { x: 150, y: 75 }, 1.5)).toEqual({
      width: 500,
      height: 350,
    });
  });

  it("bounds freeform drag sizes and total render area", () => {
    expect(resizeFreeformViewport({ width: 1024, height: 768 }, { x: -2000, y: -2000 })).toEqual({
      width: 240,
      height: 240,
    });
    const large = resizeFreeformViewport({ width: 1920, height: 1080 }, { x: 2000, y: 2000 });
    expect(large.width * large.height).toBeLessThanOrEqual(3840 * 2160);
  });
});
