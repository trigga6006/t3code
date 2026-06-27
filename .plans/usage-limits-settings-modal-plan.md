# Usage-Limits Settings Modal — Codebase Map & Implementation Plan

**Feature:** Clicking the Settings button in the sidebar opens a popup modal. The modal has a header
("Settings") and below it lists **both providers (OpenAI, Anthropic)**, each showing its **5-hour** and
**weekly** usage limits.

**Status:** Read-only familiarization pass. Nothing was modified.

**Headline finding:** Real 5-hour / weekly rate-limit data *already flows into the server* as runtime
events from both provider adapters — but it is **never persisted or surfaced to the client today**. So
this is primarily a "capture + expose live provider data" feature, not a "let the user type in limit
numbers" feature (though a hybrid is possible). See §4 and the Open Questions.

---

## 1. Sidebar + Settings button

**File:** `apps/web/src/components/Sidebar.tsx` — component `SidebarChromeFooter` (~line 2747).

There is already a Settings button. It currently **navigates to the `/settings` route** (and closes the
mobile drawer first):

```tsx
// ~line 2750
const handleSettingsClick = useCallback(() => {
  if (isMobile) setOpenMobile(false);
  void navigate({ to: "/settings" });
}, [isMobile, navigate, setOpenMobile]);

// ~line 2761
<SidebarMenuButton size="sm" className="gap-2 px-2 py-1.5 ..." onClick={handleSettingsClick}>
  <SettingsIcon className="size-3.5" />
  <span className="text-xs">Settings</span>
</SidebarMenuButton>
```

**Where the modal hooks in:** Two reasonable options.

- **(A) Replace navigation with modal open.** Add local state (`const [settingsOpen, setSettingsOpen] = useState(false)`) in `SidebarChromeFooter`, set it in `handleSettingsClick` instead of `navigate(...)`, and render `<UsageLimitsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />` in the footer. This matches how the sidebar already does dialogs (see the project-rename dialog at ~line 2361, which uses exactly this controlled `open`/`onOpenChange` pattern).
- **(B) Keep `/settings` route, add the modal as an additional entry point** (e.g. a small "limits" affordance). The prompt describes a popup on the Settings button itself, so **(A)** is the intended behavior.

State libs in this file: jotai-style atoms via `@effect/atom-react` (`useAtomValue`), plus React hooks
and a few zustand stores (`useSidebar`, `useUiStateStore`). The modal can be driven by plain `useState`.

**Provider logos** (added in commit `08d8572b5` for sidebar rows) live in
`apps/web/src/components/chat/providerIconUtils.ts`:

```ts
export const PROVIDER_ICON_BY_PROVIDER: Partial<Record<ProviderDriverKind, Icon>> = {
  [ProviderDriverKind.make("codex")]: OpenAI,        // OpenAI
  [ProviderDriverKind.make("claudeAgent")]: ClaudeAI, // Anthropic
  [ProviderDriverKind.make("opencode")]: OpenCodeIcon,
  [ProviderDriverKind.make("cursor")]: CursorIcon,
  [ProviderDriverKind.make("grok")]: GrokIcon,
};
```

There's also `PROVIDER_DISPLAY_NAMES` and a richer badge component
`apps/web/src/components/chat/ProviderInstanceIcon.tsx`. The new modal should reuse these so OpenAI/
Anthropic rows render with the same logo + label as the rest of the app.

---

## 2. Modal / dialog pattern (house style)

The codebase uses **Base UI** (`@base-ui/react`, the successor to Radix) wrapped in a local component
layer, styled with **Tailwind CSS v4 + semantic theme tokens** (the OmniCode theme).

**Primitive wrapper:** `apps/web/src/components/ui/dialog.tsx`

```ts
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
const Dialog = DialogPrimitive.Root;
// exports: Dialog, DialogTrigger, DialogClose, DialogBackdrop, DialogViewport,
//          DialogPopup, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogPanel
```

