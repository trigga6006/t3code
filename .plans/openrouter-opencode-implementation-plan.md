# OpenRouter via OpenCode — Build-Ready Implementation Plan

**Decision (from `.plans/openrouter-support-scouting.md`):** Host OpenRouter behind the **OpenCode**
harness. OpenCode is a multi-provider gateway with native OpenRouter support; the app already integrates
it (`OpenCodeAdapter` + `OpenCodeDriver` + `OpenCodeProvider`). OpenRouter models reach the user as a
first-class streaming, tool-calling agent **without writing a new agent loop**.

**Status:** Read-only plan. No app code was changed. All `file:line` references verified against the
current tree (June 2026). See the scouting doc for the architecture rationale; this doc is the actionable
build plan.

**The one real engineering decision up front:** the OpenCode adapter hard-codes its provider identity as
`const PROVIDER = ProviderDriverKind.make("opencode")` (`apps/server/src/provider/Layers/OpenCodeAdapter.ts:54`),
and stamps it on ~20 emitted events (`:118, :132, :238, :247, :453, :467, :659, :1117, :1183, :1191,
:1208, :1319, :1340, :1359, :1453`). So "make OpenRouter first-class" = **parameterize the adapter's
provider kind** so the same OpenCode runtime can emit events stamped `provider: "openrouter"`. That is the
crux of §2 and the bulk of the new server code. Everything else is config + registration + a model list +
an icon.

---

## 0. Two implementation shapes (pick one — recommend Shape A)

| | **Shape A — first-class `openrouter` driver (RECOMMENDED)** | **Shape B — OpenRouter models inside the existing OpenCode provider** |
|---|---|---|
| What the user sees | A distinct "OpenRouter" provider with its own icon, name, model list | OpenRouter models listed under the existing "OpenCode" provider |
| Server work | New `OpenRouterDriver.ts`; parameterize `makeOpenCodeAdapter`/`OpenCodeProvider` provider kind | None (already works once OpenCode has an OpenRouter key) |
| Matches user's stated goal ("first-class agent") | ✅ Yes | ⚠️ Partially — buried under OpenCode |
| Effort | Medium (mostly glue + one parameterization refactor) | Minimal |
| Risk | Low | Low |

The user explicitly asked for OpenRouter as a **first-class** provider, so this plan builds **Shape A**
and notes where Shape B would simply skip a step. Shape B is a viable fast fallback / first checkpoint:
ship it (configure OpenCode with an OpenRouter key, models appear) to de-risk, then layer Shape A on top.

---

## 1. Prerequisites — OpenCode CLI install & how THIS app launches it

### 1.1 How the app locates/launches the `opencode` binary today

- The driver passes per-instance `OpenCodeSettings` into the adapter
  (`apps/server/src/provider/Drivers/OpenCodeDriver.ts:139-144`). The adapter reads
  `openCodeSettings.binaryPath` and `openCodeSettings.serverUrl`
  (`OpenCodeAdapter.ts:1030-1031`) and calls
  `openCodeRuntime.connectToOpenCodeServer({ binaryPath, serverUrl, environment })`
  (`OpenCodeAdapter.ts:1047-1052`), then builds an SDK client at `baseUrl: server.url`
  (`:1053`).
- **Binary resolution:** `binaryPath` defaults to the string `"opencode"`
  (`settings.ts:314`, `makeBinaryPathSetting("opencode")`), resolved on `PATH` by
  `resolveSpawnCommand(...)` inside `opencodeRuntime.ts` (`:282-290`). So "installed correctly for this
  app" = **`opencode` is on the PATH of the server process** (or `binaryPath` points at an absolute path,
  or an external `serverUrl` is configured).
- **Server mode:** when no `serverUrl`, the runtime spawns a local server with
  `opencode serve --hostname=<h> --port=<p>` (`opencodeRuntime.ts:342-349`) and waits for the
  `"opencode server listening"` banner (`:39`). Lifetime is bound to the registry scope.
- **Version gate (already enforced):** `checkOpenCodeProviderStatus` runs `opencode --version`
  (`OpenCodeProvider.ts:361-379`) and **requires `MINIMUM_OPENCODE_VERSION = "1.14.19"`**
  (`OpenCodeProvider.ts:33, 389`); older → snapshot status `warning` with
  *"OpenCode v… is too old. Upgrade to v1.14.19 or newer."* (`:405`).

