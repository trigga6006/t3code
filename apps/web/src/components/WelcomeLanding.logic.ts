import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";
import { applyClaudePromptEffortPrefix, resolvePromptInjectedEffort } from "@t3tools/shared/model";

import { getProviderModelCapabilities } from "../providerModels";

/**
 * Warm, name-less greetings rotated on the welcome landing page. Kept short and
 * friendly — the kind of line you'd see on an OpenAI/Anthropic home surface.
 */
export const WELCOME_HEADLINES = [
  "What should we build today?",
  "Let's build something.",
  "Ready when you are.",
  "Where should we start?",
  "What's on your mind?",
  "Let's get to work.",
] as const;

/**
 * Picks a headline using the provided RNG (defaults to `Math.random`). The index
 * is clamped so out-of-range RNG values (including a literal `1`) still map to a
 * valid headline.
 */
export function pickWelcomeHeadline(rng: () => number = Math.random): string {
  const index = Math.min(
    WELCOME_HEADLINES.length - 1,
    Math.max(0, Math.floor(rng() * WELCOME_HEADLINES.length)),
  );
  return WELCOME_HEADLINES[index] ?? WELCOME_HEADLINES[0];
}

/**
 * Mirrors ChatView's module-local `formatOutgoingPrompt`: applies the
 * provider/model effort prefix to the outgoing first-message text. Re-declared
 * here because the ChatView copy is not exported. Keep in sync with ChatView.
 */
export function formatWelcomeOutgoingPrompt(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  const promptEffort = resolvePromptInjectedEffort(caps, params.effort);
  return applyClaudePromptEffortPrefix(params.text, promptEffort);
}

/**
 * Title seed for the first message of a brand-new thread, mirroring ChatView's
 * precedence: trimmed prompt → image name → terminal-context label →
 * element-context label → "New thread".
 */
export function buildLandingTitleSeed(params: {
  trimmedPrompt: string;
  firstImageName: string | null;
  firstTerminalLabel?: string | null;
  firstElementLabel?: string | null;
}): string {
  if (params.trimmedPrompt) return params.trimmedPrompt;
  if (params.firstImageName) return `Image: ${params.firstImageName}`;
  if (params.firstTerminalLabel) return params.firstTerminalLabel;
  if (params.firstElementLabel) return params.firstElementLabel;
  return "New thread";
}
