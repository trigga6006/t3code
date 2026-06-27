/**
 * Pure formatting helpers for the read-only usage-limits modal. Kept free of
 * React / framework imports so they can be unit-tested directly in Node (see
 * `usage-limits.logic.test.ts`), mirroring `analytics.logic.ts`.
 */

/** Clamp to 0-100 and round to a whole-number percentage label (e.g. "42%"). */
export function formatUsedPercent(usedPercent: number): string {
  if (!Number.isFinite(usedPercent)) {
    return "—";
  }
  const clamped = Math.max(0, Math.min(100, usedPercent));
  return `${Math.round(clamped)}%`;
}

/** Width style value (0-100) for a usage bar, clamped and rounded to 0.1%. */
export function usageBarWidthPercent(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(100, usedPercent)) * 10) / 10;
}

/**
 * Tailwind background class for a usage bar, escalating as the window fills:
 * primary (<75%), amber (75-90%), rose (>90%).
 */
export function usageBarToneClass(usedPercent: number): string {
  if (Number.isFinite(usedPercent) && usedPercent >= 90) {
    return "bg-rose-500";
  }
  if (Number.isFinite(usedPercent) && usedPercent >= 75) {
    return "bg-amber-500";
  }
  return "bg-primary";
}

/**
 * Human "resets in …" label from an epoch-ms reset timestamp relative to
 * `nowMs`. Returns null when `resetsAt` is null/invalid. When the reset moment
 * has already passed, returns "resets now". Otherwise shows the two most
 * significant units, e.g. "resets in 2d 4h", "resets in 3h 12m", "resets in
 * 5m".
 */
export function formatResetCountdown(resetsAt: number | null, nowMs: number): string | null {
  if (resetsAt === null || !Number.isFinite(resetsAt)) {
    return null;
  }
  const remainingMs = resetsAt - nowMs;
  if (remainingMs <= 0) {
    return "resets now";
  }
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `resets in ${days}d ${hours}h` : `resets in ${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `resets in ${hours}h ${minutes}m` : `resets in ${hours}h`;
  }
  if (minutes > 0) {
    return `resets in ${minutes}m`;
  }
  return "resets in <1m";
}