**Reference example to copy:** `apps/web/src/components/PullRequestThreadDialog.tsx`

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogPopup className="max-w-xl">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2"><SourceControlIcon className="size-4" /> …</DialogTitle>
      <DialogDescription>…</DialogDescription>
    </DialogHeader>
    <DialogPanel className="space-y-4">{/* body */}</DialogPanel>
    <DialogFooter>{/* buttons */}</DialogFooter>
  </DialogPopup>
</Dialog>
```

Styling: semantic tokens like `bg-popover`, `text-popover-foreground`, `bg-background`, `border`,
`rounded-2xl`, `max-sm:` responsive prefixes, `dark:` variants; backdrop is `bg-background/60
backdrop-blur-xs`; portal-rendered at `z-50`; open/close animated via `data-starting-style` /
`data-ending-style`. Open state is **controlled** (`open` + `onOpenChange`).

→ The new `UsageLimitsDialog` (a.k.a. Settings modal) should be a thin wrapper around `DialogPopup`
with a `DialogHeader` titled "Settings" and a `DialogPanel` listing the two provider rows.

---

## 3. Usage-analytics feature = the pattern to copy (commit `08d8572b5`)

This commit is the template for "add a new query that surfaces usage data." Full data flow:

### Contracts — `packages/contracts/src/orchestration.ts` (+ `rpc.ts`)
Effect **Schema** (not zod). Input/summary structs:

```ts
export const UsageAnalyticsTimeRange = Schema.Literals(["7d", "30d", "all"]);
export const UsageAnalyticsInput = Schema.Struct({ timeRange: UsageAnalyticsTimeRange });
export const ModelTokenUsage = Schema.Struct({ model, inputTokens, outputTokens, percentage });
export const UsageAnalyticsSummary = Schema.Struct({
  sessionCount, messageCount, totalTokens, activeDays, currentStreak, longestStreak,
  peakHour, favoriteModel, modelBreakdown, dailyActivity, dailyTokens,
});
```

RPC declared in `packages/contracts/src/rpc.ts`:

```ts
export const WsOrchestrationGetUsageAnalyticsRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getUsageAnalytics,
  { payload: ...input, success: ...output,
    error: Schema.Union([OrchestrationGetUsageAnalyticsError, EnvironmentAuthorizationError]) },
);
```
Method is mapped to **`AuthOrchestrationReadScope`** (read-only).

### Server — `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
`getUsageAnalytics(input)` is an `Effect.gen` that runs ~6 SQLite queries in parallel against the
**projection tables** (`projection_threads`, `projection_thread_messages`,
`projection_thread_activities`) and aggregates in memory. Token data comes from
`context-window.updated` activities, deduped per turn via `ROW_NUMBER() OVER (PARTITION BY thread_id,
turn_id ...)`. Service interface declared in `.../Services/ProjectionSnapshotQuery.ts`:

```ts
readonly getUsageAnalytics: (input: UsageAnalyticsInput)
  => Effect.Effect<UsageAnalyticsSummary, ProjectionRepositoryError>;
```

Handler registered in `apps/server/src/ws.ts`: added to `RPC_REQUIRED_SCOPE`
(`[getUsageAnalytics, AuthOrchestrationReadScope]`) and to the RPC handler map, wrapping the query with
`observeRpcEffect(...)` + error mapping.

### Client — `packages/client-runtime/src/state/orchestration.ts`
Effect **Atom** query atom family (5-min stale cache):

```ts
usageAnalytics: createEnvironmentRpcQueryAtomFamily(runtime, {
  label: "environment-data:orchestration:usage-analytics",
  tag: ORCHESTRATION_WS_METHODS.getUsageAnalytics,
  staleTimeMs: 300_000,
}),
```

### Web — `apps/web/src/components/analytics/*`
`UsageAnalyticsDashboard.tsx` reads the atom via `useEnvironmentQuery(orchestrationEnvironment.usageAnalytics({ environmentId, input: { timeRange } }))`, manages tabs/time-range with `ToggleGroup`, and renders `OverviewPanel` / `ModelsPanel`. Per-model rows (color swatch + name + tokens + percentage, expand/collapse) live in `ModelsPanel.tsx`; model slug→display-name via `buildModelNameResolver(providers)` in `analytics.logic.ts`. Pure helpers + unit tests in `analytics.logic.ts` / `analytics.logic.test.ts`.

