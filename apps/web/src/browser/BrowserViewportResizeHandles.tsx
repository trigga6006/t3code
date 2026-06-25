"use client";

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "~/lib/utils";

import {
  BROWSER_VIEWPORT_RESIZE_RAIL_SIZE,
  type BrowserViewportLayout,
  type BrowserViewportResizeDirection,
} from "./browserViewportLayout";

interface Props {
  readonly layout: BrowserViewportLayout;
  readonly activeDirection: BrowserViewportResizeDirection | null;
  readonly onPointerDown: (
    direction: BrowserViewportResizeDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onKeyDown: (
    direction: BrowserViewportResizeDirection,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => void;
}

type HandleKind = "horizontal" | "vertical" | "corner";

const EDGE_BUTTON_CLASS =
  "group absolute z-20 touch-none border-0 bg-transparent p-0 outline-none transition-colors hover:bg-foreground/[0.035] focus-visible:bg-foreground/[0.035]";
const EDGE_GRIP_CLASS =
  "pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border/80 bg-background/90 text-muted-foreground opacity-75 shadow-sm backdrop-blur-sm transition-[color,background-color,border-color,opacity,transform] duration-150 group-hover:scale-105 group-hover:border-foreground/35 group-hover:text-foreground group-hover:opacity-100 group-focus-visible:scale-105 group-focus-visible:border-ring group-focus-visible:text-foreground group-focus-visible:opacity-100 group-active:scale-95 group-active:bg-accent";

function ResizeHandle(props: {
  readonly direction: BrowserViewportResizeDirection;
  readonly label: string;
  readonly kind: HandleKind;
  readonly cursorClassName: string;
  readonly style: CSSProperties;
  readonly active: boolean;
  readonly mirrorCorner?: boolean;
  readonly onPointerDown: Props["onPointerDown"];
  readonly onKeyDown: Props["onKeyDown"];
}) {
  const {
    direction,
    label,
    kind,
    cursorClassName,
    style,
    active,
    mirrorCorner = false,
    onPointerDown,
    onKeyDown,
  } = props;
  return (
    <button
      type="button"
      aria-label={`${label}. Use arrow keys to resize.`}
      className={cn(EDGE_BUTTON_CLASS, kind === "corner" && "z-30", cursorClassName)}
      style={style}
      onPointerDown={(event) => onPointerDown(direction, event)}
      onKeyDown={(event) => onKeyDown(direction, event)}
    >
      <span
        className={cn(
          EDGE_GRIP_CLASS,
          kind === "vertical" && "h-12 w-3",
          kind === "horizontal" && "h-3 w-12",
          kind === "corner" && "size-6 rounded-md",
          active && "scale-105 border-foreground/35 bg-accent text-foreground opacity-100",
        )}
      >
        {kind === "vertical" ? (
          <span className="flex gap-0.5" aria-hidden="true">
            <span className="h-7 w-px rounded-full bg-current" />
            <span className="h-7 w-px rounded-full bg-current" />
          </span>
        ) : kind === "horizontal" ? (
          <span className="flex flex-col gap-0.5" aria-hidden="true">
            <span className="h-px w-7 rounded-full bg-current" />
            <span className="h-px w-7 rounded-full bg-current" />
            <span className="h-px w-7 rounded-full bg-current" />
          </span>
        ) : (
          <span
            className={cn("relative block size-4", mirrorCorner && "-scale-x-100")}
            aria-hidden="true"
          >
            <span className="absolute bottom-[5px] left-0 h-0.5 w-4 -rotate-45 rounded-full bg-current" />
            <span className="absolute bottom-px left-[5px] h-0.5 w-3 -rotate-45 rounded-full bg-current" />
          </span>
        )}
      </span>
    </button>
  );
}

export function BrowserViewportResizeHandles({
  layout,
  activeDirection,
  onPointerDown,
  onKeyDown,
}: Props) {
  const left = layout.viewportX;
  const top = layout.viewportY;
  const right = left + layout.viewportWidth;
  const bottom = top + layout.viewportHeight;
  const railSize = BROWSER_VIEWPORT_RESIZE_RAIL_SIZE;

  const shared = { activeDirection, onPointerDown, onKeyDown };
  return (
    <>
      <ResizeHandle
        direction="west"
        label="Resize browser viewport from left edge"
        kind="vertical"
        cursorClassName="cursor-ew-resize"
        style={{ left: left - railSize, top, width: railSize, height: layout.viewportHeight }}
        active={shared.activeDirection === "west"}
        onPointerDown={shared.onPointerDown}
        onKeyDown={shared.onKeyDown}
      />
      <ResizeHandle
        direction="east"
        label="Resize browser viewport from right edge"
        kind="vertical"
        cursorClassName="cursor-ew-resize"
        style={{ left: right, top, width: railSize, height: layout.viewportHeight }}
        active={shared.activeDirection === "east"}
        onPointerDown={shared.onPointerDown}
        onKeyDown={shared.onKeyDown}
      />
      <ResizeHandle
        direction="south"
        label="Resize browser viewport from bottom edge"
        kind="horizontal"
        cursorClassName="cursor-ns-resize"
        style={{ left, top: bottom, width: layout.viewportWidth, height: railSize }}
        active={shared.activeDirection === "south"}
        onPointerDown={shared.onPointerDown}
        onKeyDown={shared.onKeyDown}
      />
      <ResizeHandle
        direction="southwest"
        label="Resize browser viewport from bottom-left corner"
        kind="corner"
        cursorClassName="cursor-nesw-resize"
        style={{ left: left - railSize, top: bottom, width: railSize, height: railSize }}
        active={shared.activeDirection === "southwest"}
        mirrorCorner
        onPointerDown={shared.onPointerDown}
        onKeyDown={shared.onKeyDown}
      />
      <ResizeHandle
        direction="southeast"
        label="Resize browser viewport from bottom-right corner"
        kind="corner"
        cursorClassName="cursor-nwse-resize"
        style={{ left: right, top: bottom, width: railSize, height: railSize }}
        active={shared.activeDirection === "southeast"}
        onPointerDown={shared.onPointerDown}
        onKeyDown={shared.onKeyDown}
      />
    </>
  );
}
