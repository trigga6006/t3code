import { useState } from "react";
import type { UsageAnalyticsSummary, UsageAnalyticsTimeRange } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { TokensOverTimeChart } from "./TokensOverTimeChart";
import {
  formatPercentage,
  formatTokensInOut,
  type AttributableModelRow,
  type ModelProviderAttribution,
} from "./analytics.logic";

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
  resolveModelProvider,
}: {
  data: UsageAnalyticsSummary;
  timeRange: UsageAnalyticsTimeRange;
  today: string;
  resolveModelName: (slug: string) => string;
  resolveModelProvider?: (row: AttributableModelRow) => ModelProviderAttribution | null;
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
          {visible.map((row, index) => {
            const attribution = resolveModelProvider?.(row) ?? null;
            const ProviderIcon = attribution
              ? PROVIDER_ICON_BY_PROVIDER[attribution.driverKind]
              : undefined;
            return (
            <div key={row.model} className="flex items-center gap-2 py-0.5 text-xs">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-[3px]",
                  SWATCH_CLASSES[index % SWATCH_CLASSES.length],
                )}
              />
              {ProviderIcon ? (
                <ProviderIcon
                  className="size-3 shrink-0 text-muted-foreground/70"
                  aria-label={attribution?.displayName}
                />
              ) : null}
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
            );
          })}
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
