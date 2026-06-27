import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type ProviderUsageLimits, type UsageLimitWindow } from "@t3tools/contracts";

import type { NormalizedUsageWindow } from "./usageLimits.ts";
import { mergeProviderUsageLimits, normalizedWindowToContractWindow } from "./usageLimitsMerge.ts";

function persistedEntry(overrides?: Partial<ProviderUsageLimits>): ProviderUsageLimits {
  return {
    provider: ProviderDriverKind.make("claudeAgent"),
    displayName: "Anthropic" as ProviderUsageLimits["displayName"],
    fiveHour: null,
    weekly: null,
    updatedAt: 1_000,
    ...overrides,
  };
}

const liveFiveHour: NormalizedUsageWindow = {
  window: "fiveHour",
  usedPercent: 42,
  resetsAt: 5_000,
  windowDurationMins: 300,
};
const liveWeekly: NormalizedUsageWindow = {
  window: "weekly",
  usedPercent: 7,
  resetsAt: 9_000,
  windowDurationMins: 10080,
};

describe("normalizedWindowToContractWindow", () => {
  it("drops the window discriminant", () => {
    expect(normalizedWindowToContractWindow(liveFiveHour)).toEqual({
      usedPercent: 42,
      resetsAt: 5_000,
      windowDurationMins: 300,
    } satisfies UsageLimitWindow);
  });
});

describe("mergeProviderUsageLimits", () => {
  it("returns the persisted entry unchanged when there are no live windows", () => {
    const persisted = persistedEntry({
      fiveHour: { usedPercent: 1, resetsAt: 2, windowDurationMins: 300 },
    });
    const merged = mergeProviderUsageLimits({ persisted, live: [], nowMs: 999 });
    expect(merged).toBe(persisted);
  });

  it("overlays live windows over persisted and stamps updatedAt", () => {
    const persisted = persistedEntry({
      fiveHour: { usedPercent: 1, resetsAt: 2, windowDurationMins: 300 },
      weekly: { usedPercent: 3, resetsAt: 4, windowDurationMins: 10080 },
    });
    const merged = mergeProviderUsageLimits({
      persisted,
      live: [liveFiveHour, liveWeekly],
      nowMs: 12_345,
    });
    expect(merged.fiveHour).toEqual({ usedPercent: 42, resetsAt: 5_000, windowDurationMins: 300 });
    expect(merged.weekly).toEqual({ usedPercent: 7, resetsAt: 9_000, windowDurationMins: 10080 });
    expect(merged.updatedAt).toBe(12_345);
    expect(merged.provider).toBe(persisted.provider);
  });

  it("keeps the persisted window for any window the live read did not produce", () => {
    const persisted = persistedEntry({
      fiveHour: { usedPercent: 1, resetsAt: 2, windowDurationMins: 300 },
      weekly: { usedPercent: 3, resetsAt: 4, windowDurationMins: 10080 },
    });
    // Live read only returned the 5-hour window (e.g. weekly unavailable).
    const merged = mergeProviderUsageLimits({ persisted, live: [liveFiveHour], nowMs: 777 });
    expect(merged.fiveHour).toEqual({ usedPercent: 42, resetsAt: 5_000, windowDurationMins: 300 });
    // Weekly retained from persisted.
    expect(merged.weekly).toEqual({ usedPercent: 3, resetsAt: 4, windowDurationMins: 10080 });
    expect(merged.updatedAt).toBe(777);
  });

  it("populates a previously-empty entry from a live read", () => {
    const persisted = persistedEntry();
    const merged = mergeProviderUsageLimits({ persisted, live: [liveWeekly], nowMs: 555 });
    expect(merged.fiveHour).toBeNull();
    expect(merged.weekly).toEqual({ usedPercent: 7, resetsAt: 9_000, windowDurationMins: 10080 });
    expect(merged.updatedAt).toBe(555);
  });
});
