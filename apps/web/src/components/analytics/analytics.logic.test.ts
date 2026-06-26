import { describe, expect, it } from "vite-plus/test";

import {
  addDays,
  buildHeatmap,
  buildModelNameResolver,
  buildTokenBuckets,
  eachDay,
  formatCompactTokens,
  formatCount,
  formatStreak,
  formatTokensInOut,
  heatmapLevel,
  prideAndPrejudiceComparison,
} from "./analytics.logic";

describe("analytics.logic formatting", () => {
  it("formats counts with thousands separators", () => {
    expect(formatCount(161016)).toBe("161,016");
    expect(formatCount(417)).toBe("417");
    expect(formatCount(-5)).toBe("0");
  });

  it("formats compact tokens keeping one decimal", () => {
    expect(formatCompactTokens(139_900_000)).toBe("139.9M");
    expect(formatCompactTokens(12_500_000)).toBe("12.5M");
    expect(formatCompactTokens(804_500)).toBe("804.5k");
    expect(formatCompactTokens(896)).toBe("896");
  });

  it("formats in/out token pairs", () => {
    expect(formatTokensInOut(12_500_000, 76_000_000)).toBe("12.5M in · 76.0M out");
  });

  it("formats streaks", () => {
    expect(formatStreak(33)).toBe("33d");
  });

  it("returns a pride-and-prejudice line only above the book's length", () => {
    expect(prideAndPrejudiceComparison(0)).toBeNull();
    expect(prideAndPrejudiceComparison(100)).toBeNull();
    expect(prideAndPrejudiceComparison(160_000 * 896)).toContain("896×");
  });
});

describe("analytics.logic date helpers", () => {
  it("adds days across month boundaries (UTC)", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("enumerates inclusive day ranges", () => {
    expect(eachDay("2026-06-01", "2026-06-03")).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
  });
});

describe("buildHeatmap", () => {
  it("produces full Sunday-aligned weeks and tracks the max count", () => {
    const today = "2026-06-26"; // Friday
    const heatmap = buildHeatmap(
      [
        { date: "2026-06-24", count: 3 },
        { date: "2026-06-26", count: 9 },
      ],
      "7d",
      today,
    );
    expect(heatmap.maxCount).toBe(9);
    for (const week of heatmap.weeks) {
      expect(week).toHaveLength(7);
    }
    const cells = heatmap.weeks.flat().filter((cell): cell is { date: string; count: number } => cell !== null);
    expect(cells.find((cell) => cell.date === "2026-06-26")?.count).toBe(9);
    // Days inside the window with no activity are zero-filled, not dropped.
    expect(cells.find((cell) => cell.date === "2026-06-25")?.count).toBe(0);
  });

  it("buckets intensity levels", () => {
    expect(heatmapLevel(0, 10)).toBe(0);
    expect(heatmapLevel(1, 10)).toBe(1);
    expect(heatmapLevel(10, 10)).toBe(4);
    expect(heatmapLevel(5, 0)).toBe(0);
  });
});

describe("buildTokenBuckets", () => {
  it("returns one bar per day for short ranges, zero-filling gaps", () => {
    const buckets = buildTokenBuckets([{ date: "2026-06-26", tokens: 500 }], "7d", "2026-06-26");
    expect(buckets).toHaveLength(7);
    expect(buckets[buckets.length - 1]).toEqual({ date: "2026-06-26", tokens: 500 });
    expect(buckets[0]?.tokens).toBe(0);
  });

  it("aggregates into weekly buckets for long ranges", () => {
    const daily = eachDay("2025-01-01", "2026-06-26").map((date) => ({ date, tokens: 10 }));
    const buckets = buildTokenBuckets(daily, "all", "2026-06-26");
    // Far fewer buckets than days, and each weekly bucket sums ~7 days.
    expect(buckets.length).toBeLessThan(daily.length);
    expect(buckets[0]?.tokens).toBeGreaterThanOrEqual(10);
  });
});

describe("buildModelNameResolver", () => {
  it("maps known slugs to display names and falls back to the slug", () => {
    const resolve = buildModelNameResolver([
      {
        models: [{ slug: "claude-opus-4-8", name: "Claude Opus 4.8", shortName: "Opus 4.8" }],
      },
    ] as never);
    expect(resolve("claude-opus-4-8")).toBe("Opus 4.8");
    expect(resolve("mystery-model")).toBe("mystery-model");
  });
});
