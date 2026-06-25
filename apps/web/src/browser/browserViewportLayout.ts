import {
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  type PreviewViewportSetting,
  type PreviewViewportSize,
} from "@t3tools/contracts";

export interface BrowserViewportLayout {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly fillsPanel: boolean;
}

export function resolveBrowserViewportLayout(
  container: { readonly width: number; readonly height: number },
  setting: PreviewViewportSetting,
  zoomFactor = 1,
): BrowserViewportLayout {
  const containerWidth = Math.max(1, Math.round(container.width));
  const containerHeight = Math.max(1, Math.round(container.height));
  if (setting._tag === "fill") {
    return {
      canvasWidth: containerWidth,
      canvasHeight: containerHeight,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: containerWidth,
      viewportHeight: containerHeight,
      fillsPanel: true,
    };
  }
  const normalizedZoomFactor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const renderedWidth = setting.width * normalizedZoomFactor;
  const renderedHeight = setting.height * normalizedZoomFactor;
  return {
    canvasWidth: Math.max(containerWidth, renderedWidth),
    canvasHeight: Math.max(containerHeight, renderedHeight),
    viewportX: Math.max(0, Math.round((containerWidth - renderedWidth) / 2)),
    viewportY: Math.max(0, Math.round((containerHeight - renderedHeight) / 2)),
    viewportWidth: renderedWidth,
    viewportHeight: renderedHeight,
    fillsPanel: false,
  };
}

const clampViewportDimension = (value: number): number =>
  Math.min(PREVIEW_VIEWPORT_MAX_DIMENSION, Math.max(PREVIEW_VIEWPORT_MIN_DIMENSION, value));

export function resizeFreeformViewport(
  start: PreviewViewportSize,
  delta: { readonly x: number; readonly y: number },
  zoomFactor = 1,
): PreviewViewportSize {
  const normalizedZoomFactor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  let width = clampViewportDimension(Math.round(start.width + delta.x / normalizedZoomFactor));
  let height = clampViewportDimension(Math.round(start.height + delta.y / normalizedZoomFactor));
  if (width * height <= PREVIEW_VIEWPORT_MAX_AREA) return { width, height };
  if (Math.abs(delta.x) >= Math.abs(delta.y)) {
    width = Math.max(
      PREVIEW_VIEWPORT_MIN_DIMENSION,
      Math.floor(PREVIEW_VIEWPORT_MAX_AREA / height),
    );
  } else {
    height = Math.max(
      PREVIEW_VIEWPORT_MIN_DIMENSION,
      Math.floor(PREVIEW_VIEWPORT_MAX_AREA / width),
    );
  }
  return { width, height };
}
