"use client";

import type { PreviewViewportSetting, PreviewViewportSize } from "@t3tools/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { commitBrowserViewportChange } from "./browserViewportActions";
import {
  resizeBrowserViewportFromRail,
  resizeFreeformViewport,
  resolveBrowserDeviceViewportArea,
  resolveBrowserDeviceViewportLayout,
  resolveBrowserViewportLayout,
  type BrowserViewportResizeDirection,
} from "./browserViewportLayout";

interface ViewportDrag extends PreviewViewportSize {
  readonly sourceKey: string;
  readonly direction: BrowserViewportResizeDirection;
}

const viewportSettingKey = (viewport: PreviewViewportSetting): string =>
  viewport._tag === "fill"
    ? "fill"
    : `${viewport._tag}:${viewport.width}:${viewport.height}:${viewport._tag === "preset" ? viewport.presetId : ""}`;

export function useBrowserViewportResize(options: {
  readonly tabId: string;
  readonly viewport: PreviewViewportSetting;
  readonly zoomFactor: number;
  readonly containerSize: PreviewViewportSize;
  readonly deviceToolbarVisible: boolean;
}) {
  const { tabId, viewport, zoomFactor, containerSize, deviceToolbarVisible } = options;
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const dragVersionRef = useRef(0);
  const [dragViewport, setDragViewport] = useState<ViewportDrag | null>(null);
  const sourceViewportKey = viewportSettingKey(viewport);
  const sourceViewportKeyRef = useRef(sourceViewportKey);
  sourceViewportKeyRef.current = sourceViewportKey;
  const activeDrag = dragViewport?.sourceKey === sourceViewportKey ? dragViewport : null;
  const effectiveViewport = activeDrag
    ? ({
        _tag: "freeform",
        width: activeDrag.width,
        height: activeDrag.height,
      } as const satisfies PreviewViewportSetting)
    : viewport;
  const normalizedZoomFactor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const viewportContainerSize = deviceToolbarVisible
    ? resolveBrowserDeviceViewportArea(containerSize)
    : containerSize;
  const layout =
    deviceToolbarVisible && effectiveViewport._tag !== "fill"
      ? resolveBrowserDeviceViewportLayout(containerSize, effectiveViewport, zoomFactor)
      : resolveBrowserViewportLayout(containerSize, effectiveViewport, zoomFactor);

  useEffect(
    () => () => {
      dragVersionRef.current += 1;
      dragCleanupRef.current?.();
    },
    [],
  );

  const commitViewportChange = useCallback(
    (next: PreviewViewportSetting) => {
      dragVersionRef.current += 1;
      dragCleanupRef.current?.();
      setDragViewport(null);
      return commitBrowserViewportChange(tabId, next);
    },
    [tabId],
  );

  const clearDrag = () => setDragViewport(null);
  const commitDrag = (next: PreviewViewportSetting) => {
    const version = ++dragVersionRef.current;
    const clearIfCurrent = () => {
      if (dragVersionRef.current === version) clearDrag();
    };
    void commitBrowserViewportChange(tabId, next).then(clearIfCurrent, clearIfCurrent);
  };

  const handleResizeKeyDown = (
    direction: BrowserViewportResizeDirection,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (effectiveViewport._tag === "fill") return;
    const controlsWidth = direction.includes("east") || direction.includes("west");
    const controlsHeight = direction.includes("north") || direction.includes("south");
    const step = (event.shiftKey ? 50 : 10) * normalizedZoomFactor;
    const delta =
      event.key === "ArrowLeft" && controlsWidth
        ? { x: -step, y: 0 }
        : event.key === "ArrowRight" && controlsWidth
          ? { x: step, y: 0 }
          : event.key === "ArrowUp" && controlsHeight
            ? { x: 0, y: -step }
            : event.key === "ArrowDown" && controlsHeight
              ? { x: 0, y: step }
              : null;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const next = resizeFreeformViewport(effectiveViewport, delta, zoomFactor, direction);
    if (next.width === effectiveViewport.width && next.height === effectiveViewport.height) return;
    setDragViewport({ sourceKey: sourceViewportKey, ...next, direction });
    commitDrag({ _tag: "freeform", ...next });
  };

  const handleResizePointerDown = (
    direction: BrowserViewportResizeDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (effectiveViewport._tag === "fill") return;
    event.preventDefault();
    event.stopPropagation();
    dragCleanupRef.current?.();
    dragVersionRef.current += 1;
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = effectiveViewport.width;
    const startHeight = effectiveViewport.height;
    let latest = { width: startWidth, height: startHeight };
    setDragViewport({
      sourceKey: sourceViewportKey,
      width: startWidth,
      height: startHeight,
      direction,
    });
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Window listeners below keep the drag functional when capture is unavailable.
    }

    const sourceChanged = () => sourceViewportKeyRef.current !== sourceViewportKey;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (sourceChanged()) {
        cleanup();
        dragVersionRef.current += 1;
        clearDrag();
        return;
      }
      moveEvent.preventDefault();
      const { width, height } = resizeBrowserViewportFromRail(
        { width: startWidth, height: startHeight },
        {
          x: moveEvent.clientX - startX,
          y: moveEvent.clientY - startY,
        },
        viewportContainerSize,
        zoomFactor,
        direction,
      );
      latest = { width, height };
      setDragViewport({ sourceKey: sourceViewportKey, width, height, direction });
    };
    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      dragCleanupRef.current = null;
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // The browser may already have released capture on pointerup.
      }
    }
    function finish(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      if (sourceChanged() || (latest.width === startWidth && latest.height === startHeight)) {
        clearDrag();
        return;
      }
      commitDrag({
        _tag: "freeform",
        width: latest.width,
        height: latest.height,
      });
    }
    function cancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
      dragVersionRef.current += 1;
      clearDrag();
    }
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  return {
    activeDrag,
    commitViewportChange,
    effectiveViewport,
    handleResizeKeyDown,
    handleResizePointerDown,
    layout,
  };
}