> Note: the user mentioned an "OpenCode" **desktop app** is installed. That is not necessarily the same as
> the `opencode` **CLI** on PATH that this app spawns. Verify the CLI explicitly (next step).

### 1.2 Concrete verification steps (run these first)

```bash
# 1. Is the CLI on PATH and what version?
opencode --version            # expect >= 1.14.19 (app minimum); latest is ~1.17.9

# 2. (after configuring a key) does OpenCode see OpenRouter as a connected provider?
opencode auth list            # expect a line like:  OpenRouter   OPENROUTER_API_KEY
```

If `opencode` is **missing or older than 1.14.19**, install/upgrade (any one):

```bash
# Install (recommended, native):
curl -fsSL https://opencode.ai/install | bash
# or via npm (the package this app's update path references, OpenCodeDriver.ts:71 `npmPackageName: "opencode-ai"`):
npm install -g opencode-ai
# Upgrade an existing native install (matches app's nativeUpdate, OpenCodeDriver.ts:72-77):
opencode upgrade
```

For OpenRouter + tool-calling, **target the latest OpenCode (≈1.17.x)**, not merely the 1.14.19 floor —
OpenRouter provider support and tool-call handling have improved across releases. Tool calling itself is a
property of the **chosen OpenRouter model**, not OpenCode (see §5 caveats).

**Checkpoint 1:** `opencode --version` ≥ 1.14.19 (prefer ≥1.17), `opencode` resolvable on the server's
PATH, and `opencode auth list` shows OpenRouter once a key is set (§3).

---

## 2. Provider wiring — the first-class `openrouter` driver (Shape A)

### 2.1 The seam recap (what a driver must satisfy)

A provider plugs in via a `ProviderDriver` value (`apps/server/src/provider/ProviderDriver.ts:119-157`)
registered in `BUILT_IN_DRIVERS` (`apps/server/src/provider/builtInDrivers.ts:47-53`). Its `create()`
returns a `ProviderInstance` bundling `{ snapshot, adapter, textGeneration }`. The `adapter` must satisfy
`ProviderAdapterShape` (`apps/server/src/provider/Services/ProviderAdapter.ts:45-126`) and emit canonical
`ProviderRuntimeEvent`s via `streamEvents`. The `driver` slug is an **open branded string**
(`packages/contracts/src/providerInstance.ts:58-71`) so a new `"openrouter"` kind needs **no contract
schema change**.

### 2.2 Parameterize the OpenCode adapter & provider by driver kind (the core change)

Today the provider identity is a module constant:

```ts
// apps/server/src/provider/Layers/OpenCodeAdapter.ts:54
const PROVIDER = ProviderDriverKind.make("opencode");
```

**Change:** accept an optional `providerKind` in the adapter options (the options type is at
`OpenCodeAdapter.ts:101-106`; the factory at `:427-432`, where it already defaults
`boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("opencode")`). Thread a
`const provider = options?.providerKind ?? ProviderDriverKind.make("opencode")` and replace the constant
`PROVIDER` references (enumerated above) with it. Do the same for the snapshot builder so model snapshots
are stamped with the right driver: `makePendingOpenCodeProvider` / `checkOpenCodeProviderStatus`
(`OpenCodeProvider.ts:255-301, :301-455`) — add a `providerKind` parameter (default `"opencode"`), and
in `OpenCodeDriver.ts` the `withInstanceIdentity` stamp uses `DRIVER_KIND` (`:101`) which becomes the
driver's own kind automatically.

This keeps **one** OpenCode runtime/adapter implementation and lets both the `opencode` driver and the new
`openrouter` driver reuse it with different identities. (Shape B skips this entire subsection.)

### 2.3 New file: `apps/server/src/provider/Drivers/OpenRouterDriver.ts`

