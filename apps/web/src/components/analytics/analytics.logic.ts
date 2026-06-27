import {
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  type ModelTokenUsage,
  type ServerProvider,
  type UsageAnalyticsTimeRange,
  type UsageDailyCount,
  type UsageDailyTokens,
} from "@t3tools/contracts";

import { getDisplayModelName, type ModelEsque } from "../chat/providerIconUtils";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Approx. token count of Jane Austen's "Pride and Prejudice" (~122k words). */
const PRIDE_AND_PREJUDICE_TOKENS = 160_000;

// --- number / label formatting --------------------------------------------

/** Thousands-separated integer, e.g. 161016 -> "161,016". */
export function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

/** Compact token count keeping one decimal for k/M, e.g. 139_900_000 -> "139.9M". */
export function formatCompactTokens(value: number): string {
  const n = Math.max(0, Math.round(value));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

/** "12.5M in · 76.0M out" */
export function formatTokensInOut(inputTokens: number, outputTokens: number): string {
  return `${formatCompactTokens(inputTokens)} in · ${formatCompactTokens(outputTokens)} out`;
}

export function formatStreak(days: number): string {
  return `${Math.max(0, Math.round(days))}d`;
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Playful comparison line, or null when there isn't enough usage to brag about. */
export function prideAndPrejudiceComparison(totalTokens: number): string | null {
  if (totalTokens <= 0) return null;
  const ratio = totalTokens / PRIDE_AND_PREJUDICE_TOKENS;
  if (ratio < 1) return null;
  return `You've used ~${formatCount(Math.round(ratio))}× more tokens than Pride and Prejudice.`;
}

// --- UTC date helpers (server buckets days/hours in UTC) --------------------

function toUtcMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, delta: number): string {
  return fromUtcMs(toUtcMs(date) + delta * DAY_MS);
}

function weekdayUtc(date: string): number {
  return new Date(toUtcMs(date)).getUTCDay(); // 0 = Sunday
}

/** Inclusive list of ISO dates from `startDate` to `endDate`. */
export function eachDay(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const end = toUtcMs(endDate);
  for (let ms = toUtcMs(startDate); ms <= end; ms += DAY_MS) {
    out.push(fromUtcMs(ms));
  }
  return out;
}

export function formatMonthDay(date: string): string {
  return new Date(toUtcMs(date)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// --- activity heatmap ------------------------------------------------------

export interface HeatmapCell {
  readonly date: string;
  readonly count: number;
}

export interface HeatmapData {
  /** Columns of (up to) 7 cells, Sunday-first; null entries are calendar padding. */
  readonly weeks: ReadonlyArray<ReadonlyArray<HeatmapCell | null>>;
  readonly maxCount: number;
}

function heatmapWindowStart(
  dailyActivity: ReadonlyArray<UsageDailyCount>,
  timeRange: UsageAnalyticsTimeRange,
  end: string,
): string {
  if (timeRange === "7d") return addDays(end, -6);
  if (timeRange === "30d") return addDays(end, -29);
  // "all": show up to ~1 year, starting at the earliest active day (capped).
  const earliest = dailyActivity.reduce<string | null>(
    (min, day) => (min === null || day.date < min ? day.date : min),
    null,
  );
  if (earliest === null) return addDays(end, -29);
  const cap = addDays(end, -364);
  return earliest > cap ? earliest : cap;
}

export function buildHeatmap(
  dailyActivity: ReadonlyArray<UsageDailyCount>,
  timeRange: UsageAnalyticsTimeRange,
  today: string,
): HeatmapData {
  const countByDate = new Map<string, number>();
  for (const day of dailyActivity) countByDate.set(day.date, day.count);

  const start = heatmapWindowStart(dailyActivity, timeRange, today);
  // Pad back to the preceding Sunday so each column is a full week.
  const paddedStart = addDays(start, -weekdayUtc(start));

  const weeks: (HeatmapCell | null)[][] = [];
  let current: (HeatmapCell | null)[] = [];
  let maxCount = 0;
  for (const date of eachDay(paddedStart, today)) {
    if (date >= start && date <= today) {
      const count = countByDate.get(date) ?? 0;
      if (count > maxCount) maxCount = count;
      current.push({ date, count });
    } else {
      current.push(null);
    }
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push(null);
    weeks.push(current);
  }
  return { weeks, maxCount };
}

export function heatmapLevel(count: number, maxCount: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || maxCount <= 0) return 0;
  const ratio = count / maxCount;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

// --- tokens-over-time bar buckets ------------------------------------------

export interface TokenBucket {
  readonly date: string;
  readonly tokens: number;
}

/**
 * Even-spaced token buckets for the bar chart. Daily bars for short windows;
 * weekly buckets once the window grows past ~45 days so the chart stays legible.
 */
export function buildTokenBuckets(
  dailyTokens: ReadonlyArray<UsageDailyTokens>,
  timeRange: UsageAnalyticsTimeRange,
  today: string,
): TokenBucket[] {
  const tokensByDate = new Map<string, number>();
  for (const day of dailyTokens) tokensByDate.set(day.date, day.tokens);

  let start: string;
  if (timeRange === "7d") start = addDays(today, -6);
  else if (timeRange === "30d") start = addDays(today, -29);
  else {
    const earliest = dailyTokens.reduce<string | null>(
      (min, day) => (min === null || day.date < min ? day.date : min),
      null,
    );
    start = earliest ?? addDays(today, -29);
  }

  const days = eachDay(start, today);
  if (days.length <= 45) {
    return days.map((date) => ({ date, tokens: tokensByDate.get(date) ?? 0 }));
  }
  const buckets: TokenBucket[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const slice = days.slice(i, i + 7);
    const tokens = slice.reduce((sum, date) => sum + (tokensByDate.get(date) ?? 0), 0);
    buckets.push({ date: slice[0]!, tokens });
  }
  return buckets;
}

// --- model slug -> display name -------------------------------------------

/**
 * Build a resolver mapping a stored model slug (e.g. "claude-opus-4-8") to a
 * friendly label (e.g. "Opus 4.8") using the server's provider model metadata.
 * Falls back to the raw slug when no match is found.
 */
export function buildModelNameResolver(
  providers: ReadonlyArray<ServerProvider>,
): (slug: string) => string {
  const bySlug = new Map<string, ModelEsque>();
  for (const provider of providers) {
    for (const model of provider.models) {
      if (!bySlug.has(model.slug)) {
        bySlug.set(model.slug, {
          slug: model.slug,
          name: model.name,
          shortName: model.shortName ?? undefined,
          subProvider: model.subProvider ?? undefined,
        });
      }
    }
  }
  return (slug: string) => {
    const model = bySlug.get(slug);
    return model ? getDisplayModelName(model, { preferShortName: true }) : slug;
  };
}

// --- model -> provider attribution ----------------------------------------

export interface ModelProviderAttribution {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
}

/** The shape needed to attribute a usage row to a provider. */
export type AttributableModelRow = Pick<ModelTokenUsage, "model" | "instanceId">;

/**
 * Build a resolver that attributes a model-usage row to the provider that
 * produced it, so usage (e.g. OpenRouter's) can be grouped/badged by provider.
 *
 * Resolution order (most authoritative first):
 *   1. the row's `instanceId` → the provider instance's driver,
 *   2. the model slug appearing in a provider's discovered model list,
 *   3. the slug's first path segment matching a known driver kind — this
 *      covers `openrouter/<id>` slugs even before OpenRouter's dynamic model
 *      list has loaded.
 * Returns null when the provider can't be determined (the UI falls back to an
 * "Other" bucket / no badge).
 */
export function buildModelProviderResolver(
  providers: ReadonlyArray<ServerProvider>,
): (row: AttributableModelRow) => ModelProviderAttribution | null {
  const driverByInstance = new Map<string, ProviderDriverKind>();
  const driverBySlug = new Map<string, ProviderDriverKind>();
  const knownDrivers = new Set<string>();

  for (const provider of providers) {
    knownDrivers.add(String(provider.driver));
    if (provider.instanceId != null) {
      driverByInstance.set(String(provider.instanceId), provider.driver);
    }
    for (const model of provider.models) {
      if (!driverBySlug.has(model.slug)) {
        driverBySlug.set(model.slug, provider.driver);
      }
    }
  }

  const attribute = (driver: ProviderDriverKind): ModelProviderAttribution => ({
    driverKind: driver,
    displayName: PROVIDER_DISPLAY_NAMES[driver] ?? String(driver),
  });

  return (row) => {
    if (row.instanceId) {
      const byInstance = driverByInstance.get(row.instanceId);
      if (byInstance) return attribute(byInstance);
    }
    const bySlug = driverBySlug.get(row.model);
    if (bySlug) return attribute(bySlug);

    const slashIndex = row.model.indexOf("/");
    if (slashIndex > 0) {
      const firstSegment = row.model.slice(0, slashIndex);
      if (knownDrivers.has(firstSegment)) {
        return attribute(ProviderDriverKind.make(firstSegment));
      }
    }
    return null;
  };
}

/** A provider group of model-usage rows, for the Model usage settings tab. */
export interface ProviderUsageGroup {
  readonly driverKind: ProviderDriverKind | null;
  readonly displayName: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly percentage: number;
  readonly models: ReadonlyArray<ModelTokenUsage>;
}

/**
 * Group a model breakdown into per-provider buckets (descending by tokens),
 * with each bucket's models sorted descending by tokens. Rows that can't be
 * attributed fall into a trailing "Other" group (driverKind null).
 */
export function groupModelUsageByProvider(
  modelBreakdown: ReadonlyArray<ModelTokenUsage>,
  resolveProvider: (row: AttributableModelRow) => ModelProviderAttribution | null,
): ReadonlyArray<ProviderUsageGroup> {
  const OTHER_KEY = "__other__";
  const groups = new Map<
    string,
    {
      driverKind: ProviderDriverKind | null;
      displayName: string;
      models: ModelTokenUsage[];
      inputTokens: number;
      outputTokens: number;
    }
  >();

  for (const row of modelBreakdown) {
    const attribution = resolveProvider(row);
    const key = attribution ? String(attribution.driverKind) : OTHER_KEY;
    let group = groups.get(key);
    if (!group) {
      group = {
        driverKind: attribution?.driverKind ?? null,
        displayName: attribution?.displayName ?? "Other",
        models: [],
        inputTokens: 0,
        outputTokens: 0,
      };
      groups.set(key, group);
    }
    group.models.push(row);
    group.inputTokens += row.inputTokens;
    group.outputTokens += row.outputTokens;
  }

  const totalAllTokens = modelBreakdown.reduce(
    (sum, row) => sum + row.inputTokens + row.outputTokens,
    0,
  );

  return Array.from(groups.values())
    .map((group) => {
      const totalTokens = group.inputTokens + group.outputTokens;
      return {
        driverKind: group.driverKind,
        displayName: group.displayName,
        inputTokens: group.inputTokens,
        outputTokens: group.outputTokens,
        totalTokens,
        percentage: totalAllTokens > 0 ? (totalTokens / totalAllTokens) * 100 : 0,
        models: [...group.models].sort(
          (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
        ),
      } satisfies ProviderUsageGroup;
    })
    .sort((a, b) => {
      // "Other" always sorts last; otherwise descending by tokens.
      if (a.driverKind === null) return 1;
      if (b.driverKind === null) return -1;
      return b.totalTokens - a.totalTokens;
    });
}
