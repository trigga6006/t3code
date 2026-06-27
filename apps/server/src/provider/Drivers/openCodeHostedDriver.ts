/**
 * makeOpenCodeHostedDriver — shared `ProviderDriver` factory for providers that
 * run on the OpenCode runtime.
 *
 * Both the plain `opencode` driver and OpenCode-routed *skins* (e.g.
 * `openrouter`) drive the exact same `opencode` binary; a skin differs only by
 * its presented identity (display name, event/provider stamp, the upstream it
 * scopes models to) and, optionally, by extra environment it injects into the
 * spawned process (e.g. an `OPENROUTER_API_KEY`). Rather than clone the whole
 * driver body per skin, every OpenCode-hosted driver is one call to this
 * factory — the snapshot/adapter/text-generation/maintenance wiring lives here
 * once and cannot drift between drivers.
 *
 * @module provider/Drivers/openCodeHostedDriver
 */
import { type OpenCodeSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeOpenCodeTextGeneration } from "../../textGeneration/OpenCodeTextGeneration.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeOpenCodeAdapter } from "../Layers/OpenCodeAdapter.ts";
import {
  checkOpenCodeProviderStatus,
  makePendingOpenCodeProvider,
  type OpenCodeProviderIdentity,
} from "../Layers/OpenCodeProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { OpenCodeRuntime } from "../opencodeRuntime.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

/**
 * Infrastructure services required to construct any OpenCode-hosted driver
 * instance. Shared by every skin (they all run the same harness).
 */
export type OpenCodeHostedDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | OpenCodeRuntime
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

/** Recognise a native (curl-installed) `opencode` binary for upgrade routing. */
function isOpenCodeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.opencode/bin/opencode") ||
    normalized.endsWith("/.opencode/bin/opencode.exe")
  );
}

/**
 * Maintenance/upgrade resolver for the `opencode` binary, stamped with the
 * caller's driver kind. Every hosted skin upgrades the same `opencode-ai`
 * package, so only the provider stamp differs.
 */
const makeOpenCodeMaintenanceResolver = (driverKind: ProviderDriverKind) =>
  makePackageManagedProviderMaintenanceResolver({
    provider: driverKind,
    npmPackageName: "opencode-ai",
    homebrewFormula: "anomalyco/tap/opencode",
    nativeUpdate: {
      executable: "opencode",
      args: ["upgrade"],
      lockKey: "opencode-native",
      isCommandPath: isOpenCodeNativeCommandPath,
    },
  });

export interface OpenCodeHostedDriverOptions<S extends OpenCodeSettings> {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly configSchema: Schema.Codec<S, unknown>;
  readonly defaultConfig: () => S;
  /**
   * Identity overrides so a skin presents as its own first-class provider
   * (display name, event/provider stamp, and the single upstream it scopes its
   * model list + ready gate to). Omit for plain OpenCode.
   */
  readonly identity?: OpenCodeProviderIdentity;
  /**
   * Optional hook to inject extra environment (e.g. a skin's API key) into the
   * spawned `opencode` process env. MUST NOT mutate the input — return a fresh
   * object only when adding a key.
   */
  readonly injectEnv?: (config: S, env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
}

/**
 * Build a `ProviderDriver` backed by the OpenCode runtime. See the module doc
 * for why every OpenCode-hosted provider is a call to this rather than a
 * bespoke driver.
 */
export function makeOpenCodeHostedDriver<S extends OpenCodeSettings>(
  options: OpenCodeHostedDriverOptions<S>,
): ProviderDriver<S, OpenCodeHostedDriverEnv> {
  const { driverKind, displayName, configSchema, defaultConfig, identity, injectEnv } = options;
  const update = makeOpenCodeMaintenanceResolver(driverKind);

  // The provider stamp on emitted events and snapshots is authoritatively the
  // driver's own kind — never the caller's optional `identity.providerKind`. A
  // skin can override presentation/scope but cannot make its events claim to
  // come from a different provider than the driver it's registered as.
  const effectiveIdentity: OpenCodeProviderIdentity | undefined = identity
    ? { ...identity, providerKind: driverKind }
    : undefined;

  const stampInstanceIdentity =
    (input: {
      readonly instanceId: ProviderInstance["instanceId"];
      readonly displayName: string | undefined;
      readonly accentColor: string | undefined;
      readonly continuationGroupKey: string;
    }) =>
    (snapshot: ServerProviderDraft): ServerProvider => ({
      ...snapshot,
      instanceId: input.instanceId,
      driver: driverKind,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.accentColor ? { accentColor: input.accentColor } : {}),
      continuation: { groupKey: input.continuationGroupKey },
    });