Clone `OpenCodeDriver.ts` (it's only ~196 lines) with these differences:

- `const DRIVER_KIND = ProviderDriverKind.make("openrouter");`
- `metadata: { displayName: "OpenRouter", supportsMultipleInstances: true }` (`cf. OpenCodeDriver.ts:109-112`).
- `configSchema: OpenRouterSettings` (new schema, §2.5) — or reuse `OpenCodeSettings` initially.
- In `create()`, pass the new provider kind through:
  `makeOpenCodeAdapter(effectiveConfig, { instanceId, environment: processEnv, providerKind: DRIVER_KIND, … })`
  (`cf. OpenCodeDriver.ts:139-143`) and likewise into `checkOpenCodeProviderStatus` / `makePendingOpenCodeProvider`.
- Keep the same `OpenCodeDriverEnv` requirement set (`OpenCodeDriver.ts:80-89`) — same runtime services.
- The package-managed update resolver (`OpenCodeDriver.ts:68-78`) can be reused as-is (it still manages
  the `opencode` binary).

### 2.4 Register the driver

```ts
// apps/server/src/provider/builtInDrivers.ts
import { OpenRouterDriver, type OpenRouterDriverEnv } from "./Drivers/OpenRouterDriver.ts";   // +
export type BuiltInDriversEnv = … | OpenCodeDriverEnv | OpenRouterDriverEnv;                  // :35-40 (+)
export const BUILT_IN_DRIVERS = [ CodexDriver, ClaudeDriver, CursorDriver, GrokDriver,
  OpenCodeDriver, OpenRouterDriver ];                                                          // :47-53 (+)
```

### 2.5 Contracts: settings schema + model defaults + display name

- **`packages/contracts/src/settings.ts`** — add `OpenRouterSettings` mirroring `OpenCodeSettings`
  (`:308-356`): `enabled`, `binaryPath` (defaults to `"opencode"` since it drives the same binary),
  optional `serverUrl`, `serverPassword`, `customModels`. Register it in the `providers` map next to
  `opencode` (`settings.ts:401`) and in the patch schema block (`:467-525`). *(Shape B reuses
  `OpenCodeSettings` and skips this.)*
- **`packages/contracts/src/model.ts`** — add entries keyed by the new kind:
  `DEFAULT_MODEL_BY_PROVIDER` (`:139`) → e.g. `openrouter/anthropic/claude-sonnet-4`;
  `PROVIDER_DISPLAY_NAMES` (`:202`) → `"OpenRouter"`; `MODEL_SLUG_ALIASES_BY_PROVIDER` (`:157`) optional.

### 2.6 Web: icon, display qualifier, picker availability

- **Icon** — `apps/web/src/components/Icons.tsx` has `OpenAI`, `ClaudeAI`, `GrokIcon`, `CursorIcon`,
  `OpenCodeIcon`, `Gemini` (`:484, :495, :202, :192, :650, :506`) but **no OpenRouter icon**. Add an
  `OpenRouterIcon` SVG (asset needed — OpenRouter's logo), or temporarily reuse `OpenCodeIcon`.
- **`apps/web/src/components/chat/providerIconUtils.ts`** — add
  `[ProviderDriverKind.make("openrouter")]: OpenRouterIcon` to `PROVIDER_ICON_BY_PROVIDER` (`:5-11`) and a
  qualifier to `PROVIDER_QUALIFIER_BY_DRIVER` (`:62-68`, e.g. `"OpenRouter"`).
- **`apps/web/src/session-logic.ts`** — add `{ value: ProviderDriverKind.make("openrouter"), label:
  "OpenRouter", available: true }` to `PROVIDER_OPTIONS` (`:27-51`) so it appears in the provider picker
  (`AVAILABLE_PROVIDER_OPTIONS` derives from it, `providerIconUtils.ts:22`).

### 2.7 Files-to-touch summary (Shape A)

| Layer | File | Change |
|---|---|---|
| Server | `provider/Layers/OpenCodeAdapter.ts` | Parameterize `provider` kind via `options.providerKind` (`:54, :101-106, :427-432` + ~20 stamp sites) |
| Server | `provider/Layers/OpenCodeProvider.ts` | Add `providerKind` param to `makePendingOpenCodeProvider` / `checkOpenCodeProviderStatus` (`:255-455`) |
| Server | `provider/Drivers/OpenRouterDriver.ts` | **New** — clone of `OpenCodeDriver.ts` pinned to `openrouter` |
| Server | `provider/builtInDrivers.ts` | Register `OpenRouterDriver` (`:23-53`) |
| Contracts | `contracts/src/settings.ts` | `OpenRouterSettings` + `providers.openrouter` + patch schema (`:308-356, :401, :467-525`) |
| Contracts | `contracts/src/model.ts` | `DEFAULT_MODEL_BY_PROVIDER` / `PROVIDER_DISPLAY_NAMES` entries (`:139, :202`) |
| Web | `components/Icons.tsx` | `OpenRouterIcon` (new SVG) |
| Web | `components/chat/providerIconUtils.ts` | Icon + qualifier maps (`:5-11, :62-68`) |
| Web | `session-logic.ts` | `PROVIDER_OPTIONS` entry (`:27-51`) |
| Client-runtime | — | **No change** — provider state is generic over `ProviderDriverKind`; instances/snapshots/events flow through existing atoms once the server emits them. |

> **client-runtime / ProviderRuntimeIngestion:** no new code. `ProviderService` already subscribes to
> every instance's `streamEvents` and republishes (`provider/Layers/ProviderService.ts:328-338`), with the
> validation that each event's `provider` matches the instance (`:189-196`) — which is exactly why §2.2's
> parameterization is required (an `openrouter` instance emitting `provider:"opencode"` would fail
> validation).

---

## 3. API key + configuration flow

**OpenCode auto-detects `OPENROUTER_API_KEY` from its process environment** (confirmed: `opencode auth
list` shows `OpenRouter  OPENROUTER_API_KEY`). The app already injects per-instance env vars into the
spawned `opencode` process:

```
ProviderInstanceEnvironment (contracts/src/providerInstance.ts:104-113)
  → mergeProviderInstanceEnvironment(environment)   (provider/ProviderInstanceEnvironment.ts:3-16)
  → OpenRouterDriver.create() processEnv            (cf. OpenCodeDriver.ts:122)
  → makeOpenCodeAdapter({ environment: processEnv }) (OpenCodeDriver.ts:139-143)
  → connectToOpenCodeServer({ environment })        (OpenCodeAdapter.ts:1047-1052)
  → opencode serve  (child process inherits env)    (opencodeRuntime.ts:342-349)
```

So **storing `OPENROUTER_API_KEY` as a `ProviderInstanceEnvironment` entry (`sensitive: true`) is
sufficient** — no `auth.json` or `opencode.json` editing required. This is the exact mechanism the repo
already tests: `apps/server/src/serverSettings.test.ts:541` (`OPENROUTER_API_KEY=sk-or-secret`,
`sensitive:true`) and `:77, :86`, plus `provider/ProviderInstanceEnvironment.test.ts:10-11`. A base URL is
**not** needed (OpenCode targets OpenRouter natively); the `ANTHROPIC_BASE_URL=https://openrouter.ai/api`
fixture (`serverSettings.test.ts:542`) belongs to the separate Claude-skin route and is not used here.

**Where the user enters the key:** the existing per-instance settings UI that renders
`ProviderInstanceEnvironment` secrets (same control used for OpenCode `serverPassword`, annotated
`control:"password"` at `settings.ts:335-346`). The OpenRouter instance's settings form shows an
`OPENROUTER_API_KEY` secret field; the value is written via the existing secret write path
(`ServerSettingsOperation` write-secret) and never logged (`valueRedacted`).

**Checkpoint 2:** create an `openrouter` provider instance, enter `OPENROUTER_API_KEY`, and confirm the
instance snapshot reaches status `ready` (its model list becomes non-empty — see §4).

---

## 4. Model selection UX — "any model OpenRouter offers"

### How models surface today
`checkOpenCodeProviderStatus` queries the running OpenCode server's inventory and
`flattenOpenCodeModels` keeps only models whose provider id is in `providerList.connected`
(`OpenCodeProvider.ts:222-252`). Once `OPENROUTER_API_KEY` is set, **OpenRouter becomes a connected
provider and all OpenRouter models appear automatically** in the snapshot's `models`, merged with the
user's `customModels` via `providerModelsFromSettings` (`:260, :322, :439`).

### Slug format
The app's model slug is `provider/model` (`parseOpenCodeModelSlug`, `opencodeRuntime.ts:163-181` — splits
on the **first** `/`). For OpenRouter that means **`openrouter/<openrouter-model-id>`**, e.g.
`openrouter/anthropic/claude-sonnet-4` → `providerID="openrouter"`, `modelID="anthropic/claude-sonnet-4"`,
passed to `session.promptAsync({ model: { providerID, modelID } })` (`OpenCodeAdapter.ts:1188-1248`). The
nested second slash is preserved correctly by the first-slash split.

### Recommendation: **dynamic discovery (primary) + free-entry custom slug (escape hatch)**
1. **Primary — dynamic:** rely on OpenCode's connected-provider inventory. It already returns OpenRouter's
   live catalog with names/capabilities, populates the existing model picker, and needs **zero** extra
   network code. This is the lowest-risk "any model" path.
2. **Escape hatch — free entry:** the `customModels: Schema.Array(Schema.String)` field
   (`settings.ts:347`) already lets a user add an arbitrary `openrouter/<id>` slug not in the discovered
   list (new releases, niche models). Surface a "add custom model" input in the OpenRouter settings form.
3. **Optional later — OpenRouter `/models` API** (`GET https://openrouter.ai/api/v1/models`) to pre-seed a
   curated `BUILT_IN_MODELS` list with pricing/context metadata. **Defer to v1.1** — discovery already
   covers the requirement; a second catalog source adds sync/staleness burden. If added, filter by
   `supported_parameters` containing `tools` to show only tool-capable models (see §5).

**Checkpoint 3:** the model picker for the OpenRouter instance lists OpenRouter models, and a custom
`openrouter/<id>` slug can be added and selected.

---

## 5. Streaming + tool calls — the event flow and what to test

### How OpenCode events become the app's runtime events (already implemented)
The adapter subscribes to the OpenCode SDK event stream and translates in `handleSubscribedEvent`
(`OpenCodeAdapter.ts:645-992`). The relevant mappings (unchanged for OpenRouter — only the `provider`
stamp differs after §2.2):

| OpenCode SDK event | App runtime event | Location |
|---|---|---|
| `message.part.delta` (text) | `content.delta` (`streamKind: assistant_text` / `reasoning_text`) | `OpenCodeAdapter.ts:687-732` |
| assistant text part finalize | `content.delta` + `item.completed` | `:578-644` |
| `message.part.updated` where `part.type === "tool"` | `item.started` / `item.updated` / `item.completed` with `itemType` from `toToolLifecycleItemType` (`bash`→`command_execution`, edits→`file_change`, `mcp_*`→`mcp_tool_call`, else `dynamic_tool_call`) | `:732-781, :147-176` |
| `permission.asked` | `request.opened` → resolved via adapter `respondToRequest` | `:782-821` |
| `question.asked` | `user-input.requested` → `respondToUserInput` | `:822-875` |
| `session.status` | `session.state.changed` / `turn.*` | `:876-917` |
| `session.error` | `runtime.error` | `:918-991` |

So an OpenRouter model streams tokens and drives the tool/edit/approval lifecycle through the **same**
translation Codex/Claude get — the agent loop (tool execution, applying edits, multi-turn) runs inside the
OpenCode server. Approvals enforce through the existing `respondToRequest` Deferred path; runtime mode
`full-access` auto-approves exactly as for other providers.

### Tool-calling caveats (model-dependent — call these out to the user)
- **Tool calling is a property of the chosen OpenRouter model + upstream**, not OpenCode. Strong tool
  models (Anthropic Claude, OpenAI GPT, DeepSeek) work well; some open-weight/budget models emit malformed
  or no tool calls. OpenRouter normalizes the OpenAI tool-call shape across providers but cannot add tool
  support a model lacks.
- **Provider routing matters:** OpenRouter may route a model to different upstreams with differing
  tool-call fidelity. OpenCode supports `options.provider.order` / `allow_fallbacks` per model
  (`opencode.json`) if pinning is needed — document as an advanced knob, not v1 default.
- Known-good starting set for testing: one Anthropic (`openrouter/anthropic/claude-sonnet-4`), one OpenAI
  (`openrouter/openai/gpt-5.x`), one open-weight (`openrouter/deepseek/deepseek-v3`).

### What to test (parity with Codex/Claude)
Streaming tokens render incrementally; a tool call shows `item.started`→`item.completed`; a file edit
produces a `file_change` item and a real on-disk diff; an approval prompt appears and accept/reject is
honored; `turn.completed` carries usage. (Concrete steps in §8 test plan.)

---

## 6. Scope — OpenRouter features in v1 vs deferred

| Feature | v1 (via OpenCode) | Notes |
|---|---|---|
| Chat completions + **streaming** | ✅ In | Core; adapter maps deltas |
| **Tool / function calling** (+ parallel) | ✅ In | Provided by OpenCode loop; model-dependent fidelity (§5) |
| **Any-model selection** (`openrouter/<id>` slugs) | ✅ In | Dynamic discovery + custom slug entry (§4) |
| Reasoning / thinking tokens | ✅ In (model-dependent) | Mapped to `reasoning_text` deltas |
| Approvals / human-in-the-loop | ✅ In | Existing `permission.asked` → `request.opened` path |
| Provider routing (`order`, `allow_fallbacks`, failover) | ◐ Config-only | Advanced; via `opencode.json`, not surfaced in UI v1 |
| Usage / cost accounting | ◐ Best-effort | If OpenCode surfaces usage, map to `turn.completed` / token-usage events |
| OpenRouter `/models` catalog API | ⏳ Deferred (v1.1) | Discovery already covers "any model"; optional curated list later |
| Structured outputs (`response_format`) | ⏳ Deferred | Not part of the coding-agent loop |
| OpenRouter plugins (web search, PDF) | ❌ Out | Not part of the agent loop |
| Image/video/embeddings/rerank endpoints | ❌ Out | Irrelevant to a coding agent |
| OpenRouter **Responses API (beta)** | ❌ Out | Only relevant to the rejected Codex path |

---

## 7. The 8 open questions — recommended defaults

1. **Provider identity (own provider vs models-in-OpenCode).** → **Default: first-class `openrouter`
   driver (Shape A).** Matches the user's stated goal. *(Low-risk fallback: ship Shape B first as
   Checkpoint 0.)* — *worth a quick user confirm, but A is the clear intent.*
