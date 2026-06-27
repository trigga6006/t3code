/**
 * OpenRouterDriver — static wiring + hydration tests.
 *
 * These are deliberately pure (no `opencode` binary, no Effect runtime): they
 * assert that the OpenRouter provider is registered as a first-class built-in
 * driver and that a default instance is synthesized from the legacy
 * `providers.openrouter` settings block, exactly like the other providers.
 *
 * The streaming / tool-call / provider-stamping behaviour is covered in
 * `../Layers/OpenCodeAdapter.test.ts` ("OpenCodeAdapter routed as openrouter").
 */
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_SERVER_SETTINGS, defaultInstanceIdForDriver, ProviderDriverKind } from "@t3tools/contracts";

import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import { deriveProviderInstanceConfigMap } from "../Layers/ProviderInstanceRegistryHydration.ts";
import { OpenRouterDriver } from "./OpenRouterDriver.ts";

const OPENROUTER = ProviderDriverKind.make("openrouter");

describe("OpenRouterDriver static shape", () => {
  it("is pinned to the `openrouter` driver kind with OpenRouter presentation", () => {
    expect(OpenRouterDriver.driverKind).toBe("openrouter");
    expect(OpenRouterDriver.metadata.displayName).toBe("OpenRouter");
    expect(OpenRouterDriver.metadata.supportsMultipleInstances).toBe(true);
  });

  it("produces a decodable default config (OpenCode-shaped, enabled by default)", () => {
    const config = OpenRouterDriver.defaultConfig();
    expect(config.enabled).toBe(true);
    // Hosted by the OpenCode binary.
    expect(config.binaryPath).toBe("opencode");
    expect(config.serverUrl).toBe("");
    expect(config.customModels).toEqual([]);
  });
});

describe("OpenRouterDriver registration", () => {
  it("is registered exactly once in BUILT_IN_DRIVERS", () => {
    const matches = BUILT_IN_DRIVERS.filter((driver) => driver.driverKind === "openrouter");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(OpenRouterDriver);
  });
});

describe("OpenRouter default-instance hydration", () => {
  it("synthesizes a default `openrouter` instance from legacy providers.openrouter", () => {
    const map = deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS);
    const instanceId = defaultInstanceIdForDriver(OPENROUTER);
    expect(instanceId).toBe("openrouter");
    const entry = map[instanceId];
    expect(entry).toBeDefined();
    expect(entry?.driver).toBe("openrouter");
  });

  it("lets an explicit providerInstances entry win over the synthesized default", () => {
    const explicit = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        openrouter: {
          driver: OPENROUTER,
          displayName: "My OpenRouter",
          config: {},
        },
      },
    };
    const map = deriveProviderInstanceConfigMap(explicit as typeof DEFAULT_SERVER_SETTINGS);
    expect(map[defaultInstanceIdForDriver(OPENROUTER)]?.displayName).toBe("My OpenRouter");
  });
});
