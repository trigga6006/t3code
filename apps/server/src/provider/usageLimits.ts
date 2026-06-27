/**
 * Pure normalizers that map each provider driver's bespoke rate-limit message
 * into the shared {@link NormalizedUsageWindow} shape consumed by the
 * usage-limits feature (contracts: `UsageLimitWindowSnapshot`).
 *
 * Kept free of Effect / framework imports so it can be unit-tested directly in
 * Node (see `usageLimits.test.ts`) and reused by both adapters.
 *
 * Window mapping:
 *   - OpenAI / Codex: the `primary` window is the ~5-hour window; `secondary`
 *     is the ~weekly window (V2AccountRateLimitsUpdatedNotification).
 *   - Anthropic / Claude: each `rate_limit_event` carries a single
 *     `SDKRateLimitInfo` window typed by `rateLimitType`; `five_hour` maps to
 *     the 5-hour window and any `seven_day*` variant maps to the weekly window.
 *     (`overage` and unknown types are ignored.)
 */

export type UsageWindowKind = "fiveHour" | "weekly";

export interface NormalizedUsageWindow {
  readonly window: UsageWindowKind;
  /** 0-100. */
  readonly usedPercent: number;
  /** Epoch milliseconds, or null when not reported. */
  readonly resetsAt: number | null;
  /** Nominal window length in minutes, or null when unknown. */
  readonly windowDurationMins: number | null;
}

/** Nominal window lengths used when a provider omits `windowDurationMins`. */
export const FIVE_HOUR_WINDOW_MINS = 300;
export const WEEKLY_WINDOW_MINS = 10080;

/**
 * Normalize a provider-supplied `resetsAt` value to epoch **milliseconds**.
 *
 * Providers report this as an absolute epoch timestamp, but the unit (seconds
 * vs. milliseconds) differs and is not always documented, so we apply a
 * magnitude heuristic: values below 1e12 are treated as epoch **seconds** and
 * scaled to milliseconds; values at or above 1e12 are assumed to already be in
 * milliseconds. (1e12 ms ≈ 2001; 1e12 s ≈ year 33658 — so the boundary cleanly
 * separates plausible second- vs. millisecond-scale timestamps.)
 *
 * Returns null for null/undefined or non-finite / non-positive inputs.
 */
export function normalizeResetsAtToMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

function clampPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

/** Shape of one Codex rate-limit window (V2…__RateLimitWindow). */
export interface CodexRateLimitWindow {
  readonly usedPercent?: number | null;
  readonly resetsAt?: number | null;
  readonly windowDurationMins?: number | null;
}

/** Shape of the Codex rate-limit snapshot (V2…__RateLimitSnapshot). */
export interface CodexRateLimitSnapshot {
  readonly primary?: CodexRateLimitWindow | null;
  readonly secondary?: CodexRateLimitWindow | null;
}

function normalizeCodexWindow(
  window: CodexRateLimitWindow | null | undefined,
  kind: UsageWindowKind,
): NormalizedUsageWindow | null {
  if (window === null || window === undefined) {
    return null;
  }
  const usedPercent = clampPercent(window.usedPercent);
  if (usedPercent === null) {
    return null;
  }
  const fallbackMins = kind === "fiveHour" ? FIVE_HOUR_WINDOW_MINS : WEEKLY_WINDOW_MINS;
  const reportedMins =
    window.windowDurationMins !== null &&
    window.windowDurationMins !== undefined &&
    Number.isFinite(window.windowDurationMins)
      ? window.windowDurationMins
      : null;
  return {
    window: kind,
    usedPercent,
    resetsAt: normalizeResetsAtToMs(window.resetsAt),
    windowDurationMins: reportedMins ?? fallbackMins,
  };
}

/**
 * Map a Codex `{ primary, secondary }` snapshot to normalized 5-hour / weekly
 * windows. Accepts the snapshot object (i.e. `notification.rateLimits`).
 */
export function normalizeCodexRateLimits(
  snapshot: CodexRateLimitSnapshot | null | undefined,
): ReadonlyArray<NormalizedUsageWindow> {
  if (snapshot === null || snapshot === undefined) {
    return [];
  }
  const out: NormalizedUsageWindow[] = [];
  const five = normalizeCodexWindow(snapshot.primary, "fiveHour");
  if (five) out.push(five);
  const weekly = normalizeCodexWindow(snapshot.secondary, "weekly");
  if (weekly) out.push(weekly);
  return out;
}

