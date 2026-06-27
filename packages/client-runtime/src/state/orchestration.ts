import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createOrchestrationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    turnDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:turn-diff",
      tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
    }),
    fullThreadDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:full-thread-diff",
      tag: ORCHESTRATION_WS_METHODS.getFullThreadDiff,
    }),
    archivedShellSnapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:archived-shell-snapshot",
      tag: ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
    }),
    usageAnalytics: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:usage-analytics",
      tag: ORCHESTRATION_WS_METHODS.getUsageAnalytics,
      staleTimeMs: 300_000,
    }),
    usageLimits: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:usage-limits",
      tag: ORCHESTRATION_WS_METHODS.getUsageLimits,
      staleTimeMs: 60_000,
    }),
  };
}
