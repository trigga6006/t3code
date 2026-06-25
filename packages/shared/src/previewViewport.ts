import type {
  PreviewAutomationResizeInput,
  PreviewViewportPresetId,
  PreviewViewportSetting,
} from "@t3tools/contracts";
import { PREVIEW_VIEWPORT_PRESET_IDS } from "@t3tools/contracts";

export interface PreviewViewportPreset {
  readonly id: PreviewViewportPresetId;
  readonly label: string;
  readonly category: "Desktop" | "Tablet" | "Phone";
  readonly detail: string;
  readonly width: number;
  readonly height: number;
}

type PreviewViewportPresetDefinition = Omit<PreviewViewportPreset, "id">;

const PREVIEW_VIEWPORT_PRESET_DEFINITIONS = {
  "desktop-1920x1080": {
    label: "Desktop Full HD",
    category: "Desktop",
    detail: "1920 × 1080",
    width: 1920,
    height: 1080,
  },
  "desktop-1440x900": {
    label: "Desktop",
    category: "Desktop",
    detail: "1440 × 900",
    width: 1440,
    height: 900,
  },
  "laptop-1366x768": {
    label: "Laptop HD",
    category: "Desktop",
    detail: "1366 × 768",
    width: 1366,
    height: 768,
  },
  "laptop-1280x800": {
    label: "Laptop",
    category: "Desktop",
    detail: "1280 × 800",
    width: 1280,
    height: 800,
  },
  "ipad-pro-11": {
    label: 'iPad Pro 11"',
    category: "Tablet",
    detail: "834 × 1194",
    width: 834,
    height: 1194,
  },
  "ipad-mini": {
    label: "iPad mini",
    category: "Tablet",
    detail: "744 × 1133",
    width: 744,
    height: 1133,
  },
  "iphone-15-pro": {
    label: "iPhone 15 Pro",
    category: "Phone",
    detail: "393 × 852",
    width: 393,
    height: 852,
  },
  "iphone-se": {
    label: "iPhone SE",
    category: "Phone",
    detail: "375 × 667",
    width: 375,
    height: 667,
  },
  "pixel-8": {
    label: "Pixel 8",
    category: "Phone",
    detail: "412 × 915",
    width: 412,
    height: 915,
  },
  "galaxy-s24": {
    label: "Galaxy S24",
    category: "Phone",
    detail: "360 × 780",
    width: 360,
    height: 780,
  },
} as const satisfies Record<PreviewViewportPresetId, PreviewViewportPresetDefinition>;

export const PREVIEW_VIEWPORT_PRESETS: ReadonlyArray<PreviewViewportPreset> =
  PREVIEW_VIEWPORT_PRESET_IDS.map((id) => ({
    id,
    ...PREVIEW_VIEWPORT_PRESET_DEFINITIONS[id],
  }));

export function resolvePreviewViewport(
  input: PreviewAutomationResizeInput,
): PreviewViewportSetting {
  if (input.mode === "fill") return { _tag: "fill" };
  if (input.mode === "preset" && input.preset !== undefined) {
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === input.preset);
    if (!preset) throw new Error(`Unknown preview viewport preset: ${input.preset}`);
    const landscape = input.orientation === "landscape";
    const portrait = input.orientation === "portrait";
    const nativePortrait = preset.height >= preset.width;
    const shouldSwap = (landscape && nativePortrait) || (portrait && !nativePortrait);
    return {
      _tag: "preset",
      width: shouldSwap ? preset.height : preset.width,
      height: shouldSwap ? preset.width : preset.height,
      presetId: preset.id,
    };
  }
  if (input.width === undefined || input.height === undefined) {
    throw new Error("Custom preview viewport requires width and height");
  }
  return {
    _tag: "freeform",
    width: input.width,
    height: input.height,
  };
}

export function previewViewportLabel(viewport: PreviewViewportSetting): string {
  return viewport._tag === "fill" ? "Fill panel" : `${viewport.width} × ${viewport.height}`;
}

export function previewViewportPresetOrientation(
  viewport: PreviewViewportSetting,
): "portrait" | "landscape" | null {
  if (viewport._tag === "fill" || viewport.width === viewport.height) return null;
  return viewport.width > viewport.height ? "landscape" : "portrait";
}
