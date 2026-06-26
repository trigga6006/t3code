import type { UsageAnalyticsSummary, UsageAnalyticsTimeRange } from "@t3tools/contracts";

import { ActivityHeatmap } from "./ActivityHeatmap";
import {
  formatCompactTokens,
  formatCount,
  formatStreak,
  prideAndPrejudiceComparison,
} from "./analytics.logic";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border/60 bg-card/40 px-2 py-1.5">
      <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      <span className="truncate text-sm font-semibold tabular-nums text-foreground" title={value}>
        {value}
      </span>
    </div>
  );
}

export function OverviewPanel({
  data,
  timeRange,
  today,
  resolveModelName,
}: {
  data: UsageAnalyticsSummary;
  timeRange: UsageAnalyticsTimeRange;
  today: string;
  resolveModelName: (slug: string) => string;
}) {
  const funLine = prideAndPrejudiceComparison(data.totalTokens);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <StatTile label="Sessions" value={formatCount(data.sessionCount)} />
        <StatTile label="Messages" value={formatCount(data.messageCount)} />
        <StatTile label="Total tokens" value={formatCompactTokens(data.totalTokens)} />
        <StatTile label="Active days" value={formatCount(data.activeDays)} />
        <StatTile label="Current streak" value={formatStreak(data.currentStreak)} />
        <StatTile label="Longest streak" value={formatStreak(data.longestStreak)} />
        <StatTile label="Peak hour" value={data.peakHour ?? "—"} />
        <StatTile
          label="Favorite model"
          value={data.favoriteModel ? resolveModelName(data.favoriteModel) : "—"}
        />
      </div>
      <ActivityHeatmap dailyActivity={data.dailyActivity} timeRange={timeRange} today={today} />
      {funLine ? <p className="text-[11px] text-muted-foreground/60">{funLine}</p> : null}
    </div>
  );
}