**Takeaway:** to add usage-limits, mirror this stack: contract structs + RPC (read scope) → server query
method + service shape + ws.ts registration → client atom → web component. The only thing that differs is
the **data source** (see §4).

---

## 4. Provider / model config and where limit data comes from

### How providers are modeled
- `packages/contracts/src/providerInstance.ts` — `ProviderDriverKind` is an **open branded slug**
  (`"codex"` = OpenAI, `"claudeAgent"` = Anthropic, plus `cursor`, `grok`, `opencode`).
  `ProviderInstanceId` identifies a *configured instance*; multiple instances per driver are allowed.
- `packages/contracts/src/model.ts` — `ModelSelection { instanceId, model, options }`.
- `packages/contracts/src/settings.ts` — `ServerSettings.providers` (per-driver: `CodexSettings`,
  `ClaudeSettings`, …) and `ServerSettings.providerInstances: Record<ProviderInstanceId,
  ProviderInstanceConfig>`. Credentials/API keys live as `ProviderInstanceEnvironment` entries
  (`{ name, value, sensitive, valueRedacted }`); secret read/write goes through
  `ServerSettingsOperation` (`read-secret`/`write-secret`/...). The fork added "Claude subscription auth"
  but there is no dedicated subscription struct — auth is env-var / secret based.

### Rate-limit / usage-window data — THE KEY FINDING
Real windowed rate-limit data **already arrives at the server** as runtime events, from **both**
adapters:

- **OpenAI (Codex):** `apps/server/src/provider/Layers/CodexAdapter.ts:1119` translates
  `account/rateLimits/updated` into the runtime event `account.rate-limits.updated`. The upstream payload
  is fully typed in `packages/effect-codex-app-server/src/_generated/schema.gen.ts` as
  `V2AccountRateLimitsUpdatedNotification__RateLimitSnapshot`:

  ```ts
  { credits?, individualLimit?, limitId?, limitName?, planType?,
    primary?:   RateLimitWindow,   // ← the 5-hour window
    secondary?: RateLimitWindow,   // ← the weekly window
    rateLimitReachedType? }

  RateLimitWindow = { usedPercent: int, resetsAt?: int64|null, windowDurationMins?: int64|null }
  ```
  `primary`/`secondary` with `usedPercent` + `resetsAt` + `windowDurationMins` **is exactly the
  5-hour/weekly limit data** the feature needs (windowDurationMins ≈ 300 and ≈ 10080 respectively).

- **Anthropic (Claude):** `apps/server/src/provider/Layers/ClaudeAdapter.ts:2840` emits
  `account.rate-limits.updated` from the SDK's `rate_limit_event` message, but passes the raw message
  through **opaquely** (`payload: { rateLimits: message }`).

- **Contract:** `packages/contracts/src/providerRuntime.ts:537` types the runtime event payload as
  `AccountRateLimitsUpdatedPayload = { rateLimits: Schema.Unknown }` — deliberately opaque/driver-specific.

**Gap:** a repo-wide search found **no consumer** of `account.rate-limits.updated` in
`apps/server/src/orchestration/**`, in `packages/client-runtime`, or anywhere in `apps/web`. The events
are emitted and then dropped on the floor. Nothing persists the latest snapshot, and the web app never
reads it. There are also **no hardcoded "5h"/"weekly" constants** anywhere.

So the limit/usage values are **real and available**, but the wiring to capture → store latest →
expose → render does not exist yet.

### Local config store (if user-set limits are wanted instead/also)
`ClientSettings` (in `settings.ts`) holds local UI prefs and is the natural home for *user-defined* soft
caps; alternatively `ProviderInstanceConfig.config` (opaque `Unknown`) can hold per-instance limit
config. Neither has any limit field today.

---

## 5. Proposed implementation plan

Recommended interpretation (see Open Questions): **display the providers' real 5-hour & weekly windows**
(read-only), reusing the analytics RPC pattern, sourced from the live `account.rate-limits.updated`
events. Build in four layers + the modal.