  return {
    driverKind,
    metadata: {
      displayName,
      supportsMultipleInstances: true,
    },
    configSchema,
    defaultConfig,
    create: ({
      instanceId,
      displayName: instanceDisplayName,
      accentColor,
      environment,
      enabled,
      config,
    }) =>
      Effect.gen(function* () {
        const openCodeRuntime = yield* OpenCodeRuntime;
        const serverConfig = yield* ServerConfig;
        const httpClient = yield* HttpClient.HttpClient;
        const serverSettings = yield* ServerSettingsService;
        const eventLoggers = yield* ProviderEventLoggers;
        const mergedEnv = mergeProviderInstanceEnvironment(environment);
        const processEnv = injectEnv ? injectEnv(config, mergedEnv) : mergedEnv;
        const continuationIdentity = defaultProviderContinuationIdentity({
          driverKind,
          instanceId,
        });
        const stamp = stampInstanceIdentity({
          instanceId,
          displayName: instanceDisplayName,
          accentColor,
          continuationGroupKey: continuationIdentity.continuationKey,
        });
        // `S extends OpenCodeSettings`, so it always carries `enabled: boolean`;
        // overriding it preserves the type. The cast restores the `S` brand the
        // object spread erases.
        const effectiveConfig = { ...config, enabled } as S;
        const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(
          update,
          {
            binaryPath: effectiveConfig.binaryPath,
            env: processEnv,
          },
        );

        const adapter = yield* makeOpenCodeAdapter(effectiveConfig, {
          instanceId,
          environment: processEnv,
          providerKind: driverKind,
          ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        });
        const textGeneration = yield* makeOpenCodeTextGeneration(effectiveConfig, processEnv);

        const checkProvider = checkOpenCodeProviderStatus(
          effectiveConfig,
          serverConfig.cwd,
          processEnv,
          effectiveIdentity,
        ).pipe(Effect.map(stamp), Effect.provideService(OpenCodeRuntime, openCodeRuntime));

        const snapshotSettings = makeProviderSnapshotSettingsSource(
          effectiveConfig,
          serverSettings,
        );
        const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<S>>({
          maintenanceCapabilities,
          getSettings: snapshotSettings.getSettings,
          streamSettings: snapshotSettings.streamSettings,
          haveSettingsChanged: haveProviderSnapshotSettingsChanged,
          initialSnapshot: (settings) =>
            makePendingOpenCodeProvider(settings.provider, effectiveIdentity).pipe(
              Effect.map(stamp),
            ),
          checkProvider,
          enrichSnapshot: ({ settings, snapshot, publishSnapshot }) =>
            enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities, {
              enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
            }).pipe(
              Effect.provideService(HttpClient.HttpClient, httpClient),
              Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
            ),
          refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderDriverError({
                driver: driverKind,
                instanceId,
                detail: `Failed to build ${displayName} snapshot: ${cause.message ?? String(cause)}`,
                cause,
              }),
          ),
        );

        return {
          instanceId,
          driverKind,
          continuationIdentity,
          displayName: instanceDisplayName,
          accentColor,
          enabled,
          snapshot,
          adapter,
          textGeneration,
        } satisfies ProviderInstance;
      }),
  };
}
