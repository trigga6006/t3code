import {
  ProviderDriverKind,
  type ModelCapabilities,
  type OpenCodeSettings,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { createModelCapabilities } from "@t3tools/shared/model";
import { compareSemverVersions } from "@t3tools/shared/semver";
import {
  buildServerProvider,
  nonEmptyTrimmed,
  parseGenericCliVersion,
  providerModelsFromSettings,
  type ServerProviderDraft,
  type ServerProviderPresentation,
} from "../providerSnapshot.ts";
import {
  OpenCodeRuntime,
  openCodeRuntimeErrorDetail,
  type OpenCodeInventory,
} from "../opencodeRuntime.ts";
import type { Agent, ProviderListResponse } from "@opencode-ai/sdk/v2";

const PROVIDER = ProviderDriverKind.make("opencode");
const OPENCODE_PRESENTATION = {
  displayName: "OpenCode",
  showInteractionModeToggle: false,
} as const;
/**
 * Minimum OpenCode CLI version OmniCode requires. This is the floor for the
 * `provider/model` slug + tool-calling behaviour the adapter relies on. The
 * recommended version is the latest stable release (≈1.17.x as of 2026-06);
 * newer OpenCode releases improve OpenRouter provider handling and tool-call
 * fidelity, but are NOT force-required here — anything ≥ this floor works.
 */
const MINIMUM_OPENCODE_VERSION = "1.14.19";

/**
 * Optional identity overrides so the OpenCode snapshot builders can present a
 * different first-class provider (e.g. `openrouter`) while still driving the
 * same `opencode` binary. When omitted, the snapshot is stamped as OpenCode.
 */
export interface OpenCodeProviderIdentity {
  readonly providerKind?: ProviderDriverKind;
  readonly displayName?: string;
  /**
   * When set, restrict the discovered model list — and the "ready" gate — to a
   * single OpenCode upstream provider id (e.g. `"openrouter"`). This makes a
   * first-class skin like OpenRouter surface ONLY its own models and report
   * `ready` only when that specific upstream is connected, instead of every
   * upstream OpenCode happens to have connected (notably the always-on
   * `opencode` zen provider, which would otherwise leak non-OpenRouter models
   * under the OpenRouter brand and make the instance look "ready" with no key).
   */
  readonly upstreamProviderId?: string;
}

function resolveOpenCodeIdentity(identity: OpenCodeProviderIdentity | undefined): {
  readonly provider: ProviderDriverKind;
  readonly presentation: ServerProviderPresentation;
} {
  const provider = identity?.providerKind ?? PROVIDER;
  const presentation: ServerProviderPresentation = identity?.displayName
    ? { ...OPENCODE_PRESENTATION, displayName: identity.displayName }
    : OPENCODE_PRESENTATION;
  return { provider, presentation };
}

class OpenCodeProbeError extends Data.TaggedError("OpenCodeProbeError")<{
  readonly cause: unknown;
  readonly detail: string;
}> {}

function normalizeProbeMessage(message: string): string | undefined {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (
    trimmed === "An error occurred in Effect.tryPromise" ||
    trimmed === "An error occurred in Effect.try"
  ) {
    return undefined;
  }
  return trimmed;
}

function normalizedErrorMessage(cause: unknown): string | undefined {
  if (cause instanceof OpenCodeProbeError) {
    return normalizeProbeMessage(cause.detail);
  }

  if (!(cause instanceof Error)) {
    return undefined;
  }

  return normalizeProbeMessage(cause.message);
}

function formatOpenCodeProbeError(input: {
  readonly cause: unknown;
  readonly isExternalServer: boolean;
  readonly serverUrl: string;
}): { readonly installed: boolean; readonly message: string } {
  const detail = normalizedErrorMessage(input.cause);
  const lower = detail?.toLowerCase() ?? "";

  if (input.isExternalServer) {
    if (
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden")
    ) {
      return {
        installed: true,
        message: "OpenCode server rejected authentication. Check the server URL and password.",
      };
    }

    if (
      lower.includes("econnrefused") ||
      lower.includes("enotfound") ||
      lower.includes("fetch failed") ||
      lower.includes("networkerror") ||
      lower.includes("timed out") ||
      lower.includes("timeout") ||
      lower.includes("socket hang up")
    ) {
      return {
        installed: true,
        message: `Couldn't reach the configured OpenCode server at ${input.serverUrl}. Check that the server is running and the URL is correct.`,
      };
    }

    return {
      installed: true,
      message: detail ?? "Failed to connect to the configured OpenCode server.",
    };
  }

  if (lower.includes("enoent") || lower.includes("notfound")) {
    return {
      installed: false,
      message: "OpenCode CLI (`opencode`) is not installed or not on PATH.",
    };
  }

  if (lower.includes("quarantine")) {
    return {
      installed: true,
      message:
        "macOS is blocking the OpenCode binary (quarantine). Run `xattr -d com.apple.quarantine $(which opencode)` to fix this.",
    };
  }

  if (lower.includes("invalid code signature") || lower.includes("corrupted")) {
    return {
      installed: true,
      message:
        "macOS killed the OpenCode process due to an invalid code signature. The binary may be corrupted — try reinstalling OpenCode.",
    };
  }

  return {
    installed: true,
    message: detail
      ? `Failed to execute OpenCode CLI health check: ${detail}`
      : "Failed to execute OpenCode CLI health check.",
  };
}

function titleCaseSlug(value: string): string {
  const segments: Array<string> = [];
  for (const segment of value.split(/[-_/]+/)) {
    if (segment.length > 0) {
      segments.push(segment.charAt(0).toUpperCase() + segment.slice(1));
    }
  }
  return segments.join(" ");
}

function inferDefaultVariant(
  providerID: string,
  variants: ReadonlyArray<string>,
): string | undefined {
  if (variants.length === 1) {
    return variants[0];
  }
  if (providerID === "anthropic" || providerID.startsWith("google")) {
    return variants.includes("high") ? "high" : undefined;
  }
  if (providerID === "openai" || providerID === "opencode") {
    return variants.includes("medium") ? "medium" : variants.includes("high") ? "high" : undefined;
  }
  return undefined;
}

function inferDefaultAgent(agents: ReadonlyArray<Agent>): string | undefined {
  return agents.find((agent) => agent.name === "build")?.name ?? agents[0]?.name ?? undefined;
}

const DEFAULT_OPENCODE_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

function openCodeCapabilitiesForModel(input: {
  readonly providerID: string;
  readonly model: ProviderListResponse["all"][number]["models"][string];
  readonly agents: ReadonlyArray<Agent>;
}): ModelCapabilities {
  const variantValues = Object.keys(input.model.variants ?? {});
  const defaultVariant = inferDefaultVariant(input.providerID, variantValues);
  const variantOptions = variantValues.map((value) =>
    defaultVariant === value
      ? { id: value, label: titleCaseSlug(value), isDefault: true as const }
      : { id: value, label: titleCaseSlug(value) },
  );
  const primaryAgents = input.agents.filter(
    (agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"),
  );
  const defaultAgent = inferDefaultAgent(primaryAgents);
  const agentOptions = primaryAgents.map((agent) =>
    defaultAgent === agent.name
      ? { id: agent.name, label: titleCaseSlug(agent.name), isDefault: true as const }
      : { id: agent.name, label: titleCaseSlug(agent.name) },
  );
  return createModelCapabilities({
    optionDescriptors: [
      ...(variantOptions.length > 0
        ? [
            {
              id: "variant",
              label: "Variant",
              type: "select" as const,
              options: variantOptions,
              ...(defaultVariant ? { currentValue: defaultVariant } : {}),
            },
          ]
        : []),
      ...(agentOptions.length > 0
        ? [
            {
              id: "agent",
              label: "Agent",
              type: "select" as const,
              options: agentOptions,
              ...(defaultAgent ? { currentValue: defaultAgent } : {}),
            },
          ]
        : []),
    ],
  });
}

function flattenOpenCodeModels(
  input: OpenCodeInventory,
  upstreamProviderId?: string,
): ReadonlyArray<ServerProviderModel> {
  const connected = new Set(input.providerList.connected);
  const models: Array<ServerProviderModel> = [];

  for (const provider of input.providerList.all) {
    if (!connected.has(provider.id)) {
      continue;
    }
    // First-class skins (e.g. OpenRouter) restrict discovery to their own
    // upstream so foreign models (like the always-on `opencode` provider) are
    // not surfaced under their brand.
    if (upstreamProviderId !== undefined && provider.id !== upstreamProviderId) {
      continue;
    }

    for (const model of Object.values(provider.models)) {
      const name = nonEmptyTrimmed(model.name);
      if (!name) {
        continue;
      }

      const subProvider = nonEmptyTrimmed(provider.name);
      models.push({
        slug: `${provider.id}/${model.id}`,
        name,
        ...(subProvider ? { subProvider } : {}),
        isCustom: false,
        capabilities: openCodeCapabilitiesForModel({
          providerID: provider.id,
          model,
          agents: input.agents,
        }),
      });
    }
  }

  return models.toSorted((left, right) => left.name.localeCompare(right.name));
}

/**
 * Map OpenCode's `/command` list to provider slash commands. OpenCode commands
 * (built-ins, custom commands, MCP prompts, and skills) are all invoked with the
 * `/name` syntax — the same shape Claude uses — so each becomes a
 * `ServerProviderSlashCommand` keyed by name, deduped, carrying its description.
 */
function mapOpenCodeCommands(
  commands: OpenCodeInventory["commands"] | undefined,
): ReadonlyArray<ServerProviderSlashCommand> {
  const seen = new Set<string>();
  const mapped: Array<ServerProviderSlashCommand> = [];
  for (const command of commands ?? []) {
    const name = nonEmptyTrimmed(command.name);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const description = nonEmptyTrimmed(command.description ?? "");
    mapped.push(description ? { name, description } : { name });
  }
  return mapped;
}

export const makePendingOpenCodeProvider = (
  openCodeSettings: OpenCodeSettings,
  identity?: OpenCodeProviderIdentity,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const { provider, presentation } = resolveOpenCodeIdentity(identity);
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = providerModelsFromSettings(
      [],
      provider,
      openCodeSettings.customModels,
      DEFAULT_OPENCODE_MODEL_CAPABILITIES,
    );

    if (!openCodeSettings.enabled) {
      return buildServerProvider({
        presentation,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message:
            openCodeSettings.serverUrl.trim().length > 0
              ? "OpenCode is disabled in OmniCode settings. A server URL is configured."
              : "OpenCode is disabled in OmniCode settings.",
        },
      });
    }

    return buildServerProvider({
      presentation,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "OpenCode provider status has not been checked in this session yet.",
      },
    });
  });