2. **OpenCode dependency acceptable as the harness?** → **Default: yes.** It already ships in the app and
   is the only path delivering "any model" without building an agent. **User should confirm** they're
   comfortable depending on the `opencode` binary/release cadence.
3. **Model list strategy.** → **Default: dynamic discovery + `customModels` free entry; defer the
   `/models` catalog API.** Optionally filter discovered models to tool-capable ones in a later pass.
4. **Also add the Claude-skin route for Anthropic-family models?** → **Default: no for v1** (OpenCode
   already routes Anthropic models via OpenRouter). Revisit if users want max Claude fidelity. **User
   call.**
5. **Codex-via-OpenRouter?** → **Default: out of scope** (Responses-API-only fragility). Confirmed
   deferred in scouting. **User call** only if OpenAI-models-through-Codex is a hard requirement.
6. **Key scoping & multi-instance.** → **Default: one `OPENROUTER_API_KEY` per instance via
   `ProviderInstanceEnvironment`** (`supportsMultipleInstances: true`), entered in the instance settings
   form (mirrors OpenCode `serverPassword` password control, `settings.ts:335-346`).
7. **In-session model switching (`capabilities.sessionModelSwitch`).** → **Default: `"in-session"`**, since
   OpenCode accepts a model per turn (`OpenCodeAdapter.ts:1241-1248`). Inherit whatever the OpenCode
   adapter already declares.
