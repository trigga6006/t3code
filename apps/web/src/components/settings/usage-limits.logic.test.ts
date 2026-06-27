import { describe, expect, it } from "vite-plus/test";

import {
  formatResetCountdown,
  formatUsedPercent,
  usageBarToneClass,
  usageBarWidthPercent,
} from "./usage-limits.logic.ts";

describe("formatUsedPercent", () => {
  it("rounds and clamps to 0-100", () => {
    expect(formatUsedPercent(42.4)).toBe("42%");
    expect(formatUsedPercent(42.6)).toBe("43%");
    expect(formatUsedPercent(-3)).toBe("0%");
    expect(formatUsedPercent(140)).toBe("100%");
  });

  it("returns em dash for non-finite values", () => {
    expect(formatUsedPercent(Number.NaN)).toBe("—");
  });
});

describe("usageBarWidthPercent", () => {
  it("clamps and rounds to 0.1%", () => {
    expect(usageBarWidthPercent(33.33)).toBe(33.3);
    expect(usageBarWidthPercent(-1)).toBe(0);
    expect(usageBarWidthPercent(200)).toBe(100);
  });
});

describe("usageBarToneClass", () => {
  it("escalates tone with utilization", () => {
    expect(usageBarToneClass(10)).toBe("bg-primary");
    expect(usageBarToneClass(74.9)).toBe("bg-primary");
    expect(usageBarToneClass(75)).toBe("bg-amber-500");
    expect(usageBarToneClass(89.9)).toBe("bg-amber-500");
    expect(usageBarToneClass(90)).toBe("bg-rose-500");
    expect(usageBarToneClass(100)).toBe("bg-rose-500");
  });
});

describe("formatResetCountdown", () => {
  const now = 1_700_000_000_000;

  it("returns null when resetsAt is null/invalid", () => {
    expect(formatResetCountdown(null, now)).toBe(null);
    expect(formatResetCountdown(Number.NaN, now)).toBe(null);
  });

  it("returns 'resets now' when already elapsed", () => {
    expect(formatResetCountdown(now - 1000, now)).toBe("resets now");
    expect(formatResetCountdown(now, now)).toBe("resets now");
  });

  it("formats days + hours", () => {
    const target = now + (2 * 24 * 60 + 4 * 60) * 60_000; // 2d 4h
    expect(formatResetCountdown(target, now)).toBe("resets in 2d 4h");
  });

  it("formats hours + minutes", () => {
    const target = now + (3 * 60 + 12) * 60_000; // 3h 12m
    expect(formatResetCountdown(target, now)).toBe("resets in 3h 12m");
  });

  it("formats minutes only and sub-minute", () => {
    expect(formatResetCountdown(now + 5 * 60_000, now)).toBe("resets in 5m");
    expect(formatResetCountdown(now + 30_000, now)).toBe("resets in <1m");
  });
});
