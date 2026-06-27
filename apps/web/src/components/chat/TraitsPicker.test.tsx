import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";

import { buildTraitsTriggerLabel, getTraitsSectionVisibility } from "./TraitsPicker";

const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");
const MODEL = "test-model";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  const defaultId = options.find((option) => option.isDefault)?.id;
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(defaultId ? { currentValue: defaultId } : {}),
  };
}

function booleanDescriptor(id: string): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id, label: id, type: "boolean" };
}

function modelWith(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> {
  return [
    { slug: MODEL, name: MODEL, isCustom: false, capabilities: { optionDescriptors: descriptors } },
  ];
}

function selections(
  ...entries: Array<[string, string | boolean]>
): ReadonlyArray<ProviderOptionSelection> {
  return entries.map(([id, value]) => ({ id, value }));
}

const codexModels = modelWith([
  selectDescriptor("reasoningEffort", [
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
  ]),
  // OpenAI/Codex expresses fast mode as a service-tier select, not a boolean.
  selectDescriptor("serviceTier", [
    { id: "default", label: "Standard", isDefault: true },
    { id: "fast", label: "Fast" },
  ]),
]);

const visibilityFor = (
  provider: ProviderDriverKind,
  models: ReadonlyArray<ServerProviderModel>,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined,
) => getTraitsSectionVisibility({ provider, models, model: MODEL, prompt: "", modelOptions });

describe("TraitsPicker fast-mode parity (OpenAI service tier == Claude fast mode)", () => {
  it("treats a fast Codex service tier as fast mode (lightning), like Claude", () => {
    const vis = visibilityFor(CODEX, codexModels, selections(["serviceTier", "fast"]));
    expect(vis.fastModeEnabled).toBe(true);
    // The fast tier is the amber lightning, never a "Fast" text label.
    expect(buildTraitsTriggerLabel(vis)).toBe("Medium");
  });

  it("does not flag the standard Codex service tier as fast mode", () => {
    const vis = visibilityFor(CODEX, codexModels, selections(["serviceTier", "default"]));
    expect(vis.fastModeEnabled).toBe(false);
    // Standard tier shows nothing extra — no "Standard" text either.
    expect(buildTraitsTriggerLabel(vis)).toBe("Medium");
  });

  it("still recognizes Claude's fastMode boolean as fast mode", () => {
    const claudeModels = modelWith([
      selectDescriptor("reasoningEffort", [{ id: "medium", label: "Medium", isDefault: true }]),
      booleanDescriptor("fastMode"),
    ]);

    const on = visibilityFor(CLAUDE, claudeModels, selections(["fastMode", true]));
    expect(on.fastModeEnabled).toBe(true);
    expect(buildTraitsTriggerLabel(on)).toBe("Medium");

    const off = visibilityFor(CLAUDE, claudeModels, selections(["fastMode", false]));
    expect(off.fastModeEnabled).toBe(false);
    expect(buildTraitsTriggerLabel(off)).toBe("Medium");
  });
});
