"use client";

import {
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  type PreviewViewportSetting,
} from "@t3tools/contracts";
import { PREVIEW_VIEWPORT_PRESETS, resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import { RotateCw, X } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

import { BROWSER_DEVICE_TOOLBAR_HEIGHT } from "./browserViewportLayout";

const RESPONSIVE_VALUE = "responsive";
const PRESET_GROUPS = (["Desktop", "Tablet", "Phone"] as const).map((category) => ({
  category,
  presets: PREVIEW_VIEWPORT_PRESETS.filter((preset) => preset.category === category),
}));
const SELECT_ITEMS = [
  { value: RESPONSIVE_VALUE, label: "Responsive" },
  ...PREVIEW_VIEWPORT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
];

interface Props {
  readonly setting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>;
  readonly width: number;
  readonly onChange: (setting: PreviewViewportSetting) => Promise<void>;
}

export function BrowserDeviceToolbar({ setting, width, onChange }: Props) {
  const [pending, setPending] = useState(false);
  const [customSize, setCustomSize] = useState<{
    readonly width: string;
    readonly height: string;
  } | null>(null);
  const presentedSize = customSize ?? {
    width: String(setting.width),
    height: String(setting.height),
  };
  const selectedValue = setting._tag === "preset" ? setting.presetId : RESPONSIVE_VALUE;
  const customWidth = Number(presentedSize.width);
  const customHeight = Number(presentedSize.height);
  const customValid =
    Number.isInteger(customWidth) &&
    Number.isInteger(customHeight) &&
    customWidth >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    customWidth <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    customHeight >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    customHeight <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    customWidth * customHeight <= PREVIEW_VIEWPORT_MAX_AREA;

  const apply = (next: PreviewViewportSetting) => {
    setPending(true);
    void onChange(next).then(
      () => {
        setPending(false);
        setCustomSize(null);
      },
      () => setPending(false),
    );
  };

  const applyCustomSize = () => {
    if (!customValid || (customWidth === setting.width && customHeight === setting.height)) {
      setCustomSize(null);
      return;
    }
    apply({ _tag: "freeform", width: customWidth, height: customHeight });
  };

  const selectViewport = (value: string | null) => {
    if (!value) return;
    if (value === RESPONSIVE_VALUE) {
      if (setting._tag === "freeform") return;
      apply({ _tag: "freeform", width: setting.width, height: setting.height });
      return;
    }
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === value);
    if (!preset) return;
    apply(resolvePreviewViewport({ mode: "preset", preset: preset.id }));
  };

  const rotate = () => {
    apply({ ...setting, width: setting.height, height: setting.width });
  };

  return (
    <div
      className="sticky left-0 top-0 z-50 flex items-center gap-1.5 overflow-x-auto border-b border-border/80 bg-background/95 px-2 shadow-sm backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ width, height: BROWSER_DEVICE_TOOLBAR_HEIGHT }}
      role="toolbar"
      aria-label="Browser device toolbar"
      data-browser-device-toolbar
    >
      {width >= 480 ? (
        <span className="shrink-0 text-xs font-medium text-muted-foreground">Dimensions:</span>
      ) : null}
      <Select
        modal={false}
        value={selectedValue}
        onValueChange={selectViewport}
        items={SELECT_ITEMS}
        disabled={pending}
      >
        <SelectTrigger
          variant="ghost"
          size="xs"
          className={cn("shrink-0 justify-between font-medium", width >= 400 ? "w-32" : "w-24")}
          aria-label="Browser device preset"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false} className="min-w-64">
          <SelectItem value={RESPONSIVE_VALUE}>Responsive</SelectItem>
          {PRESET_GROUPS.map(({ category, presets }) => (
            <SelectGroup key={category}>
              <SelectGroupLabel>{category}</SelectGroupLabel>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  <span className="flex w-full items-center justify-between gap-5">
                    <span>{preset.label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {preset.detail}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectPopup>
      </Select>

      <form
        className="m-0 flex min-w-0 shrink-0 items-center gap-1 border-0 p-0"
        aria-label="Viewport dimensions"
        onSubmit={(event) => {
          event.preventDefault();
          applyCustomSize();
        }}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          if (
            nextTarget instanceof HTMLElement &&
            nextTarget.closest("[data-browser-device-toolbar]")
          ) {
            setCustomSize(null);
            return;
          }
          applyCustomSize();
        }}
      >
        <Input
          nativeInput
          type="number"
          inputMode="numeric"
          size="sm"
          min={PREVIEW_VIEWPORT_MIN_DIMENSION}
          max={PREVIEW_VIEWPORT_MAX_DIMENSION}
          value={presentedSize.width}
          disabled={pending}
          onFocus={() =>
            setCustomSize(
              (current) =>
                current ?? {
                  width: String(setting.width),
                  height: String(setting.height),
                },
            )
          }
          onChange={(event) =>
            setCustomSize((current) => ({
              width: event.target.value,
              height: current?.height ?? String(setting.height),
            }))
          }
          aria-label="Viewport width"
          aria-invalid={!customValid}
          className={cn("text-center tabular-nums", width >= 360 ? "w-16" : "w-12")}
        />
        <span className="text-xs text-muted-foreground">×</span>
        <Input
          nativeInput
          type="number"
          inputMode="numeric"
          size="sm"
          min={PREVIEW_VIEWPORT_MIN_DIMENSION}
          max={PREVIEW_VIEWPORT_MAX_DIMENSION}
          value={presentedSize.height}
          disabled={pending}
          onFocus={() =>
            setCustomSize(
              (current) =>
                current ?? {
                  width: String(setting.width),
                  height: String(setting.height),
                },
            )
          }
          onChange={(event) =>
            setCustomSize((current) => ({
              width: current?.width ?? String(setting.width),
              height: event.target.value,
            }))
          }
          aria-label="Viewport height"
          aria-invalid={!customValid}
          className={cn("text-center tabular-nums", width >= 360 ? "w-16" : "w-12")}
        />
      </form>

      <Button
        variant="ghost"
        size="icon-xs"
        type="button"
        aria-label="Rotate viewport"
        disabled={pending}
        onClick={rotate}
      >
        <RotateCw />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        type="button"
        aria-label="Close device toolbar"
        className="sticky right-0 ml-auto bg-background/95"
        disabled={pending}
        onClick={() => apply({ _tag: "fill" })}
      >
        <X />
      </Button>
    </div>
  );
}
