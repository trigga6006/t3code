import { useMemo, useState } from "react";
import { useUser } from "@clerk/react";
import { useAtomValue } from "@effect/atom-react";
import { SparklesIcon } from "lucide-react";
import type { EnvironmentId, UsageAnalyticsTimeRange } from "@t3tools/contracts";

import { Card, CardPanel } from "../ui/card";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { useEnvironmentQuery } from "../../state/query";
import { orchestrationEnvironment } from "../../state/orchestration";
import { primaryServerProvidersAtom } from "../../state/server";
import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { buildModelNameResolver } from "./analytics.logic";
import { OverviewPanel } from "./OverviewPanel";
import { ModelsPanel } from "./ModelsPanel";

type DashboardTab = "overview" | "models";

const TIME_RANGES: ReadonlyArray<{ value: UsageAnalyticsTimeRange; label: string }> = [
  { value: "all", label: "All" },
  { value: "30d", label: "30d" },
  { value: "7d", label: "7d" },
];

/** Clerk only mounts a provider when cloud is configured; match main.tsx. */
function isClerkConfigured(): boolean {
  return Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) &&
    hasCloudPublicConfig();
}

function ClerkFirstName({ fallback }: { fallback: string }) {
  const { user, isLoaded } = useUser();
  const name = isLoaded ? user?.firstName?.trim() : null;
  return <>{name && name.length > 0 ? name : fallback}</>;
}

/** Greets by Clerk first name when available, else a neutral fallback. */
function GreetingName({ fallback }: { fallback: string }) {
  return isClerkConfigured() ? <ClerkFirstName fallback={fallback} /> : <>{fallback}</>;
}

export function UsageAnalyticsDashboard({ environmentId }: { environmentId: EnvironmentId }) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [timeRange, setTimeRange] = useState<UsageAnalyticsTimeRange>("all");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const providers = useAtomValue(primaryServerProvidersAtom);
  const resolveModelName = useMemo(() => buildModelNameResolver(providers), [providers]);

  const analytics = useEnvironmentQuery(
    orchestrationEnvironment.usageAnalytics({ environmentId, input: { timeRange } }),
  );

  return (
    <div className="h-full w-full overflow-y-auto pt-6 pb-40">
      <div className="chat-composer-horizontal-inset">
        <div className="mx-auto w-full max-w-208">
          <div className="flex w-full max-w-md flex-col gap-2.5">
            <div className="flex items-center gap-1.5 px-0.5">
              <SparklesIcon className="size-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">
                What's up next, <GreetingName fallback="there" />?
              </h2>
            </div>

            <Card>
              <CardPanel className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ToggleGroup
                variant="outline"
                size="xs"
                value={[activeTab]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "overview" || next === "models") setActiveTab(next);
                }}
              >
                <Toggle value="overview">Overview</Toggle>
                <Toggle value="models">Models</Toggle>
              </ToggleGroup>

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
            </div>

            {analytics.isPending && !analytics.data ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground/50">
                Loading your usage…
              </div>
            ) : analytics.error ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground/60">
                <span>Couldn't load usage analytics.</span>
                <span className="max-w-md text-xs text-muted-foreground/40">{analytics.error}</span>
                <button
                  type="button"
                  onClick={analytics.refresh}
                  className="text-xs text-primary hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : analytics.data ? (
              activeTab === "overview" ? (
                <OverviewPanel
                  data={analytics.data}
                  timeRange={timeRange}
                  today={today}
                  resolveModelName={resolveModelName}
                />
              ) : (
                <ModelsPanel
                  data={analytics.data}
                  timeRange={timeRange}
                  today={today}
                  resolveModelName={resolveModelName}
                />
              )
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground/50">
                No usage data yet — send your first message to get started.
              </div>
            )}
              </CardPanel>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
