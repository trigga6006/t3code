/**
 * OpenCodeDriver — `ProviderDriver` for the OpenCode runtime.
 *
 * A thin call site over {@link makeOpenCodeHostedDriver}: OpenCode is the plain
 * (un-skinned) OpenCode-hosted provider, so it passes no identity overrides and
 * injects no extra environment. Two instances with different `serverUrl`s talk
 * to independent OpenCode servers; with no `serverUrl` the adapter +
 * text-generation shares spin up their own scoped child processes, released
 * when the registry scope closes.
 *
 * @module provider/Drivers/OpenCodeDriver
 */
import { OpenCodeSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { ProviderDriver } from "../ProviderDriver.ts";
import { makeOpenCodeHostedDriver, type OpenCodeHostedDriverEnv } from "./openCodeHostedDriver.ts";

const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

export type OpenCodeDriverEnv = OpenCodeHostedDriverEnv;

export const OpenCodeDriver: ProviderDriver<OpenCodeSettings, OpenCodeDriverEnv> =
  makeOpenCodeHostedDriver<OpenCodeSettings>({
    driverKind: ProviderDriverKind.make("opencode"),
    displayName: "OpenCode",
    configSchema: OpenCodeSettings,
    defaultConfig: () => decodeOpenCodeSettings({}),
  });
