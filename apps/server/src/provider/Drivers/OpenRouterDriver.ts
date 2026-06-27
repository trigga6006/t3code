/**
 * OpenRouterDriver — first-class `ProviderDriver` for OpenRouter models,
 * hosted by the OpenCode runtime.
 *
 * OpenRouter is not a separate CLI: it is reached by pointing the OpenCode
 * harness at OpenRouter as an upstream provider (OpenCode auto-detects the
 * `OPENROUTER_API_KEY` env var). This driver is therefore a thin call site over
 * {@link makeOpenCodeHostedDriver} — the same harness as {@link OpenCodeDriver}
 * — distinguished only by:
 *
 *   - an OpenRouter {@link OpenCodeProviderIdentity}: it stamps a distinct
 *     `openrouter` provider identity (own icon, name, events) and scopes the
 *     model list + "ready" gate to the `openrouter` upstream, so it surfaces
 *     strictly OpenRouter models and reports ready only once a key is set; and
 *   - an `injectEnv` hook that feeds the user's `apiKey` setting into the
 *     spawned `opencode` process as `OPENROUTER_API_KEY` (a per-instance
 *     `ProviderInstanceEnvironment` secret, if present, takes precedence).
 *
 * Models are selected with the `openrouter/<model>` slug shape (e.g.
 * `openrouter/anthropic/claude-sonnet-4`), discovered dynamically once a key is
 * configured; users can also add arbitrary `openrouter/<id>` slugs via
 * `customModels`. No `auth.json`/`opencode.json` editing is required.
 *
 * @module provider/Drivers/OpenRouterDriver
 */
import { OpenRouterSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { OpenCodeProviderIdentity } from "../Layers/OpenCodeProvider.ts";
import type { ProviderDriver } from "../ProviderDriver.ts";
import { makeOpenCodeHostedDriver, type OpenCodeHostedDriverEnv } from "./openCodeHostedDriver.ts";

const decodeOpenRouterSettings = Schema.decodeSync(OpenRouterSettings);

const DRIVER_KIND = ProviderDriverKind.make("openrouter");

/**
 * Present this OpenCode-hosted instance as OpenRouter and restrict model
 * discovery + the "ready" gate to the `openrouter` upstream (not the always-on
 * `opencode` zen provider). The provider stamp itself comes from `driverKind`
 * (the factory sets it), so it isn't restated here.
 */
const IDENTITY: OpenCodeProviderIdentity = {
  displayName: "OpenRouter",
  upstreamProviderId: "openrouter",
};

export type OpenRouterDriverEnv = OpenCodeHostedDriverEnv;

export const OpenRouterDriver: ProviderDriver<OpenRouterSettings, OpenRouterDriverEnv> =
  makeOpenCodeHostedDriver<OpenRouterSettings>({
    driverKind: DRIVER_KIND,
    displayName: "OpenRouter",
    configSchema: OpenRouterSettings,
    defaultConfig: () => decodeOpenRouterSettings({}),
    identity: IDENTITY,
    // OpenCode auto-detects `OPENROUTER_API_KEY` from its process env. Inject the
    // key from the settings form unless the per-instance environment (or host
    // env) already provides one — an explicit secret override still wins. Only
    // spread into a fresh object when injecting, so we never mutate the input.
    injectEnv: (config, env) =>
      config.apiKey && !env.OPENROUTER_API_KEY
        ? { ...env, OPENROUTER_API_KEY: config.apiKey }
        : env,
  });
