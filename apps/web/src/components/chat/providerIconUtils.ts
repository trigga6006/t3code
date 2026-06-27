import { ProviderDriverKind } from "@t3tools/contracts";
import { ClaudeAI, CursorIcon, GrokIcon, Icon, OpenAI, OpenCodeIcon, OpenRouterIcon } from "../Icons";
import { PROVIDER_OPTIONS } from "../../session-logic";

export const PROVIDER_ICON_BY_PROVIDER: Partial<Record<ProviderDriverKind, Icon>> = {
  [ProviderDriverKind.make("codex")]: OpenAI,
  [ProviderDriverKind.make("claudeAgent")]: ClaudeAI,
  [ProviderDriverKind.make("opencode")]: OpenCodeIcon,
  [ProviderDriverKind.make("openrouter")]: OpenRouterIcon,
  [ProviderDriverKind.make("cursor")]: CursorIcon,
  [ProviderDriverKind.make("grok")]: GrokIcon,
};

function isAvailableProviderOption(option: (typeof PROVIDER_OPTIONS)[number]): option is {
  value: ProviderDriverKind;
  label: string;
  available: true;
  pickerSidebarBadge?: "new" | "soon";
} {
  return option.available;
}

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);

export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingQualifier(value: string, qualifier: string | null | undefined): string {
  const trimmedQualifier = qualifier?.trim();
  if (!trimmedQualifier) {
    return value;
  }

  const pattern = new RegExp(`^${escapeRegExp(trimmedQualifier)}(?:\\s*[.:/-]\\s*|\\s+)`, "iu");
  return value.replace(pattern, "").trim() || value;
}

export function getDisplayModelName(
  model: ModelEsque,
  options?: { preferShortName?: boolean },
): string {
  const name = options?.preferShortName && model.shortName ? model.shortName : model.name;
  return stripLeadingQualifier(name, model.subProvider);
}

export function getTriggerDisplayModelName(model: ModelEsque): string {
  return getDisplayModelName(model, { preferShortName: true });
}

export function getTriggerDisplayModelLabel(model: ModelEsque): string {
  return getTriggerDisplayModelName(model);
}

/** Leading provider word to strip from the composer model trigger (logo conveys the provider). */
const PROVIDER_QUALIFIER_BY_DRIVER: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("claudeAgent")]: "Claude",
  [ProviderDriverKind.make("codex")]: "OpenAI",
  [ProviderDriverKind.make("opencode")]: "OpenCode",
  [ProviderDriverKind.make("openrouter")]: "OpenRouter",
  [ProviderDriverKind.make("cursor")]: "Cursor",
  [ProviderDriverKind.make("grok")]: "Grok",
};

/** Composer trigger: short model name with the provider word stripped (e.g. "Opus 4.8"). */
export function getComposerTriggerModelName(
  model: ModelEsque,
  driverKind?: ProviderDriverKind | null,
): string {
  const qualifier = driverKind ? PROVIDER_QUALIFIER_BY_DRIVER[driverKind] : undefined;
  return stripLeadingQualifier(getTriggerDisplayModelName(model), qualifier);
}
