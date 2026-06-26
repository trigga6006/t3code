import { useState } from "react";
import type { UsageAnalyticsSummary, UsageAnalyticsTimeRange } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { TokensOverTimeChart } from "./TokensOverTimeChart";
import { formatPercentage, formatTokensInOut } from "./analytics.logic";

const SWATCH_CLASSES = [
  "bg-primary",
  "bg-info",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-primary/60",
];

const COLLAPSED_COUNT = 5;

export function ModelsPanel({
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
  const [expanded, setExpanded] = useState(false);
  const rows = data.modelBreakdown;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);
  const hiddenCount = rows.length - visible.length;

  return (
    <div className="flex flex-col gap-3">
      <TokensOverTimeChart dailyTokens={data.dailyTokens} timeRange={timeRange} today={today} />

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground/50">No model usage in this range yet.</p>
      ) : (
        <div className="flex flex-col">
          {visible.map((row, index) => (
            <div key={row.model} className="flex items-center gap-2 py-0.5 text-xs">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-[3px]",
                  SWATCH_CLASSES[index % SWATCH_CLASSES.length],
                )}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {resolveModelName(row.model)}
              </span>
              <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/70">
                {formatTokensInOut(row.inputTokens, row.outputTokens)}
              </span>
              <span className="w-11 shrink-0 text-right tabular-nums text-[11px] font-medium text-foreground">
                {formatPercentage(row.percentage)}
              </span>
            </div>
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-1.5 self-start text-xs text-muted-foreground/60 hover:text-foreground"
            >
              Show {hiddenCount} more
            </button>
          ) : expanded && rows.length > COLLAPSED_COUNT ? (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-1.5 self-start text-xs text-muted-foreground/60 hover:text-foreground"
            >
              Show less
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