8. **Verification plan.** → **Default: adopt §8** — unit tests mirroring `OpenCodeAdapter.test.ts` +
   `serverSettings.test.ts` OpenRouter fixtures, plus a live 3-model smoke test (Anthropic / OpenAI /
   open-weight) before finalizing any curated list.

**Genuinely need the user's call:** #2 (dependency acceptance), #4 (Claude-skin yes/no), #5 (Codex
yes/no). The rest have safe defaults above.

---

## 8. Build sequence + test plan

### Build sequence (with checkpoints)
- **Checkpoint 0 — prove the harness (Shape B, ~hours).** Install/verify `opencode` (§1.2). Add
  `OPENROUTER_API_KEY` to an **existing OpenCode** instance's environment; confirm `opencode auth list`
  shows OpenRouter and OpenRouter models appear in the OpenCode model picker. Run one streaming, tool-using
  turn. *This de-risks everything before writing Shape A code.*
- **Step 1 — parameterize provider kind (§2.2).** Add `options.providerKind` to `makeOpenCodeAdapter`
  (`OpenCodeAdapter.ts:101-106, :427-432`), replace the `PROVIDER` constant stamps; add `providerKind` to
  `OpenCodeProvider.ts` snapshot builders. Keep default `"opencode"` so existing behavior is unchanged.
  **Checkpoint:** OpenCode adapter tests (`OpenCodeAdapter.test.ts`) still green.
