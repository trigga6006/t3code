import { describe, expect, it } from "vite-plus/test";

import {
  previewViewportLabel,
  previewViewportPresetOrientation,
  resolvePreviewViewport,
} from "./previewViewport.ts";

describe("previewViewport", () => {
  it("resolves fill and exact freeform viewports", () => {
    expect(resolvePreviewViewport({ mode: "fill" })).toEqual({ _tag: "fill" });
    expect(resolvePreviewViewport({ mode: "freeform", width: 1024, height: 768 })).toEqual({
      _tag: "freeform",
      width: 1024,
      height: 768,
    });
  });

  it("resolves device presets in either orientation", () => {
    expect(resolvePreviewViewport({ mode: "preset", preset: "iphone-15-pro" })).toEqual({
      _tag: "preset",
      width: 393,
      height: 852,
      presetId: "iphone-15-pro",
    });
    expect(
      resolvePreviewViewport({
        mode: "preset",
        preset: "iphone-15-pro",
        orientation: "landscape",
      }),
    ).toEqual({
      _tag: "preset",
      width: 852,
      height: 393,
      presetId: "iphone-15-pro",
    });
  });

  it("formats settings for compact UI", () => {
    expect(previewViewportLabel({ _tag: "fill" })).toBe("Fill panel");
    expect(previewViewportLabel({ _tag: "freeform", width: 393, height: 852 })).toBe("393 × 852");
    expect(previewViewportPresetOrientation({ _tag: "freeform", width: 852, height: 393 })).toBe(
      "landscape",
    );
  });
});
