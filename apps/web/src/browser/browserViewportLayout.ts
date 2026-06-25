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

export const BROWSER_DEVICE_TOOLBAR_HEIGHT = 42;
export const BROWSER_VIEWPORT_RESIZE_RAIL_SIZE = 40;

export type BrowserViewportResizeDirection =
  | "north"
  | "northeast"
  | "east"
  | "southeast"
  | "south"
  | "southwest"
  | "west"
  | "northwest";

const normalizeZoomFactor = (zoomFactor: number): number =>
  Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;

export function resolveBrowserDeviceViewportArea(container: {
  readonly width: number;
  readonly height: number;
}): PreviewViewportSize {
  return {
    width: Math.max(1, container.width - BROWSER_VIEWPORT_RESIZE_RAIL_SIZE * 2),
    height: Math.max(
      1,
      container.height - BROWSER_DEVICE_TOOLBAR_HEIGHT - BROWSER_VIEWPORT_RESIZE_RAIL_SIZE,
    ),
  };
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
  const normalizedZoomFactor = normalizeZoomFactor(zoomFactor);
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

export function resolveBrowserDeviceViewportLayout(
  container: { readonly width: number; readonly height: number },
  setting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>,
  zoomFactor = 1,
): BrowserViewportLayout {
  const layout = resolveBrowserViewportLayout(
    resolveBrowserDeviceViewportArea(container),
    setting,
    zoomFactor,
  );
  return {
    ...layout,
    canvasWidth: layout.canvasWidth + BROWSER_VIEWPORT_RESIZE_RAIL_SIZE * 2,
    canvasHeight:
      layout.canvasHeight + BROWSER_DEVICE_TOOLBAR_HEIGHT + BROWSER_VIEWPORT_RESIZE_RAIL_SIZE,
    viewportX: layout.viewportX + BROWSER_VIEWPORT_RESIZE_RAIL_SIZE,
    viewportY: layout.viewportY + BROWSER_DEVICE_TOOLBAR_HEIGHT,
  };
}

const clampViewportDimension = (value: number): number =>
  Math.min(PREVIEW_VIEWPORT_MAX_DIMENSION, Math.max(PREVIEW_VIEWPORT_MIN_DIMENSION, value));

export function resizeFreeformViewport(
  start: PreviewViewportSize,
  delta: { readonly x: number; readonly y: number },
  zoomFactor = 1,
  direction: BrowserViewportResizeDirection = "southeast",
): PreviewViewportSize {
  const normalizedZoomFactor = normalizeZoomFactor(zoomFactor);
  const horizontalDelta = direction.includes("east")
    ? delta.x
    : direction.includes("west")
      ? -delta.x
      : 0;
  const verticalDelta = direction.includes("south")
    ? delta.y
    : direction.includes("north")
      ? -delta.y
      : 0;
  let width = clampViewportDimension(
    Math.round(start.width + horizontalDelta / normalizedZoomFactor),
  );
  let height = clampViewportDimension(
    Math.round(start.height + verticalDelta / normalizedZoomFactor),
  );
  if (width * height <= PREVIEW_VIEWPORT_MAX_AREA) return { width, height };
  if (Math.abs(horizontalDelta) >= Math.abs(verticalDelta)) {
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

const resizeFromEndRail = (start: number, pointerDelta: number, available: number): number => {
  const startEdge = start < available ? (available + start) / 2 : start;
  const targetEdge = startEdge + pointerDelta;
  return targetEdge <= available ? targetEdge * 2 - available : targetEdge;
};

const resizeFromStartRail = (start: number, pointerDelta: number, available: number): number => {
  if (start > available) {
    const distanceToFit = start - available;
    return pointerDelta <= distanceToFit
      ? start - pointerDelta
      : available - (pointerDelta - distanceToFit) * 2;
  }
  const targetEdge = (available - start) / 2 + pointerDelta;
  return targetEdge >= 0 ? available - targetEdge * 2 : available - targetEdge;
};

export function resizeBrowserViewportFromRail(
  start: PreviewViewportSize,
  pointerDelta: { readonly x: number; readonly y: number },
  available: PreviewViewportSize,
  zoomFactor = 1,
  direction: BrowserViewportResizeDirection = "southeast",
): PreviewViewportSize {
  const normalizedZoomFactor = normalizeZoomFactor(zoomFactor);
  const startWidth = start.width * normalizedZoomFactor;
  const startHeight = start.height * normalizedZoomFactor;
  const desiredWidth = direction.includes("east")
    ? resizeFromEndRail(startWidth, pointerDelta.x, available.width)
    : direction.includes("west")
      ? resizeFromStartRail(startWidth, pointerDelta.x, available.width)
      : startWidth;
  const desiredHeight = direction.includes("south")
    ? resizeFromEndRail(startHeight, pointerDelta.y, available.height)
    : direction.includes("north")
      ? resizeFromStartRail(startHeight, pointerDelta.y, available.height)
      : startHeight;
  const widthDelta = desiredWidth - startWidth;
  const heightDelta = desiredHeight - startHeight;
  return resizeFreeformViewport(
    start,
    {
      x: direction.includes("west") ? -widthDelta : widthDelta,
      y: direction.includes("north") ? -heightDelta : heightDelta,
    },
    normalizedZoomFactor,
    direction,
  );
}

export function resolveResponsiveBrowserViewportSize(
  container: { readonly width: number; readonly height: number },
  zoomFactor = 1,
): PreviewViewportSize {
  const area = resolveBrowserDeviceViewportArea(container);
  const normalizedZoomFactor = normalizeZoomFactor(zoomFactor);
  return resizeFreeformViewport(
    {
      width: area.width / normalizedZoomFactor,
      height: area.height / normalizedZoomFactor,
    },
    { x: 0, y: 0 },
  );
}