- **Step 2 — contracts (§2.5).** `OpenRouterSettings` in `settings.ts`; `model.ts` defaults/display name.
  **Checkpoint:** contracts typecheck + schema decode tests.
- **Step 3 — driver + registration (§2.3-2.4).** New `OpenRouterDriver.ts`; add to `BUILT_IN_DRIVERS`.
  **Checkpoint:** server boots; an `openrouter` instance can be created and reaches `ready` with a key set
  and emits events stamped `provider:"openrouter"` (passes `ProviderService` validation `:189-196`).
- **Step 4 — web (§2.6).** Icon + `providerIconUtils` maps + `session-logic` picker entry.
  **Checkpoint:** OpenRouter appears in the provider picker with icon/name; model picker lists OpenRouter
  models.
- **Step 5 — polish.** Custom-slug entry surfaced; settings form shows the `OPENROUTER_API_KEY` secret
  field; docs/AGENTS notes.

### Test plan
**Unit / integration (mirror existing patterns):**
- Provider-kind parameterization: extend `OpenCodeAdapter.test.ts` to assert emitted events carry the
  injected `providerKind` (e.g. `"openrouter"`).
- Settings: extend `serverSettings.test.ts` (reuse the existing `OPENROUTER_API_KEY` fixtures at
  `:77, :86, :541`) to cover an `openrouter` instance config + secret round-trip.