export const checkOpenCodeProviderStatus = Effect.fn("checkOpenCodeProviderStatus")(function* (
  openCodeSettings: OpenCodeSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  identity?: OpenCodeProviderIdentity,
): Effect.fn.Return<ServerProviderDraft, never, OpenCodeRuntime> {
  const { provider, presentation } = resolveOpenCodeIdentity(identity);
  const openCodeRuntime = yield* OpenCodeRuntime;
  const resolvedEnvironment = environment ?? process.env;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const customModels = openCodeSettings.customModels;
  const isExternalServer = openCodeSettings.serverUrl.trim().length > 0;

  const fallback = (cause: unknown, version: string | null = null) => {
    const failure = formatOpenCodeProbeError({
      cause,
      isExternalServer,
      serverUrl: openCodeSettings.serverUrl,
    });
    return buildServerProvider({
      presentation,
      enabled: openCodeSettings.enabled,
      checkedAt,
      models: providerModelsFromSettings(
        [],
        provider,
        customModels,
        DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      ),
      probe: {
        installed: failure.installed,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: failure.message,
      },
    });
  };

  if (!openCodeSettings.enabled) {
    return buildServerProvider({
      presentation,
      enabled: false,
      checkedAt,
      models: providerModelsFromSettings(
        [],
        provider,
        customModels,
        DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      ),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: isExternalServer
          ? "OpenCode is disabled in OmniCode settings. A server URL is configured."
          : "OpenCode is disabled in OmniCode settings.",
      },
    });
  }

  let version: string | null = null;
  if (!isExternalServer) {
    const versionExit = yield* Effect.exit(
      openCodeRuntime
        .runOpenCodeCommand({
          binaryPath: openCodeSettings.binaryPath,
          args: ["--version"],
          environment: resolvedEnvironment,
        })
        .pipe(
          Effect.mapError(
            (cause) => new OpenCodeProbeError({ cause, detail: openCodeRuntimeErrorDetail(cause) }),
          ),
        ),
    );
    if (versionExit._tag === "Failure") {
      return fallback(Cause.squash(versionExit.cause));
    }
    version = parseGenericCliVersion(versionExit.value.stdout) ?? null;

    if (!version) {
      return fallback(
        new Error(
          `Unable to determine OpenCode version from \`opencode --version\` output. OmniCode requires OpenCode v${MINIMUM_OPENCODE_VERSION} or newer.`,
        ),
        null,
      );
    }
    if (compareSemverVersions(version, MINIMUM_OPENCODE_VERSION) < 0) {
      return buildServerProvider({
        presentation,
        enabled: openCodeSettings.enabled,
        checkedAt,
        models: providerModelsFromSettings(
          [],
          provider,
          customModels,
          DEFAULT_OPENCODE_MODEL_CAPABILITIES,
        ),
        probe: {
          installed: true,
          version,
          status: "error",
          auth: { status: "unknown" },
          message: `OpenCode v${version} is too old. Upgrade to v${MINIMUM_OPENCODE_VERSION} or newer.`,
        },
      });
    }
  }

  const inventoryExit = yield* Effect.exit(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* openCodeRuntime.connectToOpenCodeServer({
          binaryPath: openCodeSettings.binaryPath,
          serverUrl: openCodeSettings.serverUrl,
          environment: resolvedEnvironment,
        });
        return yield* openCodeRuntime.loadOpenCodeInventory(
          openCodeRuntime.createOpenCodeSdkClient({
            baseUrl: server.url,
            directory: cwd,
            ...(isExternalServer && openCodeSettings.serverPassword
              ? { serverPassword: openCodeSettings.serverPassword }
              : {}),
          }),
        );
      }).pipe(
        Effect.mapError(
          (cause) => new OpenCodeProbeError({ cause, detail: openCodeRuntimeErrorDetail(cause) }),
        ),
      ),
    ),
  );
  if (inventoryExit._tag === "Failure") {
    return fallback(Cause.squash(inventoryExit.cause), version);
  }

  const upstreamProviderId = identity?.upstreamProviderId;
  const models = providerModelsFromSettings(
    flattenOpenCodeModels(inventoryExit.value, upstreamProviderId),
    provider,
    customModels,
    DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  );
  const connectedProviders = inventoryExit.value.providerList.connected;
  const connectedCount = connectedProviders.length;
  // For a first-class skin the gate is "is MY upstream connected", not "is any
  // upstream connected" — otherwise the always-on `opencode` provider would
  // make the instance report `ready` (with no models) before a key is set.
  const isReady =
    upstreamProviderId === undefined
      ? connectedCount > 0
      : connectedProviders.includes(upstreamProviderId);

  let message: string;
  if (upstreamProviderId !== undefined) {
    const upstreamLabel = presentation.displayName ?? upstreamProviderId;
    message = isReady
      ? `${upstreamLabel} is connected through OpenCode.`
      : `OpenCode is available, but ${upstreamLabel} is not connected. Add your ${upstreamLabel} API key to connect it.`;
  } else if (connectedCount > 0) {
    message = `${connectedCount} upstream provider${connectedCount === 1 ? "" : "s"} connected through ${isExternalServer ? "the configured OpenCode server" : "OpenCode"}.`;
  } else {
    message = isExternalServer
      ? "Connected to the configured OpenCode server, but it did not report any connected upstream providers."
      : "OpenCode is available, but it did not report any connected upstream providers.";
  }

  return buildServerProvider({
    presentation,
    enabled: true,
    checkedAt,
    models,
    slashCommands: mapOpenCodeCommands(inventoryExit.value.commands),
    probe: {
      installed: true,
      version,
      status: isReady ? "ready" : "warning",
      auth: {
        status: isReady ? "authenticated" : "unknown",
        type: "opencode",
      },
      message,
    },
  });
});
