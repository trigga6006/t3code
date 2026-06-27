import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, SettingsIcon } from "lucide-react";
import type { EnvironmentId, ProviderUsageLimits, UsageLimitWindow } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { orchestrationEnvironment } from "../../state/orchestration";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton } from "../ui/sidebar";
import {
  formatResetCountdown,
  formatUsedPercent,
  usageBarToneClass,
  usageBarWidthPercent,
} from "./usage-limits.logic";

interface SettingsLimitsPopoverProps {
  environmentId: EnvironmentId | null;
  isMobile: boolean;
  onCloseMobileSidebar: () => void;
}

/**
 * A thin inset rule used to separate the stacked sections inside the popover.
 * It is horizontally inset (`mx-3`) so the line floats within the card instead
 * of running edge-to-edge.
 */
function InsetDivider() {
  return <div className="mx-3 h-px bg-border/60" />;
}

function UsageWindowBar({
  label,
  usageWindow,
  nowMs,
}: {
  label: string;
  usageWindow: UsageLimitWindow | null;
  nowMs: number;
}) {
  const countdown = usageWindow ? formatResetCountdown(usageWindow.resetsAt, nowMs) : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {usageWindow ? formatUsedPercent(usageWindow.usedPercent) : "—"}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        {usageWindow ? (
          <div
            className={cn(
              "h-full rounded-full transition-all",
              usageBarToneClass(usageWindow.usedPercent),
            )}
            style={{ width: `${usageBarWidthPercent(usageWindow.usedPercent)}%` }}
          />
        ) : null}
      </div>
      <span className="text-[10px] text-muted-foreground/50">
        {usageWindow ? (countdown ?? "reset time unknown") : "No data reported yet"}
      </span>
    </div>
  );
}

function ProviderUsageRow({ provider, nowMs }: { provider: ProviderUsageLimits; nowMs: number }) {
  // Reuse the same provider logo source the sidebar thread rows use so logos
  // stay consistent across the app.
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[provider.provider] ?? null;
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {ProviderIcon ? <ProviderIcon className="size-3.5 shrink-0 text-foreground" /> : null}
        <span className="text-xs font-semibold text-foreground">{provider.displayName}</span>
      </div>
      <UsageWindowBar label="5-hour" usageWindow={provider.fiveHour} nowMs={nowMs} />
      <UsageWindowBar label="Weekly" usageWindow={provider.weekly} nowMs={nowMs} />
    </div>
  );
}

function PopoverStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-16 items-center justify-center px-3 py-4 text-center text-xs text-muted-foreground/60">
      {children}
    </div>
  );
}

/**
 * Settings affordance rendered in the sidebar footer. The trigger is the
 * "Settings" menu button; activating it opens a compact popover anchored just
 * above the button (sized to sit within the sidebar panel). The popover header
 * links through to the full settings page, and the body lists each provider's
 * live 5-hour and weekly usage windows inline — all within a single card,
 * separated by inset rules rather than nested cards.
 */
export function SettingsLimitsPopover({
  environmentId,
  isMobile,
  onCloseMobileSidebar,
}: SettingsLimitsPopoverProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const usageLimits = useEnvironmentQuery(
    environmentId !== null && open
      ? orchestrationEnvironment.usageLimits({ environmentId, input: {} })
      : null,
  );

  // Tick a clock while the popover is open so reset countdowns stay current.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [open]);

  const providers = useMemo(() => usageLimits.data?.providers ?? [], [usageLimits.data]);

  const handleOpenSettingsPage = useCallback(() => {
    setOpen(false);
    if (isMobile) {
      onCloseMobileSidebar();
    }
    void navigate({ to: "/settings" });
  }, [isMobile, navigate, onCloseMobileSidebar]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <SidebarMenuButton
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
          />
        }
      >
        <SettingsIcon className="size-3.5" />
        <span className="text-xs">Settings</span>
      </PopoverTrigger>
      {/*
        Anchored above the Settings button and sized to fit within the sidebar
        panel (default sidebar width is 16rem; 15rem leaves a small inset on
        each side). `viewportClassName="p-0"` drops the popover's default inner
        padding so each stacked section controls its own spacing and the inset
        dividers read as one continuous card.
      */}
      <PopoverPopup
        side="top"
        align="center"
        sideOffset={8}
        className="w-60 max-w-[calc(100vw-1rem)]"
        viewportClassName="p-0"
      >
        <div className="flex flex-col">
          <button
            type="button"
            onClick={handleOpenSettingsPage}
            className="flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <SettingsIcon className="size-4 text-muted-foreground" />
            <span className="flex-1">Settings</span>
            <ChevronRightIcon className="size-4 text-muted-foreground/60" />
          </button>

          <InsetDivider />

          {usageLimits.isPending && !usageLimits.data ? (
            <PopoverStatus>Loading usage limits…</PopoverStatus>
          ) : usageLimits.error ? (
            <PopoverStatus>
              <span className="flex flex-col items-center gap-1.5">
                <span>Couldn't load usage limits.</span>
                <button
                  type="button"
                  onClick={usageLimits.refresh}
                  className="text-primary hover:underline"
                >
                  Try again
                </button>
              </span>
            </PopoverStatus>
          ) : providers.length > 0 ? (
            providers.map((provider, index) => (
              <Fragment key={provider.provider}>
                {index > 0 ? <InsetDivider /> : null}
                <ProviderUsageRow provider={provider} nowMs={nowMs} />
              </Fragment>
            ))
          ) : (
            <PopoverStatus>No usage limits available yet.</PopoverStatus>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
