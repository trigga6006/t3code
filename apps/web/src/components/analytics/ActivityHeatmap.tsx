import { memo, useMemo } from "react";
import type { UsageAnalyticsTimeRange, UsageDailyCount } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { buildHeatmap, heatmapLevel } from "./analytics.logic";

const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-muted/40",
  1: "bg-primary/25",
  2: "bg-primary/45",
  3: "bg-primary/70",
  4: "bg-primary",
};

export const ActivityHeatmap = memo(function ActivityHeatmap({
  dailyActivity,
  timeRange,
  today,
}: {
  dailyActivity: ReadonlyArray<UsageDailyCount>;
  timeRange: UsageAnalyticsTimeRange;
  today: string;
}) {
  const { weeks, maxCount } = useMemo(
    () => buildHeatmap(dailyActivity, timeRange, today),
    [dailyActivity, timeRange, today],
  );

  return (
    <div
      className="flex gap-0.5 overflow-x-auto pb-1"
      role="img"
      aria-label="Daily activity heatmap"
    >
      {weeks.map((week, weekIndex) => (
        <div key={week.find((cell) => cell)?.date ?? `week-${weekIndex}`} className="flex flex-col gap-0.5">
          {week.map((cell, dayIndex) =>
            cell ? (
              <div
                key={cell.date}
                title={`${cell.date}: ${cell.count} message${cell.count === 1 ? "" : "s"}`}
                aria-label={`${cell.date}: ${cell.count}`}
                className={cn("size-2 rounded-[2px]", LEVEL_CLASS[heatmapLevel(cell.count, maxCount)])}
              />
            ) : (
              <div key={`pad-${weekIndex}-${dayIndex}`} className="size-2 rounded-[2px]" />
            ),
          )}
        </div>
      ))}
    </div>
  );
});
