"use client";

import type { PreviewViewportSetting, ScopedThreadRef } from "@t3tools/contracts";
import { Scaling } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { previewBridge } from "~/components/preview/previewBridge";
import { usePreviewBridge } from "~/components/preview/usePreviewBridge";
import { cn } from "~/lib/utils";

import { useActiveBrowserRecordingTabId } from "./browserRecording";
import { useBrowserSurfaceStore } from "./browserSurfaceStore";
import { commitBrowserViewportChange } from "./browserViewportActions";
import { resizeFreeformViewport, resolveBrowserViewportLayout } from "./browserViewportLayout";
import { acquireDesktopTab, type AcquiredDesktopTab } from "./desktopTabLifetime";
import { usePreviewWebviewConfig } from "./previewWebviewConfigState";

interface ElectronWebview extends HTMLElement {
  src: string;
  partition: string;
  preload?: string;
  webpreferences?: string;
  getWebContentsId: () => number;
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
}

declare global {
  interface HTMLElementTagNameMap {
    webview: ElectronWebview;
  }
}

const viewportSettingKey = (viewport: PreviewViewportSetting): string =>
  viewport._tag === "fill"
    ? "fill"
    : `${viewport._tag}:${viewport.width}:${viewport.height}:${viewport._tag === "preset" ? viewport.presetId : ""}`;