### A. Capture the live snapshot (new — the missing wiring)
The cleanest source is the **runtime event**, not the SQLite projections (projections store token usage,
not provider rate-limit windows). Add a small server-side **"latest rate-limit snapshot" store** keyed by
`ProviderInstanceId` (or driver kind):

1. Normalize both adapters' payloads into one contract shape. Add to
   `packages/contracts/src/orchestration.ts`:
   ```ts
   export const UsageLimitWindow = Schema.Struct({
     usedPercent: Schema.Number,            // 0–100
     resetsAt: Schema.NullOr(Schema.Number),      // epoch ms/s
     windowDurationMins: Schema.NullOr(Schema.Number),
   });
   export const ProviderUsageLimits = Schema.Struct({
     provider: ProviderDriverKind,          // "codex" | "claudeAgent"
     displayName: TrimmedNonEmptyString,
     fiveHour: Schema.NullOr(UsageLimitWindow),   // <- primary
     weekly:   Schema.NullOr(UsageLimitWindow),   // <- secondary
     updatedAt: Schema.NullOr(Schema.Number),
   });
   export const UsageLimitsSummary = Schema.Struct({ providers: Schema.Array(ProviderUsageLimits) });
   export const UsageLimitsInput = Schema.Struct({});   // no params, or { instanceId? }
   ```
2. In `CodexAdapter.ts`, map `primary`→`fiveHour`, `secondary`→`weekly` (data already typed).
   In `ClaudeAdapter.ts`, parse the opaque `rate_limit_event` into the same two windows (needs a small
   parser for the Claude SDK shape — **investigate the actual `rate_limit_event` fields**, see Open Q).
3. Add a server layer that subscribes to `account.rate-limits.updated` and keeps the latest normalized
   `ProviderUsageLimits` per provider in memory (and optionally persists to a small projection/settings
   table so it survives restarts).

### B. Contracts + RPC (mirror analytics)
- `packages/contracts/src/orchestration.ts`: the structs above + `OrchestrationGetUsageLimitsError`,
  and `ORCHESTRATION_WS_METHODS.getUsageLimits`.
- `packages/contracts/src/rpc.ts`: `WsOrchestrationGetUsageLimitsRpc = Rpc.make(getUsageLimits, {
  payload, success: UsageLimitsSummary, error })`.

### C. Server query + registration (mirror analytics)
- `.../Services/ProjectionSnapshotQuery.ts` (or a new `ProviderUsageLimitsQuery` service if you keep it
  separate from projections): add `getUsageLimits(): Effect<UsageLimitsSummary, ...>` reading the
  in-memory snapshot store from (A).
- `.../Layers/ProjectionSnapshotQuery.ts`: implement it.
- `apps/server/src/ws.ts`: add `[getUsageLimits, AuthOrchestrationReadScope]` to `RPC_REQUIRED_SCOPE`
  and add the handler entry (wrap with `observeRpcEffect`, map error).

### D. Client atom (mirror analytics)
- `packages/client-runtime/src/state/orchestration.ts`: add
  ```ts
  usageLimits: createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:orchestration:usage-limits",
    tag: ORCHESTRATION_WS_METHODS.getUsageLimits,
    staleTimeMs: 60_000,   // limits move faster than analytics; shorter cache
  }),
  ```

### E. The Settings modal (web)
- New `apps/web/src/components/settings/UsageLimitsDialog.tsx` (or `components/usage-limits/`):
  `Dialog` + `DialogPopup` + `DialogHeader` ("Settings" title) + `DialogPanel`.
  Reads `useEnvironmentQuery(orchestrationEnvironment.usageLimits({ environmentId, input: {} }))`.
  Renders one row per provider using `PROVIDER_ICON_BY_PROVIDER` / `ProviderInstanceIcon` +
  `PROVIDER_DISPLAY_NAMES`, each with two small **limit bars** ("5-hour", "weekly") showing
  `usedPercent` and a "resets in …" countdown derived from `resetsAt` (reuse/extend the bar styling from
  `ModelsPanel.tsx`). Handle pending/error/empty states like `UsageAnalyticsDashboard.tsx`.
  Put pure formatting (percent, "resets in 3h 12m") in a `usage-limits.logic.ts` with unit tests, same as
  `analytics.logic.ts`.