/**
 * Subset of one window from the Claude Agent SDK `/usage` control-request
 * response (`SDKControlGetUsageResponse.rate_limits.{five_hour,seven_day,...}`).
 * Unlike the passive `rate_limit_event`, this is the TRUE on-demand plan usage:
 * `resets_at` is an ISO-8601 string (not an epoch number) and `utilization` is
 * the 0-100 percent used.
 */
export interface ClaudeUsageWindow {
  readonly utilization?: number | null;
  readonly resets_at?: string | null;
}

/** Subset of `SDKControlGetUsageResponse.rate_limits` we map into our windows. */
export interface ClaudeUsageRateLimits {
  /** The ~5-hour rolling window. */
  readonly five_hour?: ClaudeUsageWindow | null;
  /** The overall plan ~7-day (weekly) window — the headline weekly limit. */
  readonly seven_day?: ClaudeUsageWindow | null;
}

/** Parse a Claude `/usage` ISO-8601 `resets_at` to epoch milliseconds. */
function normalizeIsoResetsAtToMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim().length === 0) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeClaudeUsageWindow(
  window: ClaudeUsageWindow | null | undefined,
  kind: UsageWindowKind,
): NormalizedUsageWindow | null {
  if (window === null || window === undefined) {
    return null;
  }
  const usedPercent = clampPercent(window.utilization);
  if (usedPercent === null) {
    return null;
  }
  return {
    window: kind,
    usedPercent,
    resetsAt: normalizeIsoResetsAtToMs(window.resets_at),
    windowDurationMins: kind === "fiveHour" ? FIVE_HOUR_WINDOW_MINS : WEEKLY_WINDOW_MINS,
  };
}

/**
 * Map the Claude `/usage` control-request response's `rate_limits` object into
 * normalized 5-hour / weekly windows. `seven_day` is the overall plan weekly
 * limit (per-model `seven_day_opus`/`seven_day_sonnet` are intentionally not
 * surfaced as the headline weekly). When `rateLimitsAvailable` is `false` (API
 * key / Bedrock / Vertex sessions have no subscription plan limits) this returns
 * an empty array rather than treating it as an error.
 */
export function normalizeClaudeUsageResponse(
  rateLimits: ClaudeUsageRateLimits | null | undefined,
  rateLimitsAvailable?: boolean,
): ReadonlyArray<NormalizedUsageWindow> {
  if (rateLimitsAvailable === false) {
    return [];
  }
  if (rateLimits === null || rateLimits === undefined) {
    return [];
  }
  const out: NormalizedUsageWindow[] = [];
  const five = normalizeClaudeUsageWindow(rateLimits.five_hour, "fiveHour");
  if (five) out.push(five);
  const weekly = normalizeClaudeUsageWindow(rateLimits.seven_day, "weekly");
  if (weekly) out.push(weekly);
  return out;
}

/** Subset of SDKRateLimitInfo we depend on (Claude Agent SDK rate_limit_event). */
export interface ClaudeRateLimitInfo {
  readonly status?: string;
  readonly resetsAt?: number;
  readonly rateLimitType?: string;
  readonly utilization?: number;
}

/** Shape of the Claude `rate_limit_event` message (SDKRateLimitEvent). */
export interface ClaudeRateLimitEvent {
  readonly rate_limit_info?: ClaudeRateLimitInfo | null;
}

function claudeWindowKind(rateLimitType: string | undefined): UsageWindowKind | null {
  switch (rateLimitType) {
    case "five_hour":
      return "fiveHour";
    case "seven_day":
    case "seven_day_opus":
    case "seven_day_sonnet":
      return "weekly";
    default:
      // "overage" and any unknown/missing type carry no 5h/weekly window.
      return null;
  }
}

/**
 * Map a Claude `rate_limit_event` to (at most) a single normalized window. Each
 * event reports one window keyed by `rateLimitType`, so callers must merge
 * successive events to assemble both the 5-hour and weekly views.
 */
export function normalizeClaudeRateLimitEvent(
  event: ClaudeRateLimitEvent | null | undefined,
): ReadonlyArray<NormalizedUsageWindow> {
  const info = event?.rate_limit_info;
  if (info === null || info === undefined) {
    return [];
  }
  const kind = claudeWindowKind(info.rateLimitType);
  if (kind === null) {
    return [];
  }
  const usedPercent = clampPercent(info.utilization);
  if (usedPercent === null) {
    return [];
  }
  return [
    {
      window: kind,
      usedPercent,
      resetsAt: normalizeResetsAtToMs(info.resetsAt),
      windowDurationMins: kind === "fiveHour" ? FIVE_HOUR_WINDOW_MINS : WEEKLY_WINDOW_MINS,
    },
  ];
}
