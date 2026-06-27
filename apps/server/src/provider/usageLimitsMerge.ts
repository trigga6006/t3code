/**
 * Pure helpers for merging a freshly fetched ("live") provider usage snapshot
 * over the persisted one returned by `ProjectionSnapshotQuery.getUsageLimits`.
 *
 * The usage-limits modal fetches on open; the WS handler asks each provider for
 * a live read (see `ProviderService.readUsageLimits`) and overlays whatever it
 * gets on top of the persisted (passively-captured) snapshot. Live windows win
 * per (provider, window); any window the live read could not produce falls back
 * to the persisted value. Kept framework-free so it can be unit-tested directly
 * (see `usageLimitsMerge.test.ts`).
 */
import type { ProviderUsageLimits, UsageLimitWindow } from "@t3tools/contracts";

import type { NormalizedUsageWindow } from "./usageLimits.ts";

/** Drop the `window` discriminant to produce the contract window shape. */
export function normalizedWindowToContractWindow(
  window: NormalizedUsageWindow,
): UsageLimitWindow {
  return {
    usedPercent: window.usedPercent,
    resetsAt: window.resetsAt,
    windowDurationMins: window.windowDurationMins,
  };
}

/**
 * Overlay live windows on top of a persisted provider entry. When the live read
 * produced no windows, the persisted entry is returned unchanged (so a failed or
 * unsupported live read never blanks out previously-seen data). When at least
 * one live window is present, `updatedAt` is stamped to `nowMs`.
 */
export function mergeProviderUsageLimits(input: {
  readonly persisted: ProviderUsageLimits;
  readonly live: ReadonlyArray<NormalizedUsageWindow>;
  readonly nowMs: number;
}): ProviderUsageLimits {
  const liveFiveHour = input.live.find((window) => window.window === "fiveHour") ?? null;
  const liveWeekly = input.live.find((window) => window.window === "weekly") ?? null;

  if (liveFiveHour === null && liveWeekly === null) {
    return input.persisted;
  }

  return {
    ...input.persisted,
    fiveHour: liveFiveHour
      ? normalizedWindowToContractWindow(liveFiveHour)
      : input.persisted.fiveHour,
    weekly: liveWeekly ? normalizedWindowToContractWindow(liveWeekly) : input.persisted.weekly,
    updatedAt: input.nowMs,
  };
}
