"use client";

import {
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  type PreviewViewportSetting,
} from "@t3tools/contracts";
import {
  PREVIEW_VIEWPORT_PRESETS,
  previewViewportLabel,
  resolvePreviewViewport,
} from "@t3tools/shared/previewViewport";
import { MonitorSmartphone, RotateCw } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

interface Props {
  readonly setting: PreviewViewportSetting;
  readonly disabled: boolean;
  readonly fillSize: { readonly width: number; readonly height: number } | null;
  readonly onChange: (setting: PreviewViewportSetting) => Promise<void>;
}

const PRESET_GROUPS = (["Desktop", "Tablet", "Phone"] as const).map((category) => ({
  category,
  presets: PREVIEW_VIEWPORT_PRESETS.filter((preset) => preset.category === category),
}));

export function PreviewViewportControl({ setting, disabled, fillSize, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [customSize, setCustomSize] = useState(() => ({
    width: setting._tag !== "fill" ? String(setting.width) : "1024",
    height: setting._tag !== "fill" ? String(setting.height) : "768",
  }));

  const apply = async (next: PreviewViewportSetting) => {
    setPending(true);
    try {
      await onChange(next);
      setOpen(false);
    } catch {
      // The caller reports the command failure; keep the chooser open for retry.
    } finally {
      setPending(false);
    }
  };

  const width = Number(customSize.width);
  const height = Number(customSize.height);
  const customValid =
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    width <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    height >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    height <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    width * height <= PREVIEW_VIEWPORT_MAX_AREA;

  const submitCustom = (event: FormEvent) => {
    event.preventDefault();
    if (!customValid) return;
    void apply({ _tag: "freeform", width, height });
  };

  const rotate = () => {
    if (setting._tag === "fill") return;
    void apply({
      ...setting,
      width: setting.height,
      height: setting.width,
    });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const nextSize = setting._tag === "fill" ? fillSize : setting;
      if (nextSize) {
        setCustomSize({
          width: String(Math.round(nextSize.width)),
          height: String(Math.round(nextSize.height)),
        });
      }
    }
    setOpen(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            type="button"
            disabled={disabled}
            aria-label={`Browser viewport: ${previewViewportLabel(setting)}`}
            className="max-w-32 px-1.5 font-normal text-muted-foreground"
          />
        }
      >
        <MonitorSmartphone />
        <span className="truncate tabular-nums">{previewViewportLabel(setting)}</span>
      </PopoverTrigger>
      <PopoverPopup align="end" sideOffset={6} className="w-72 [--popup-width:18rem]">
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Browser viewport</p>
              <p className="text-xs text-muted-foreground">Independent CSS-pixel sizing</p>
            </div>
            <Button
              variant="outline"
              size="icon-xs"
              type="button"
              aria-label="Rotate viewport"
              disabled={pending || setting._tag === "fill"}
              onClick={rotate}
            >
              <RotateCw />
            </Button>
          </div>

          <div className="grid gap-1">
            <Button
              type="button"
              size="sm"
              variant={setting._tag === "fill" ? "secondary" : "ghost"}
              className="justify-between px-2"
              disabled={pending}
              onClick={() => void apply({ _tag: "fill" })}
            >
              <span>Fill panel</span>
              <span className="text-xs font-normal text-muted-foreground">Follow panel</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={setting._tag === "freeform" ? "secondary" : "ghost"}
              className="justify-between px-2"
              disabled={pending || !customValid}
              onClick={() => void apply({ _tag: "freeform", width, height })}
            >
              <span>Resizable</span>
              <span className="text-xs font-normal text-muted-foreground">Drag to size</span>
            </Button>
            {PRESET_GROUPS.map(({ category, presets }) => (
              <div key={category} className="grid gap-1 pt-1 first:pt-0">
                <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {category}
                </p>
                {presets.map((preset) => {
                  const selected = setting._tag === "preset" && setting.presetId === preset.id;
                  return (
                    <Button
                      key={preset.id}
                      type="button"
                      size="sm"
                      variant={selected ? "secondary" : "ghost"}
                      className="justify-between px-2"
                      disabled={pending}
                      onClick={() =>
                        void apply(resolvePreviewViewport({ mode: "preset", preset: preset.id }))
                      }
                    >
                      <span>{preset.label}</span>
                      <span className="text-xs font-normal tabular-nums text-muted-foreground">
                        {preset.detail}
                      </span>
                    </Button>
                  );
                })}
              </div>
            ))}
          </div>

          <form className="grid gap-2 border-t border-border/70 pt-3" onSubmit={submitCustom}>
            <p className="text-xs text-muted-foreground">Custom size</p>
            <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
              <Input
                nativeInput
                type="number"
                inputMode="numeric"
                size="sm"
                min={PREVIEW_VIEWPORT_MIN_DIMENSION}
                max={PREVIEW_VIEWPORT_MAX_DIMENSION}
                value={customSize.width}
                onChange={(event) =>
                  setCustomSize((current) => ({ ...current, width: event.target.value }))
                }
                aria-label="Viewport width"
              />
              <span className="text-xs text-muted-foreground">×</span>
              <Input
                nativeInput
                type="number"
                inputMode="numeric"
                size="sm"
                min={PREVIEW_VIEWPORT_MIN_DIMENSION}
                max={PREVIEW_VIEWPORT_MAX_DIMENSION}
                value={customSize.height}
                onChange={(event) =>
                  setCustomSize((current) => ({ ...current, height: event.target.value }))
                }
                aria-label="Viewport height"
              />
              <Button type="submit" size="sm" variant="outline" disabled={pending || !customValid}>
                Apply
              </Button>
            </div>
            <p
              className={cn(
                "text-[11px] text-muted-foreground",
                !customValid && "text-destructive",
              )}
            >
              {PREVIEW_VIEWPORT_MIN_DIMENSION}–{PREVIEW_VIEWPORT_MAX_DIMENSION}px per side, up to 4K
              total area.
            </p>
            <p className="text-[11px] text-muted-foreground">
              Device presets change viewport size only; user agent and touch behavior remain
              desktop.
            </p>
          </form>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