- Wire into `Sidebar.tsx` `SidebarChromeFooter`: add `useState` for open, change `handleSettingsClick`
  to open the dialog, render `<UsageLimitsDialog .../>` (pattern matches the existing project-rename
  dialog in the same file).

### F. Verification
- Unit-test the payload normalizers (Codex `primary/secondary` → `fiveHour/weekly`; Claude
  `rate_limit_event` → same) and the formatters, mirroring `analytics.logic.test.ts` and
  `ProjectionSnapshotQueryUsage.test.ts`.
- Type-check the new contract↔server↔client wiring; smoke-test the modal with mocked atom data for
  pending/error/empty/populated.

### Files at a glance
| Layer | File | Change |
|---|---|---|
| Contracts | `packages/contracts/src/orchestration.ts` | + `UsageLimitWindow`, `ProviderUsageLimits`, `UsageLimitsInput/Summary`, error, WS method |
| Contracts | `packages/contracts/src/rpc.ts` | + `WsOrchestrationGetUsageLimitsRpc` |
| Server | `apps/server/src/provider/Layers/CodexAdapter.ts` | normalize `primary/secondary` |
| Server | `apps/server/src/provider/Layers/ClaudeAdapter.ts` | parse `rate_limit_event` → windows |
| Server | new snapshot store layer + `.../Services` & `.../Layers/ProjectionSnapshotQuery.ts` | `getUsageLimits` |
| Server | `apps/server/src/ws.ts` | scope + handler registration |
| Client | `packages/client-runtime/src/state/orchestration.ts` | + `usageLimits` atom |
| Web | `apps/web/src/components/settings/UsageLimitsDialog.tsx` (new) + `usage-limits.logic.ts` | modal UI |
| Web | `apps/web/src/components/Sidebar.tsx` | open modal from Settings button |

---

## 6. Open questions (resolve before building)

1. **Display vs. configure (the big one).** Are "5-hour and weekly usage limits" meant to be
   **(a) read-only display** of each provider's *actual* rate-limit windows (recommended — the data
   already exists), or **(b) user-configured caps** the app warns/enforces on? Evidence strongly favors
   (a): both adapters emit real windowed data; there is no UI or storage for user-set caps today. A
   **hybrid** is feasible (show real `usedPercent`/`resetsAt`, plus optional user soft-thresholds in
   `ClientSettings`). **Need the user's intent here.**

2. **Anthropic payload shape.** The Claude adapter forwards `rate_limit_event` opaquely. Confirm the
   actual fields the Claude Agent SDK emits (does it expose a 5-hour + weekly window with
   used%/reset like Codex, or only a single window / a "reached" flag?). This determines whether the
   Anthropic row can show both windows or only what the SDK provides. **Requires inspecting a live
   `rate_limit_event` or the Claude SDK message type.**

3. **Per-instance vs per-provider.** The app supports multiple instances per driver
   (`claudeAgent_personal` vs `claudeAgent_work`). Does the modal show one row per *driver* (OpenAI /
   Anthropic) or one row per *configured instance*? Rate limits are account-scoped, so likely per
   instance — but the prompt says "both providers," implying two rows.

4. **Persistence & freshness.** Rate-limit events only arrive *while a session runs*. If the app just
   started and no turn has happened, there may be no snapshot yet. Decide: show "no data yet / run a
   prompt to refresh," persist the last-seen snapshot across restarts, or actively fetch (Codex supports
   `account/rateLimits/read` — a pull RPC — which could seed the modal on open).

5. **Should this replace or extend the `/settings` route?** The Settings button currently routes to a
   full settings page. Confirm the modal *replaces* that click (prompt implies yes) vs. being an
   additional surface, and whether existing `/settings` content should move into the modal too.

6. **Scope semantics of `usedPercent`.** Codex gives `usedPercent` + `windowDurationMins`, not absolute
   token counts. Confirm the modal should show percentage-used + reset countdown (what's available)
   rather than absolute "X / Y tokens," which the provider data does not directly provide.
