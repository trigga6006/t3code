import { describe, expect, it } from "vite-plus/test";

import {
  resizeBrowserViewportFromRail,
  resizeFreeformViewport,
  resolveBrowserDeviceViewportLayout,
  resolveBrowserViewportLayout,
  resolveResponsiveBrowserViewportSize,
} from "./browserViewportLayout";

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

  it("resizes only the axes controlled by each edge", () => {
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: -100, y: 500 }, 1, "west"),
    ).toEqual({ width: 900, height: 600 });
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: 500, y: 100 }, 1, "north"),
    ).toEqual({ width: 800, height: 500 });
    expect(
      resizeFreeformViewport({ width: 800, height: 600 }, { x: -100, y: -50 }, 1, "northwest"),
    ).toEqual({ width: 900, height: 650 });
  });

  it("reserves persistent device-toolbar rails around the guest viewport", () => {
    expect(
      resolveBrowserDeviceViewportLayout(
        { width: 1200, height: 900 },
        { _tag: "freeform", width: 1120, height: 818 },
      ),
    ).toEqual({
      canvasWidth: 1200,
      canvasHeight: 900,
      viewportX: 40,
      viewportY: 42,
      viewportWidth: 1120,
      viewportHeight: 818,
      fillsPanel: false,
    });
  });

  it("captures the available framed area when responsive mode is enabled", () => {
    expect(resolveResponsiveBrowserViewportSize({ width: 1200, height: 900 })).toEqual({
      width: 1120,
      height: 818,
    });
    expect(resolveResponsiveBrowserViewportSize({ width: 1200, height: 900 }, 2)).toEqual({
      width: 560,
      height: 409,
    });
  });

  it("keeps the grabbed rail under the pointer across centered layout boundaries", () => {
    const available = { width: 1120, height: 818 };
    expect(
      resizeBrowserViewportFromRail(
        { width: 1120, height: 818 },
        { x: -100, y: -50 },
        available,
        1,
        "southeast",
      ),
    ).toEqual({ width: 920, height: 718 });
    expect(
      resizeBrowserViewportFromRail(
        { width: 800, height: 600 },
        { x: 300, y: 0 },
        { width: 1200, height: 800 },
        1,
        "east",
      ),
    ).toEqual({ width: 1300, height: 600 });
    expect(
      resizeBrowserViewportFromRail(
        { width: 560, height: 409 },
        { x: -100, y: 0 },
        available,
        2,
        "east",
      ),
    ).toEqual({ width: 460, height: 409 });
  });
});
