import { useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { UsageAnalyticsTimeRange } from "@t3tools/contracts";

import { useActiveEnvironmentId } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerProvidersAtom } from "../../state/server";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  buildModelNameResolver,
  buildModelProviderResolver,
  formatCompactTokens,
  formatPercentage,
  formatTokensInOut,
  groupModelUsageByProvider,
  type ProviderUsageGroup,
} from "../analytics/analytics.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const TIME_RANGES: ReadonlyArray<{ value: UsageAnalyticsTimeRange; label: string }> = [
  { value: "all", label: "All" },
  { value: "30d", label: "30d" },
  { value: "7d", label: "7d" },
];

function ProviderUsageGroupBlock({
  group,
  resolveModelName,
}: {
  group: ProviderUsageGroup;
  resolveModelName: (slug: string) => string;
}) {
  const ProviderIcon = group.driverKind
    ? PROVIDER_ICON_BY_PROVIDER[group.driverKind]
    : undefined;

  return (
    <div className="border-t border-border/60 px-4 py-3.5 first:border-t-0 sm:px-5">
      <div className="flex items-center gap-2">
        {ProviderIcon ? (
          <ProviderIcon className="size-4 shrink-0 text-foreground/80" aria-hidden />
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
          {group.displayName}
        </span>
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/70">
          {formatTokensInOut(group.inputTokens, group.outputTokens)}
        </span>
        <span className="w-12 shrink-0 text-right tabular-nums text-[11px] font-semibold text-foreground">
          {formatPercentage(group.percentage)}
        </span>
      </div>

      {/* Provider share bar. */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, Math.max(0, group.percentage))}%` }}
        />
      </div>

      {/* Per-model rows within the provider. */}
      <div className="mt-2.5 flex flex-col gap-0.5 pl-6">
        {group.models.map((model) => (
          <div key={model.model} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-foreground/90">
              {resolveModelName(model.model)}
            </span>
            <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/60">
              {formatTokensInOut(model.inputTokens, model.outputTokens)}
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-[11px] text-muted-foreground/80">
              {formatPercentage(model.percentage)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ModelUsageSettingsPanel() {
  const [timeRange, setTimeRange] = useState<UsageAnalyticsTimeRange>("all");
  const environmentId = useActiveEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);

  const resolveModelName = useMemo(() => buildModelNameResolver(providers), [providers]);
  const resolveModelProvider = useMemo(() => buildModelProviderResolver(providers), [providers]);

  const analytics = useEnvironmentQuery(
    environmentId !== null
      ? orchestrationEnvironment.usageAnalytics({ environmentId, input: { timeRange } })
      : null,
  );

  const data = analytics.data;
  const groups = useMemo(
    () => (data ? groupModelUsageByProvider(data.modelBreakdown, resolveModelProvider) : []),
    [data, resolveModelProvider],
  );

  const timeRangeToggle = (
    <ToggleGroup
      variant="outline"
      size="xs"
      value={[timeRange]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "all" || next === "30d" || next === "7d") setTimeRange(next);
      }}
    >
      {TIME_RANGES.map((range) => (
        <Toggle key={range.value} value={range.value}>
          {range.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Model usage" headerAction={timeRangeToggle}>
        {environmentId === null ? (
          <div className="flex h-28 items-center justify-center px-4 text-center text-sm text-muted-foreground/50">
            Open a project to see per-model usage.
          </div>
        ) : analytics.isPending && !data ? (
          <div className="flex h-28 items-center justify-center text-sm text-muted-foreground/50">
            Loading model usage…
          </div>
        ) : analytics.error ? (
          <div className="flex h-28 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground/60">
            <span>Couldn't load model usage.</span>
            <span className="max-w-md text-xs text-muted-foreground/40">{analytics.error}</span>
            <button
              type="button"
              onClick={analytics.refresh}
              className="text-xs text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        ) : data && groups.length > 0 ? (
          <>
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-5">
              <span className="text-xs text-muted-foreground/80">
                Total tokens, grouped by provider
              </span>
              <span className="tabular-nums text-[13px] font-semibold text-foreground">
                {formatCompactTokens(data.totalTokens)}
              </span>
            </div>
            {groups.map((group) => (
              <ProviderUsageGroupBlock
                key={group.driverKind ?? "other"}
                group={group}
                resolveModelName={resolveModelName}
              />
            ))}
          </>
        ) : (
          <div className="flex h-28 items-center justify-center px-4 text-center text-sm text-muted-foreground/50">
            No model usage in this range yet — send a message to get started.
          </div>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
