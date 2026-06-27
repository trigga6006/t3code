import { describe, expect, it } from "vite-plus/test";

import {
  FIVE_HOUR_WINDOW_MINS,
  WEEKLY_WINDOW_MINS,
  normalizeClaudeRateLimitEvent,
  normalizeClaudeUsageResponse,
  normalizeCodexRateLimits,
  normalizeResetsAtToMs,
} from "./usageLimits.ts";

describe("normalizeResetsAtToMs", () => {
  it("returns null for null/undefined/invalid", () => {
    expect(normalizeResetsAtToMs(null)).toBe(null);
    expect(normalizeResetsAtToMs(undefined)).toBe(null);
    expect(normalizeResetsAtToMs(0)).toBe(null);
    expect(normalizeResetsAtToMs(-5)).toBe(null);
    expect(normalizeResetsAtToMs(Number.NaN)).toBe(null);
  });

  it("scales epoch seconds to milliseconds", () => {
    // 2024-01-01T00:00:00Z = 1_704_067_200 s
    expect(normalizeResetsAtToMs(1_704_067_200)).toBe(1_704_067_200_000);
  });

  it("passes through millisecond timestamps", () => {
    expect(normalizeResetsAtToMs(1_704_067_200_000)).toBe(1_704_067_200_000);
  });
});

describe("normalizeCodexRateLimits", () => {
  it("maps primary->fiveHour and secondary->weekly", () => {
    const out = normalizeCodexRateLimits({
      primary: { usedPercent: 42, resetsAt: 1_704_067_200, windowDurationMins: 300 },
      secondary: { usedPercent: 7, resetsAt: 1_704_672_000, windowDurationMins: 10080 },
    });
    expect(out).toEqual([
      { window: "fiveHour", usedPercent: 42, resetsAt: 1_704_067_200_000, windowDurationMins: 300 },
      { window: "weekly", usedPercent: 7, resetsAt: 1_704_672_000_000, windowDurationMins: 10080 },
    ]);
  });

  it("fills default window durations when omitted and clamps percent", () => {
    const out = normalizeCodexRateLimits({
      primary: { usedPercent: 130 },
      secondary: { usedPercent: -5, resetsAt: null },
    });
    expect(out[0]).toEqual({
      window: "fiveHour",
      usedPercent: 100,
      resetsAt: null,
      windowDurationMins: FIVE_HOUR_WINDOW_MINS,
    });
    expect(out[1]).toEqual({
      window: "weekly",
      usedPercent: 0,
      resetsAt: null,
      windowDurationMins: WEEKLY_WINDOW_MINS,
    });
  });

  it("skips missing windows and handles null snapshot", () => {
    expect(normalizeCodexRateLimits(null)).toEqual([]);
    expect(normalizeCodexRateLimits({ primary: null, secondary: null })).toEqual([]);
    const onlyWeekly = normalizeCodexRateLimits({ secondary: { usedPercent: 12 } });
    expect(onlyWeekly).toHaveLength(1);
    expect(onlyWeekly[0]!.window).toBe("weekly");
  });
});

describe("normalizeClaudeRateLimitEvent", () => {
  it("maps five_hour to the fiveHour window", () => {
    const out = normalizeClaudeRateLimitEvent({
      rate_limit_info: {
        status: "allowed",
        rateLimitType: "five_hour",
        utilization: 55,
        resetsAt: 1_704_067_200,
      },
    });
    expect(out).toEqual([
      {
        window: "fiveHour",
        usedPercent: 55,
        resetsAt: 1_704_067_200_000,
        windowDurationMins: FIVE_HOUR_WINDOW_MINS,
      },
    ]);
  });

  it("maps every seven_day* variant to the weekly window", () => {
    for (const rateLimitType of ["seven_day", "seven_day_opus", "seven_day_sonnet"]) {
      const out = normalizeClaudeRateLimitEvent({
        rate_limit_info: { status: "allowed", rateLimitType, utilization: 20 },
      });
      expect(out).toHaveLength(1);
      expect(out[0]!.window).toBe("weekly");
      expect(out[0]!.windowDurationMins).toBe(WEEKLY_WINDOW_MINS);
    }
  });

  it("ignores overage / unknown / missing types and missing info", () => {
    expect(
      normalizeClaudeRateLimitEvent({
        rate_limit_info: { status: "allowed", rateLimitType: "overage", utilization: 5 },
      }),
    ).toEqual([]);
    expect(
      normalizeClaudeRateLimitEvent({ rate_limit_info: { status: "allowed", utilization: 5 } }),
    ).toEqual([]);
    expect(normalizeClaudeRateLimitEvent({ rate_limit_info: null })).toEqual([]);
    expect(normalizeClaudeRateLimitEvent(null)).toEqual([]);
  });

  it("drops events without a numeric utilization", () => {
    expect(
      normalizeClaudeRateLimitEvent({
        rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
      }),
    ).toEqual([]);
  });
});

describe("normalizeClaudeUsageResponse", () => {
  it("maps five_hour->fiveHour and seven_day->weekly with ISO reset parsing", () => {
    const out = normalizeClaudeUsageResponse(
      {
        five_hour: { utilization: 42, resets_at: "2024-01-01T00:00:00.000Z" },
        seven_day: { utilization: 7, resets_at: "2024-01-08T00:00:00.000Z" },
      },
      true,
    );
    expect(out).toEqual([
      {
        window: "fiveHour",
        usedPercent: 42,
        resetsAt: Date.parse("2024-01-01T00:00:00.000Z"),
        windowDurationMins: FIVE_HOUR_WINDOW_MINS,
      },
      {
        window: "weekly",
        usedPercent: 7,
        resetsAt: Date.parse("2024-01-08T00:00:00.000Z"),
        windowDurationMins: WEEKLY_WINDOW_MINS,
      },
    ]);
  });

  it("returns [] when rate limits are unavailable (API key / Bedrock / Vertex)", () => {
    expect(
      normalizeClaudeUsageResponse({ five_hour: { utilization: 10, resets_at: null } }, false),
    ).toEqual([]);
  });

  it("returns [] for null/undefined rate_limits", () => {
    expect(normalizeClaudeUsageResponse(null)).toEqual([]);
    expect(normalizeClaudeUsageResponse(undefined, true)).toEqual([]);
  });

  it("clamps utilization and tolerates a null reset timestamp", () => {
    const out = normalizeClaudeUsageResponse({
      five_hour: { utilization: 130, resets_at: null },
    });
    expect(out).toEqual([
      {
        window: "fiveHour",
        usedPercent: 100,
        resetsAt: null,
        windowDurationMins: FIVE_HOUR_WINDOW_MINS,
      },
    ]);
  });

  it("skips a window whose utilization is null/missing and surfaces only the present one", () => {
    const out = normalizeClaudeUsageResponse({
      five_hour: { utilization: null, resets_at: "2024-01-01T00:00:00.000Z" },
      seven_day: { utilization: 33, resets_at: "2024-01-08T00:00:00.000Z" },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.window).toBe("weekly");
    expect(out[0]!.usedPercent).toBe(33);
  });

  it("ignores an unparseable ISO reset timestamp (null) while keeping the window", () => {
    const out = normalizeClaudeUsageResponse({
      five_hour: { utilization: 12, resets_at: "not-a-date" },
    });
    expect(out).toEqual([
      {
        window: "fiveHour",
        usedPercent: 12,
        resetsAt: null,
        windowDurationMins: FIVE_HOUR_WINDOW_MINS,
      },
    ]);
  });
});