- Driver registration: a test like `ProviderAdapterRegistry.test.ts` asserting the `openrouter` driver
  resolves and `getByInstance` returns its adapter.
- Slug parsing: assert `parseOpenCodeModelSlug("openrouter/anthropic/claude-sonnet-4")` →
  `{ providerID:"openrouter", modelID:"anthropic/claude-sonnet-4" }` (`opencodeRuntime.ts:163-181`).

**Live smoke test (the acceptance gate):**
1. `opencode --version` ≥ minimum; `OPENROUTER_API_KEY` set on the instance; `opencode auth list` shows
   OpenRouter.
2. Select `openrouter/anthropic/claude-sonnet-4`. Send: *"Create `hello.txt` containing the current date,
   then read it back."*
3. Assert: tokens **stream** incrementally; a **tool call** appears (`command_execution`/`file_change`
   item start→complete); the **edit is applied on disk** (real `hello.txt` with a diff); an **approval**
   prompt appears and is honored (or auto-approved under `full-access`); `turn.completed` fires with usage.
4. Repeat with one OpenAI model and one open-weight model (e.g. `openrouter/deepseek/deepseek-v3`) to
   characterize tool-call fidelity (§5) before committing any curated model list.

**Acceptance:** an OpenRouter model streams responses and executes tool calls/edits indistinguishably from
the Codex and Claude providers, surfaced under a first-class "OpenRouter" provider.

---

## Sources

- Scouting doc: `.plans/openrouter-support-scouting.md`
- OpenRouter — OpenCode integration: https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration
- OpenCode — CLI docs: https://opencode.ai/docs/cli/ · Providers: https://opencode.ai/docs/providers/
- OpenCode install: `curl -fsSL https://opencode.ai/install | bash` · npm `opencode-ai` (latest ≈1.17.9)
- OpenRouter — Tool & Function Calling: https://openrouter.ai/docs/guides/features/tool-calling
- Verified in-repo references: `OpenCodeAdapter.ts:54, 101-106, 427-432, 645-992, 1030-1052, 1188-1248`;
  `OpenCodeProvider.ts:33, 222-252, 361-405`; `OpenCodeDriver.ts:107-195`; `builtInDrivers.ts:47-53`;
  `opencodeRuntime.ts:163-181, 342-349`; `settings.ts:308-356, 401`; `model.ts:139, 202`;
  `providerIconUtils.ts:5-11, 62-68`; `session-logic.ts:27-51`; `ProviderInstanceEnvironment.ts:3-16`;
  `serverSettings.test.ts:77, 86, 541-542`; `ProviderInstanceEnvironment.test.ts:10-11`.
