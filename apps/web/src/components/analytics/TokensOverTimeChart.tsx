import { memo, useMemo } from "react";
import type { UsageAnalyticsTimeRange, UsageDailyTokens } from "@t3tools/contracts";

import { buildTokenBuckets, formatCompactTokens, formatMonthDay } from "./analytics.logic";

export const TokensOverTimeChart = memo(function TokensOverTimeChart({
  dailyTokens,
  timeRange,
  today,
}: {
  dailyTokens: ReadonlyArray<UsageDailyTokens>;
  timeRange: UsageAnalyticsTimeRange;
  today: string;
}) {
  const buckets = useMemo(
    () => buildTokenBuckets(dailyTokens, timeRange, today),
    [dailyTokens, timeRange, today],
  );
  const maxTokens = useMemo(
    () => buckets.reduce((max, bucket) => Math.max(max, bucket.tokens), 0),
    [buckets],
  );

  if (buckets.length === 0 || maxTokens === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-muted-foreground/50">
        No token usage in this range yet.
      </div>
    );
  }

  const labelIndexes = new Set([0, Math.floor(buckets.length / 2), buckets.length - 1]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-[10px] text-muted-foreground/60">
        <span className="tabular-nums">{formatCompactTokens(maxTokens)}</span>
        <span>tokens</span>
      </div>
      <div className="flex h-24 items-end gap-px" role="img" aria-label="Token usage over time">
        {buckets.map((bucket) => {
          const heightPct = (bucket.tokens / maxTokens) * 100;
          return (
            <div
              key={bucket.date}
              className="group flex min-w-px flex-1 items-end"
              title={`${formatMonthDay(bucket.date)}: ${formatCompactTokens(bucket.tokens)} tokens`}
            >
              <div
                className="w-full rounded-t-[2px] bg-primary/70 transition-colors group-hover:bg-primary"
                style={{ height: `${bucket.tokens > 0 ? Math.max(heightPct, 2) : 0}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground/60">
        {buckets.map((bucket, index) =>
          labelIndexes.has(index) ? <span key={bucket.date}>{formatMonthDay(bucket.date)}</span> : null,
        )}
      </div>
    </div>
  );
});