export function HostedBrowserWebview(props: {
  readonly threadRef: ScopedThreadRef;
  readonly tabId: string;
  readonly initialUrl: string | null;
  readonly viewport: PreviewViewportSetting;
  readonly zoomFactor: number;
}) {
  const { threadRef, tabId, initialUrl, viewport, zoomFactor } = props;
  const config = usePreviewWebviewConfig(threadRef.environmentId);
  const [initialSrc] = useState(() => initialUrl ?? "about:blank");
  const tabLeaseRef = useRef<AcquiredDesktopTab | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<ElectronWebview | null>(null);
  const [dragViewport, setDragViewport] = useState<{
    readonly sourceKey: string;
    readonly width: number;
    readonly height: number;
  } | null>(null);
  const presentation = useBrowserSurfaceStore(
    useShallow((state) => {
      const current = state.byTabId[tabId];
      return {
        rect: current?.rect ?? null,
        visible: current?.visible ?? false,
      };
    }),
  );
  const recording = useActiveBrowserRecordingTabId() === tabId;

  usePreviewBridge({ threadRef, tabId });

  useEffect(() => {
    const lease = acquireDesktopTab(tabId);
    tabLeaseRef.current = lease;
    return () => {
      if (tabLeaseRef.current === lease) tabLeaseRef.current = null;
      lease.release();
    };
  }, [tabId]);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const setWebviewRef = useCallback((node: HTMLElement | null) => {
    webviewRef.current = node as ElectronWebview | null;
    if (node && !node.hasAttribute("allowpopups")) node.setAttribute("allowpopups", "true");
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    const bridge = previewBridge;
    if (!webview || !config || !bridge) return;
    let disposed = false;
    const register = () => {
      const lease = tabLeaseRef.current;
      if (!lease) return;
      void (async () => {
        try {
          // The main-process tab and the DOM webview are created by separate
          // effects. Wait for the former so registration cannot race and fail
          // with PreviewTabNotFoundError on a fast about:blank attachment.
          await lease.ready;
          if (disposed || webviewRef.current !== webview) return;
          const webContentsId = webview.getWebContentsId();
          if (Number.isInteger(webContentsId) && webContentsId > 0) {
            await bridge.registerWebview(tabId, webContentsId);
          }
        } catch {
          // did-attach/dom-ready will retry if the guest was not ready yet.
        }
      })();
    };
    webview.addEventListener("did-attach", register);
    webview.addEventListener("dom-ready", register);
    register();
    return () => {
      disposed = true;
      webview.removeEventListener("did-attach", register);
      webview.removeEventListener("dom-ready", register);
    };
  }, [config, tabId]);

  const active = presentation.visible && presentation.rect !== null;
  const lastRect = presentation.rect;
  const sourceViewportKey = viewportSettingKey(viewport);
  const effectiveViewport =
    dragViewport?.sourceKey === sourceViewportKey
      ? ({
          _tag: "freeform",
          width: dragViewport.width,
          height: dragViewport.height,
        } as const satisfies PreviewViewportSetting)
      : viewport;
  const normalizedZoomFactor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const hiddenSize =
    effectiveViewport._tag !== "fill"
      ? {
          width: effectiveViewport.width * normalizedZoomFactor,
          height: effectiveViewport.height * normalizedZoomFactor,
        }
      : { width: lastRect?.width ?? 1280, height: lastRect?.height ?? 800 };
  const containerSize = active && lastRect ? lastRect : hiddenSize;
  const layout = resolveBrowserViewportLayout(containerSize, effectiveViewport, zoomFactor);

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (effectiveViewport._tag !== "freeform") return;
    event.preventDefault();
    event.stopPropagation();
    dragCleanupRef.current?.();
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = effectiveViewport.width;
    const startHeight = effectiveViewport.height;
    let latest = { width: startWidth, height: startHeight };
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Window listeners below keep the drag functional when capture is unavailable.
    }

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const { width, height } = resizeFreeformViewport(
        { width: startWidth, height: startHeight },
        { x: moveEvent.clientX - startX, y: moveEvent.clientY - startY },
        zoomFactor,
      );
      latest = { width, height };
      setDragViewport({ sourceKey: sourceViewportKey, width, height });
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
      void commitBrowserViewportChange(tabId, {
        _tag: "freeform",
        width: latest.width,
        height: latest.height,
      }).then(
        () => setDragViewport(null),
        () => setDragViewport(null),
      );
    }
    function cancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
      setDragViewport(null);
    }
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const syncContentPresentation = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    useBrowserSurfaceStore.getState().presentContent(tabId, {
      x: layout.viewportX,
      y: layout.viewportY,
      width: layout.viewportWidth,
      height: layout.viewportHeight,
      scrollLeft: wrapper.scrollLeft,
      scrollTop: wrapper.scrollTop,
    });
  }, [layout, tabId]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(syncContentPresentation);
    return () => window.cancelAnimationFrame(frameId);
  }, [syncContentPresentation]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    wrapper.scrollTo({ left: 0, top: 0 });
  }, [tabId, viewport]);

  if (!config) return null;

  const wrapperStyle =
    active && lastRect
      ? {
          left: lastRect.x,
          top: lastRect.y,
          width: lastRect.width,
          height: lastRect.height,
          zIndex: 30,
          pointerEvents: "auto" as const,
        }
      : {
          left: 0,
          top: 0,
          width: hiddenSize.width,
          height: hiddenSize.height,
          zIndex: recording ? 0 : -1,
          pointerEvents: "none" as const,
        };

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "fixed bg-muted/35",
        active && !layout.fillsPanel ? "overflow-auto" : "overflow-hidden",
      )}
      style={{ ...wrapperStyle, overscrollBehavior: "contain" }}
      onScroll={syncContentPresentation}
      data-preview-viewport={tabId}
    >
      <div className="relative" style={{ width: layout.canvasWidth, height: layout.canvasHeight }}>
        <webview
          ref={setWebviewRef}
          src={initialSrc}
          partition={config.partition}
          webpreferences={config.webPreferences}
          {...(config.preloadUrl ? { preload: config.preloadUrl } : {})}
          data-preview-tab={tabId}
          data-preview-viewport-mode={effectiveViewport._tag}
          data-preview-css-width={
            effectiveViewport._tag === "fill"
              ? Math.max(1, Math.round(layout.viewportWidth / normalizedZoomFactor))
              : effectiveViewport.width
          }
          data-preview-css-height={
            effectiveViewport._tag === "fill"
              ? Math.max(1, Math.round(layout.viewportHeight / normalizedZoomFactor))
              : effectiveViewport.height
          }
          aria-hidden={active ? undefined : true}
          className={cn(
            "absolute flex overflow-hidden bg-background",
            active && !layout.fillsPanel && "ring-1 ring-border/70 shadow-sm",
          )}
          style={{
            left: layout.viewportX,
            top: layout.viewportY,
            width: layout.viewportWidth,
            height: layout.viewportHeight,
          }}
        />
        {active && effectiveViewport._tag === "freeform" ? (
          <button
            type="button"
            aria-label="Resize browser viewport"
            className="absolute z-10 flex size-5 cursor-nwse-resize touch-none items-center justify-center rounded-sm border border-border bg-background/95 text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              left: layout.viewportX + layout.viewportWidth - 18,
              top: layout.viewportY + layout.viewportHeight - 18,
            }}
            onPointerDown={handleResizePointerDown}
          >
            <Scaling className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
