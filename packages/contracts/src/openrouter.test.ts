/**
 * OpenRouter contracts — settings schema, legacy provider entry, patch schema,
 * and model-map wiring for the first-class `openrouter` provider (routed
 * through the OpenCode harness).
 */
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderDriverKind } from "./providerInstance.ts";
import { DEFAULT_MODEL_BY_PROVIDER, PROVIDER_DISPLAY_NAMES } from "./model.ts";
import { OpenRouterSettings, ServerSettings, ServerSettingsPatch } from "./settings.ts";

const OPENROUTER = ProviderDriverKind.make("openrouter");
const decodeOpenRouterSettings = Schema.decodeSync(OpenRouterSettings);
const decodeServerSettings = Schema.decodeSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

describe("OpenRouterSettings", () => {
  it("decodes empty input to OpenCode-shaped defaults", () => {
    const settings = decodeOpenRouterSettings({});
    expect(settings.enabled).toBe(true);
    expect(settings.apiKey).toBe("");
    expect(settings.binaryPath).toBe("opencode");
    expect(settings.serverUrl).toBe("");
    expect(settings.serverPassword).toBe("");
    expect(settings.customModels).toEqual([]);
  });

  it("round-trips an OpenRouter API key", () => {
    const settings = decodeOpenRouterSettings({ apiKey: "sk-or-test-key" });
    expect(settings.apiKey).toBe("sk-or-test-key");
  });

  it("round-trips a custom `openrouter/<id>` model slug (escape hatch)", () => {
    const settings = decodeOpenRouterSettings({
      customModels: ["openrouter/anthropic/claude-sonnet-4"],
    });
    expect(settings.customModels).toContain("openrouter/anthropic/claude-sonnet-4");
  });
});

describe("ServerSettings.providers.openrouter", () => {
  it("includes an openrouter entry that defaults from {}", () => {
    const settings = decodeServerSettings({});
    expect(settings.providers.openrouter).toBeDefined();
    expect(settings.providers.openrouter.enabled).toBe(true);
  });
});

describe("ServerSettingsPatch.providers.openrouter", () => {
  it("accepts a partial openrouter patch", () => {
    const patch = decodeServerSettingsPatch({
      providers: {
        openrouter: {
          enabled: false,
          apiKey: "sk-or-patch",
          customModels: ["openrouter/openai/gpt-5"],
        },
      },
    });
    expect(patch.providers?.openrouter?.enabled).toBe(false);
    expect(patch.providers?.openrouter?.apiKey).toBe("sk-or-patch");
    expect(patch.providers?.openrouter?.customModels).toEqual(["openrouter/openai/gpt-5"]);
  });
});

describe("model maps", () => {
  it("registers the OpenRouter display name", () => {
    expect(PROVIDER_DISPLAY_NAMES[OPENROUTER]).toBe("OpenRouter");
  });

  it("provides a default OpenRouter model slug", () => {
    const slug = DEFAULT_MODEL_BY_PROVIDER[OPENROUTER];
    expect(slug).toBeDefined();
    expect(slug?.startsWith("openrouter/")).toBe(true);
  });
});
