# OpenRouter Support — Architecture Scouting & Hosting Decision

**Goal:** Let the app use **any** model OpenRouter offers, as a first-class agent — streaming
responses, making/executing tool calls, multi-turn orchestration — behaving like the existing Codex
(OpenAI) and Claude (Anthropic) agents.

**Status:** Read-only investigation. Nothing was modified. CLI/OpenRouter claims below are checked
against current vendor docs (June 2026); see Sources.

---

## Headline finding

The app is **not** an agent. Every existing provider adapter is a thin **subprocess driver + event
translator**: it spawns a CLI (or drives a vendor SDK), forwards the user prompt in, and maps the CLI's
native event stream onto the app's canonical `ProviderRuntimeEvent` union. The whole agentic loop — tool
**definitions**, tool **execution**, applying edits, multi-turn continuation, and approval **enforcement**
— runs *inside the CLI/SDK subprocess*. The app participates only at two narrow seams: it relays
approval requests to the user (returns accept/reject) and relays clarifying questions. **It never sees a
tool schema and never sends a tool result back to a model.**

That single fact decides the question. **Option B (a native OpenRouter harness that talks to the API
directly) means reimplementing the agent** — the one thing this codebase deliberately does not own.
**Option A (host OpenRouter behind an existing CLI) gets the loop for free.** And the best host already
ships in the app: the **OpenCode adapter**, whose CLI is a multi-provider gateway that natively supports
OpenRouter and *any* of its models via a `provider/model` slug. There is also already an OpenRouter
**test fixture** in the repo (`ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `OPENROUTER_API_KEY`),
proving the env-injection seam already reaches the CLIs.

**Recommendation in one line:** route OpenRouter through the **OpenCode** harness (primary), optionally
expose it as a distinct first-class "OpenRouter" provider driver that is a pre-configured OpenCode
instance. Do **not** build a native adapter, and do **not** make Codex the host. Details in §3–§4.

---

## 1. Current-architecture map — the seam a new provider plugs into

### 1.1 Two layered seams

A provider plugs in at **two** levels (Effect-TS). Naming matters: the public "provider" concept is split
into a **`ProviderDriverKind`** (which implementation) and a **`ProviderInstanceId`** (a configured
instance; multiple instances per driver are allowed).

**(a) `ProviderAdapterShape<TError>` — the per-session protocol contract**
`apps/server/src/provider/Services/ProviderAdapter.ts:45-126`. Every adapter (`CodexAdapter`,
`ClaudeAdapter`, `GrokAdapter`, `OpenCodeAdapter`, `CursorAdapter`) returns an object satisfying this. A
drop-in adapter must implement:

```ts
export interface ProviderAdapterShape<TError> {
  readonly provider: ProviderDriverKind;                 // e.g. ProviderDriverKind.make("openrouter")
  readonly capabilities: ProviderAdapterCapabilities;    // { sessionModelSwitch: "in-session" | "unsupported" }
  readonly startSession: (input: ProviderSessionStartInput) => Effect.Effect<ProviderSession, TError>;
  readonly sendTurn:     (input: ProviderSendTurnInput)    => Effect.Effect<ProviderTurnStartResult, TError>;
  readonly interruptTurn:    (threadId, turnId?)                 => Effect.Effect<void, TError>;
  readonly respondToRequest: (threadId, requestId, decision)    => Effect.Effect<void, TError>;  // approvals
  readonly respondToUserInput: (threadId, requestId, answers)   => Effect.Effect<void, TError>;  // questions
  readonly stopSession:  (threadId) => Effect.Effect<void, TError>;
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;
  readonly hasSession:   (threadId) => Effect.Effect<boolean>;
  readonly readThread:   (threadId) => Effect.Effect<ProviderThreadSnapshot, TError>;
  readonly rollbackThread: (threadId, numTurns) => Effect.Effect<ProviderThreadSnapshot, TError>;
  readonly stopAll:      () => Effect.Effect<void, TError>;
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;   // canonical runtime-event stream
}
```

**(b) `ProviderDriver<Config, R>` — the registration SPI (the real drop-in point)**
`apps/server/src/provider/ProviderDriver.ts:119-157`. A plain value bundling the adapter with a config
schema and a `create()` factory:

```ts
export interface ProviderDriver<Config, R = never> {
  readonly driverKind: ProviderDriverKind;
  readonly metadata: ProviderDriverMetadata;             // { displayName, supportsMultipleInstances? }
  readonly configSchema: Schema.Codec<Config, unknown>;  // decodes ProviderInstanceConfig.config
  readonly defaultConfig: () => Config;
  readonly create: (input: ProviderDriverCreateInput<Config>)
     => Effect.Effect<ProviderInstance, ProviderDriverError, R | Scope.Scope>;
}
```

`create()` returns a `ProviderInstance` (`ProviderDriver.ts:64-74`) carrying
`{ instanceId, driverKind, displayName, accentColor, enabled, snapshot, adapter, textGeneration }`.

**Registration is one array.** `apps/server/src/provider/builtInDrivers.ts:47-53` (`BUILT_IN_DRIVERS`)
plus its env wiring at `:35-40`. The file header (`builtInDrivers.ts:11-15`) documents the exact 3-step
contract for adding a driver. The registry (`Layers/ProviderAdapterRegistry.ts:36-47`) is a facade that
just does `getByInstance(instanceId) -> instance.adapter`; no manual wiring beyond `BUILT_IN_DRIVERS`.

**So a new "OpenRouter" provider = (1)** an `OpenRouterSettings`/config schema in
`packages/contracts/src/settings.ts`, **(2)** an adapter returning `ProviderAdapterShape`, **(3)** a
snapshot/probe builder (`*Provider.ts`), **(4)** an `OpenRouterDriver.ts`, **(5)** one line in
`BUILT_IN_DRIVERS`. Crucially, the `driver` slug is an **open branded string**
(`packages/contracts/src/providerInstance.ts:58-71`) — adding a new kind needs **no contract change**.

### 1.2 How adapters emit runtime events (the "ingestion" mechanism)

There is no type literally named `ProviderRuntimeIngestion`. Each adapter owns an internal
**PubSub/Queue of `ProviderRuntimeEvent`** and exposes it as `streamEvents`. `ProviderService`
subscribes per-instance and republishes, validating that each event's `provider`/`providerInstanceId`
matches the source (`apps/server/src/provider/Layers/ProviderService.ts:189-196, 328-338` —
`Stream.runForEach(adapter.streamEvents, …)`). Examples:

- Grok: `PubSub.unbounded<ProviderRuntimeEvent>()`; `streamEvents = Stream.fromPubSub(pubsub)`
  (`Layers/GrokAdapter.ts:192, 219-220, 988`).
- OpenCode: `Queue.unbounded<ProviderRuntimeEvent>()`; `streamEvents = Stream.fromQueue(queue)`
  (`Layers/OpenCodeAdapter.ts:447, 512-513, 1468-1470`).

### 1.3 The canonical runtime-event union — what an adapter must emit

`packages/contracts/src/providerRuntime.ts`. The union is `ProviderRuntimeEvent =
ProviderRuntimeEventV2` (`:990-1043`), discriminated on `type` (full list `:148-196`). Every event
carries `ProviderRuntimeEventBase` (`:248-262`): `eventId, provider, providerInstanceId?, threadId,
createdAt, turnId?, itemId?, requestId?, raw?`. Members a new adapter would emit:

| Concern | Event `type` | Payload (file:line) |
|---|---|---|
| **Streaming tokens** | `content.delta` | `{ streamKind: "assistant_text"|"reasoning_text"|…, delta }` (`:413-419`) |
| **Tool / item lifecycle** | `item.started` / `item.updated` / `item.completed` | `ItemLifecyclePayload`; `itemType ∈ command_execution, file_change, mcp_tool_call, web_search, assistant_message, …` (`:104-133, :404-411`) |
| **Turn lifecycle** | `turn.started` / `turn.completed` / `turn.aborted` / `turn.plan.updated` / `turn.diff.updated` | `turn.completed { state, stopReason?, usage?, totalCostUsd? }` (`:356-370`) |
| **Session/thread** | `session.started` / `session.state.changed` / `session.exited` / `thread.started` / `thread.token-usage.updated` | `state: starting|ready|running|waiting|stopped|error` (`:276-281`) |
| **Approvals / input** | `request.opened` / `request.resolved` / `user-input.requested` / `user-input.resolved` | `CanonicalRequestType` (`:135-146`) |
| **Rate limits** | `account.rate-limits.updated` | `{ rateLimits, provider?, windows?: { window:"fiveHour"|"weekly", usedPercent, resetsAt, windowDurationMins }[] }` (`:548-563`) |
| **Errors/warnings** | `runtime.error` / `runtime.warning` | `{ message, class?: provider_error|transport_error|permission_error|validation_error|unknown, detail? }` (`:630-635`) |

### 1.4 The crux — who owns the tool/agent loop (today)

**The CLI/SDK owns the entire loop. The app never sends a tool result back to a model.**

- **Codex** (`Layers/CodexAdapter.ts`): spawns the Codex *app-server* (`Layers/CodexSessionRuntime.ts:722-734`
  `codex app-server`), forwards prompts via `session.runtime.sendTurn(...)`
  (`CodexAdapter.ts:1546-1561`), and only **translates** notifications into read-only UI events in
  `mapToRuntimeEvents` (`:490-1345`). Tool/command/file-change items become `item.*` + `content.delta`;
  there is no path returning a tool result to the model.
- **Claude** (`Layers/ClaudeAdapter.ts`): drives the **Claude Agent SDK** `query` object directly —
  `query.setModel` (`:3677`), `query.interrupt` (`:3762`), `query.setPermissionMode` (`:3694`); prompts
  are pushed onto a queue the SDK consumes (`:3744`). `tool_use`/`tool_use_result` blocks are read **for
  display** (`:2350-2406`); the loop is internal to the `claude` subprocess.
- **Grok/Cursor** (ACP over stdio): `grok agent stdio`, prompts via `acp.prompt(...)`
  (`GrokAdapter.ts:808-811`); `ToolCallUpdated` ACP events → display events (`:618-630`).

**Approvals** are the *only* place the app is in the loop, and it's a thin request/response. Every adapter
exposes `respondToRequest(threadId, requestId, decision)` where decision ∈ `accept | acceptForSession |
reject | cancel`; the adapter parks a `Deferred` keyed by `requestId` and the user's answer resolves it.
Codex maps native approval requests → `request.opened` (`CodexAdapter.ts:531-583`) and forwards the
decision back (`:1624-1632`). Claude's SDK invokes the app's `canUseTool` callback
(`ClaudeAdapter.ts:3255-3411`), which emits `request.opened`, awaits the `Deferred`, and returns
`{behavior:"allow"|"deny"}` to the SDK. `full-access` runtime mode short-circuits to auto-allow /
`bypassPermissions` (`:3298-3303, 3437-3471`). **The CLI enforces the decision; the app is just the UI
that answers it.**

### 1.5 How models / keys / config are wired today

- **Instance envelope:** `ProviderInstanceConfig` (`providerInstance.ts:124-132`) =
  `{ driver, displayName?, accentColor?, environment?, enabled?, config? }`; `config` is
  `Schema.Unknown`, so each driver owns its own shape. Stored in
  `ServerSettings.providerInstances: Record<ProviderInstanceId, ProviderInstanceConfig>`
  (`settings.ts:408-410`). Legacy per-driver maps live at `settings.ts:396-402`
  (`CodexSettings`, `ClaudeSettings`, `GrokSettings`, `OpenCodeSettings`, … `:158-356`).
- **API keys = env vars:** `ProviderInstanceEnvironment` (`providerInstance.ts:104-113`) is an array of
  `{ name, value, sensitive, valueRedacted? }`. Each driver's `create()` calls
  `mergeProviderInstanceEnvironment(environment)` (`provider/ProviderInstanceEnvironment.ts:3-16`) and
  passes the merged env into the adapter/CLI process (e.g. Claude threads it to the SDK `query` as
  `env: claudeEnvironment`, `ClaudeAdapter.ts:3477`). **This is exactly where `OPENROUTER_API_KEY` /
  `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` would be injected — and it already works:** see the existing
  fixtures `serverSettings.test.ts:542-579` (`ANTHROPIC_BASE_URL=https://openrouter.ai/api`) and
  `ProviderInstanceEnvironment.test.ts:10-11` (`OPENROUTER_API_KEY=sk-or-…`, blanked `ANTHROPIC_API_KEY`).
- **Model lists** are hard-coded per provider as `BUILT_IN_MODELS` and merged with user `customModels`
  (e.g. `ClaudeProvider.ts:56-…, 636-641`); defaults/aliases/display names in
  `model.ts:139-208`. `ModelSelection = { instanceId, model, options? }`.
- **OpenCode already uses `provider/model` slugs** — `parseOpenCodeModelSlug` rejects anything not
  `provider/model` (`OpenCodeAdapter.ts:1188-1195`) and passes it per-turn:
  `session.promptAsync({ sessionID, model: parsedModel, … })` (`:1241-1248`). This is **identical to
  OpenRouter's slug shape** (`anthropic/claude-sonnet-4`, `google/gemini-2.5-flash`, …).

### 1.6 Existing precedents, ranked by relevance to OpenRouter

| Precedent | Integration style | Relevance to OpenRouter |
|---|---|---|
| **OpenCode** (`OpenCodeAdapter.ts`, 1473 ln) | Spawns/connects to an `opencode` **server**, drives it over the `@opencode-ai/sdk/v2` HTTP client; `provider/model` slugs; dynamic model discovery from `providerList.connected` (`OpenCodeProvider.ts:222-253`) | **Highest.** OpenCode is itself a 75+-provider gateway that natively lists OpenRouter as a built-in provider. Routing OpenRouter through it is mostly config. |
| **Grok** (`GrokAdapter.ts`, 1007 ln) | Spawns vendor `grok agent stdio`, ACP over stdio; `XAI_API_KEY` or cached OAuth (`acp/GrokAcpSupport.ts:12-49`) | Low. A dedicated vendor CLI; **not** OpenAI-compatible and does **not** point a CLI at a custom base_url. |
| **Cursor** (`CursorAdapter.ts`, 1178 ln) | Wraps the `agent` CLI; has an `apiEndpoint` override (`settings.ts:262-272`) | Low–medium. Shows the repo already models a custom-endpoint setting, but still CLI-bound. |
| **Codex** (`CodexAdapter.ts`, 1723 ln) | Spawns `codex app-server` | Medium but constrained — see §3.1 (Responses-API requirement). |
| **Claude** (`ClaudeAdapter.ts`, 3872 ln) | Drives Claude Agent SDK; env reaches the SDK | Medium — works great for Anthropic-family models via OpenRouter, weaker for arbitrary models. |

**Adapter anatomy:** ~250 lines of near-identical boilerplate (PubSub/Queue, `buildEventBase`,
per-thread session `Map`, lifecycle scaffolding, trailing `return {…} satisfies Shape`) + the
provider-specific **event-translation switch** (`handleSubscribedEvent` in OpenCode, the ACP switch in
Grok). Grok is leanest because it delegates translation to reusable `acp/AcpCoreRuntimeEvents.ts` helpers.

---

## 2. What "first-class agent" requires from any OpenRouter host

To match Codex/Claude, the OpenRouter path must, end-to-end: **stream** assistant + reasoning tokens;
**define** coding tools (read/edit files, run shell, search); **execute** those tools and **apply edits**
on disk; **feed results back** to the model and **continue multi-turn** until done; surface
**approvals**; and emit the runtime events in §1.3. Items in **bold** are the "agentic harness." In this
codebase that harness is supplied entirely by the wrapped CLI/SDK (§1.4). Therefore the hosting question
reduces to: *which CLI already provides that harness for arbitrary OpenRouter models, with acceptable
streaming + tool-call fidelity?*

---

## 3. Option A — Host OpenRouter behind an existing CLI

OpenRouter is an OpenAI-compatible gateway (`https://openrouter.ai/api/v1`, key `OPENROUTER_API_KEY`)
with an additional **Anthropic-compatible "skin"** at `https://openrouter.ai/api`. Three candidate hosts.

### 3.1 Codex CLI — possible but the worst fit right now

OpenRouter's own Codex guide configures a custom provider block:

```toml
model = "openai/gpt-latest"          # any OpenRouter slug
model_provider = "openrouter"
[model_providers.openrouter]
name = "openrouter"
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
```

**What works:** streaming + tool calls for **OpenAI-family** models, model picked via `model` slug,
project trust levels map to the app's approval flow. The app would spawn the Codex app-server with an
instance env carrying `OPENROUTER_API_KEY` and a `config.toml` selecting the openrouter provider.

**What breaks / degrades (verify before committing):**

1. **`wire_api` = Responses, not Chat.** As of **Feb 2026** Codex **deprecated and removed the
   `chat`/Chat-Completions wire API**; `responses` is now the only accepted value (default when omitted)
   — Codex errors on startup otherwise (openai/codex discussion #7782; janhq/jan #7413). But OpenRouter's
   primary, best-tested surface is **Chat Completions** at `/api/v1`. OpenRouter has been rolling out a
   **Responses-compatible** surface, and there are live reports of friction (openai/codex #12114
   *"Invalid Responses API request error with OpenRouter"*; #24286 *"OpenRouter model catalog parsing
   fails on startup"*). **Net: Codex↔OpenRouter currently sits on the least-mature endpoint pairing, and
   it is the most likely to silently break across Codex releases.**
2. **Codex is GPT-tuned.** Its system prompt, tool schema, and apply-patch format are tuned for OpenAI
   models; arbitrary OpenRouter models (DeepSeek, Llama, Gemini) degrade in tool-call fidelity.
3. **Per-instance config.toml.** Codex reads `~/.codex/config.toml` (or `$CODEX_HOME`). The app would
   need to generate/point a per-instance config, which is more plumbing than the env-only path.

**Verdict:** technically reachable, but the Responses-API requirement + GPT tuning make Codex the
**weakest** host for the user's "any model" goal. Keep it only as an OpenAI-models-via-OpenRouter option.

### 3.2 Claude Code CLI — strong for Anthropic-family, weak for "any model"

OpenRouter exposes an **Anthropic Messages-API-compatible** surface ("Anthropic Skin"). Setup is purely
environment (matches the repo's existing seam and test fixtures exactly):

```
ANTHROPIC_BASE_URL = https://openrouter.ai/api      # NOTE: /api, not /api/v1
ANTHROPIC_AUTH_TOKEN = $OPENROUTER_API_KEY
ANTHROPIC_API_KEY = ""                              # must be explicitly blank
ANTHROPIC_DEFAULT_SONNET_MODEL = ~anthropic/claude-sonnet-latest   # role → OpenRouter slug
```

Per OpenRouter's Claude Code doc: *"Claude Code speaks its native protocol directly to OpenRouter… the
Anthropic Skin handles model mapping and passes through advanced features like Thinking blocks and native
tool use"* — so **streaming, native tool use, thinking, and multi-turn all work**, and the
`ClaudeAdapter` event translation is unchanged. The app already has the wiring: `makeClaudeEnvironment`
forwards the merged instance env into the SDK `query` (`ClaudeAdapter.ts:3477`); the
`ANTHROPIC_BASE_URL=https://openrouter.ai/api` fixture is already in `serverSettings.test.ts`.

**The catch — the model dimension.** OpenRouter and Anthropic both warn this path is **only guaranteed
with the Anthropic first-party provider**; *"Claude Code is optimized for Anthropic models and may not
work correctly with other providers."* Non-Anthropic models reach Claude Code only through Anthropic-shape
translation, and **tool-call fidelity varies by model** (DeepSeek good; many others partial). So Claude
Code gives you *excellent* OpenRouter hosting for **Claude-family** models (plus failover/budgeting) but
**does not** robustly deliver the "any model" requirement.

### 3.3 OpenCode CLI — already in the app, and built for exactly this

`OpenCode` is an open-source coding agent and **multi-provider gateway** supporting *75+ providers,
including OpenRouter as a built-in provider* (OpenRouter's OpenCode guide). It is **already integrated**
in this app (`OpenCodeAdapter.ts` + `OpenCodeDriver.ts` + `OpenCodeProvider.ts`), already speaks the
`provider/model` slug OpenRouter uses, already discovers models dynamically from the running server, and
already translates OpenCode's full event stream (`message.part.delta`, `permission.asked`,
`session.status`, …) into the app's canonical events (`OpenCodeAdapter.ts:645-962`).

To reach **any** OpenRouter model you configure OpenCode's OpenRouter provider — either
`~/.local/share/opencode/auth.json` (`{ "openrouter": { "type":"api", "key":"sk-or-…" } }`) or
`opencode.json` `provider.openrouter`, plus a model slug like `anthropic/claude-sonnet-4` or
`deepseek/deepseek-v3`. OpenCode then owns the agent loop (tools, execution, edits, multi-turn,
approvals) for whatever model you point at, and the existing adapter surfaces it. **OpenRouter's own
per-request provider routing** (`options.provider.order`, `allow_fallbacks`) is even configurable per
model in `opencode.json`.

**What works:** any OpenRouter model, streaming, tool calls, approvals, multi-turn — all already
translated, **zero new adapter code**. **What's needed:** a way to set the OpenRouter key + pick a model
under the OpenCode driver (config/UI), and a decision on whether OpenRouter should *look like* its own
provider vs. "a model inside OpenCode" (see §5 recommendation and §7 open questions).

**Caveats to verify:** (1) OpenCode must be installed/spawnable (the adapter already supports a spawned or
external server, `OpenCodeAdapter.ts:1047-1056`); (2) confirm the in-app model picker can present
OpenRouter slugs from OpenCode's `providerList.connected` without code changes; (3) approval-event
mapping for OpenRouter-backed tools is the same OpenCode path already covered by
`OpenCodeAdapter.test.ts`.

---

## 4. Option B — Build a native OpenRouter harness/adapter

A new `OpenRouterAdapter` would talk to `https://openrouter.ai/api/v1/chat/completions` directly
(OpenAI-compatible, `stream:true` SSE, OpenAI-shape `tools`) and emit the §1.3 events. The OpenAI-wire
part is genuinely easy. **The hard part is everything the CLIs give you for free**, none of which exists
in this app today:

1. **Tool definitions** — author JSON-schema tools for read/write/edit file, run shell, search, etc.
2. **A tool executor** — actually run shell commands and **apply edits to disk** safely (diff/patch),
   cwd/worktree scoping, output capture/truncation. (The app currently never executes model tools.)
3. **The agent loop** — call model → receive `tool_calls` → execute → append `tool` results → re-call,
   loop until `stop`, with parallel-tool-call handling, cancellation/interrupt, and context management.
4. **Approval gating you enforce yourself** — today the CLI asks and enforces; here you'd have to gate
   each tool call against the runtime mode and the `respondToRequest` decision *before* executing.
5. **Multi-turn/session state, rollback, token accounting, error taxonomy** — to satisfy `readThread`,
   `rollbackThread`, `thread.token-usage.updated`, `turn.completed{usage,totalCostUsd}`, etc.

This is effectively writing a coding agent. Realistic effort: **large** — multiple weeks, plus an ongoing
maintenance and safety surface (sandboxing, patch application, prompt-injection-via-tool-output). There is
**no reusable in-app agent engine** to build on; the existing adapters are deliberately thin translators.
**Building B to get "any OpenRouter model" is redundant with what OpenCode already provides.** B is only
justified if you need behavior OpenCode/Claude-skin can't express (e.g. a bespoke tool set, a custom
approval policy the CLIs won't honor, or removing the OpenCode dependency entirely).

---

## 5. Recommendation

**Primary: host OpenRouter through the existing OpenCode harness.** It is the only path that delivers the
literal requirement — *any* model OpenRouter offers, as a first-class streaming, tool-calling agent —
**without writing an agent.** The harness, tool execution, edits, multi-turn, and approvals are already
integrated and already event-translated; OpenCode treats OpenRouter as a native provider with the exact
`provider/model` slug the adapter already parses.

Concretely, in priority order:

1. **Ship OpenRouter via OpenCode (low effort).** Add first-class config for OpenCode's OpenRouter
   provider: an `OPENROUTER_API_KEY` secret (reuse `ProviderInstanceEnvironment`, `sensitive:true`) and
   model selection by OpenRouter slug. Verify the model picker surfaces OpenRouter models from
   `OpenCodeProvider.ts` discovery. **No new adapter.**
2. **(Optional) Make it *look* first-class — a thin `openrouter` driver.** If the user wants OpenRouter to
   appear as its own provider (own icon/name/model list) rather than "models inside OpenCode," add an
   `OpenRouterDriver` whose `create()` constructs an **OpenCode adapter pre-pinned to the OpenRouter
   provider** (a configuration preset, not a new harness). Register it in `BUILT_IN_DRIVERS`, add an icon
   to `PROVIDER_ICON_BY_PROVIDER` and a `PROVIDER_DISPLAY_NAMES` entry, and curate a `BUILT_IN_MODELS`
   list of popular OpenRouter slugs (+ user `customModels`). This is mostly metadata/glue, reusing the
   OpenCode runtime.
3. **Add Claude-skin as a secondary route for Anthropic-family models** *(optional, near-free)*. The
   `ANTHROPIC_BASE_URL=https://openrouter.ai/api` path already works through the Claude adapter's env
   seam and gives best-in-class fidelity for Claude models routed via OpenRouter (failover/budget). Good
   for users who specifically want Claude models on OpenRouter credits.
4. **Treat Codex-via-OpenRouter as out of scope for now.** The Responses-API-only requirement + GPT
   tuning make it fragile (§3.1). Revisit only if OpenRouter's Responses surface matures and you
   specifically want OpenAI models on OpenRouter through Codex.
5. **Do not build Option B** unless a concrete need emerges that OpenCode/Claude-skin cannot meet.

**Tradeoffs of the recommendation.** Pros: smallest build, reuses a maintained multi-provider agent,
truly "any model," consistent runtime events, no new tool-execution/safety surface to own. Cons: adds/keeps
a hard dependency on the OpenCode binary/server and its release cadence; OpenRouter model **capabilities
vary** (not every model does tools/streaming well — a model-selection concern, not an architecture one);
if the user's mental model is "OpenRouter is its own provider," step 2's preset driver is needed so it
doesn't feel buried inside OpenCode.

---

## 6. OpenRouter API features — in-scope vs out

OpenRouter's Chat Completions surface supports the agent-critical features (verified, see Sources):
**streaming (SSE, `stream:true`)**, **tool/function calling** (OpenAI request shape, transformed for
non-OpenAI providers), **parallel tool calls**, **structured outputs** (`response_format` JSON/strict
schema, streamable), and **reasoning/extended-thinking** tokens with effort controls.

| Feature | In scope (via OpenCode host) | Notes |
|---|---|---|
| Chat completions + **streaming** | ✅ | Core path; adapter already maps deltas |
| **Tool / function calling** (+ parallel) | ✅ | Provided by OpenCode's loop; fidelity varies by chosen model |
| **Model catalog / "any model" slugs** | ✅ | `provider/model` slugs; OpenCode discovers connected models |
| **Provider routing** (`order`, `allow_fallbacks`, failover) | ✅ (config) | Per-model `options.provider` in `opencode.json` |
| Reasoning / thinking tokens | ✅ (model-dependent) | Maps to `reasoning_text` content delta |
| Usage/cost accounting | ◐ | OpenRouter returns usage; map to `turn.completed.totalCostUsd` / token-usage events if exposed |
| Structured outputs (`response_format`) | ◐ | Available at API level; only relevant if the app/agent requests it |
| Web search / PDF / other OpenRouter *plugins* | ❌ (out) | Out of initial scope; not part of the coding-agent loop |
| Image/video generation endpoints | ❌ (out) | Not relevant to a coding agent |
| Embeddings / rerank | ❌ (out) | Not needed for this feature |
| OpenRouter **Responses API (beta)** | ❌ (out) | Only relevant if forced down the Codex host; avoid |

"In scope" = needed to make an OpenRouter model behave like the existing agents. Everything that isn't
part of the stream-tools-edit-loop is explicitly out for v1.

---

## 7. Open questions (resolve before building)

1. **Provider identity:** Should OpenRouter appear as its **own** first-class provider (own icon, name,
   curated model list — §5 step 2 preset driver), or simply as **OpenRouter models inside the existing
   OpenCode provider**? This is the single biggest UX decision and determines whether step 2 is needed.
2. **OpenCode dependency:** Is taking/keeping a dependency on the OpenCode binary/server acceptable as the
   OpenRouter harness? (It already ships in the app, but OpenRouter-as-flagship leans on it harder.)
3. **Model list strategy:** Curate a fixed `BUILT_IN_MODELS` set of popular OpenRouter slugs, rely purely
   on dynamic discovery from OpenCode, or both (built-ins + `customModels`)? OpenRouter has hundreds of
   models with **uneven tool/stream support** — do we filter to tool-capable models, and how
   (OpenRouter's model metadata exposes `supported_parameters`)?
4. **Anthropic-skin route:** Do we also want the Claude-Code-via-OpenRouter path (§3.2) for Claude-family
   models, or is OpenCode the sole route? (Skin is near-free and higher-fidelity for Claude models.)
5. **Codex inclusion:** Confirm we are deferring Codex-via-OpenRouter given the Responses-API-only
   constraint — or is OpenAI-models-on-OpenRouter-through-Codex a must-have that justifies the fragility?
6. **Key scoping & multi-instance:** One OpenRouter key per instance via `ProviderInstanceEnvironment`
   (supports multiple instances/keys), or a single shared key? Where does the settings UI expose it
   (mirror the OpenCode `serverPassword` password-control annotation, `settings.ts:335-346`)?
7. **Capabilities/`sessionModelSwitch`:** Should OpenRouter instances allow in-session model switching
   (OpenCode supports per-turn model) — i.e. set `capabilities.sessionModelSwitch: "in-session"`?
8. **Verification plan:** Add an `OpenRouterDriver`/preset test mirroring `OpenCodeAdapter.test.ts` and
   the existing OpenRouter env fixtures; live-smoke a streaming tool-using turn against 2–3 representative
   OpenRouter models (one Anthropic, one OpenAI, one open-weight) to characterize real tool-call fidelity
   before committing the curated model list.

---

## Sources

- OpenRouter — Codex CLI integration: https://openrouter.ai/docs/cookbook/coding-agents/codex-cli
- OpenRouter — Claude Code integration: https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration
- OpenRouter — OpenCode integration: https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration
- OpenRouter — Tool & Function Calling: https://openrouter.ai/docs/guides/features/tool-calling
- OpenRouter — Structured Outputs: https://openrouter.ai/docs/guides/features/structured-outputs
- OpenRouter — API Reference overview: https://openrouter.ai/docs/api/reference/overview
- Codex — deprecating `chat/completions` (wire_api): https://github.com/openai/codex/discussions/7782
- Codex — "Invalid Responses API request" with OpenRouter: https://github.com/openai/codex/issues/12114
- Codex — OpenRouter model catalog parse failure: https://github.com/openai/codex/issues/24286
- Codex custom-provider config guide (wire_api=responses default): https://codex.danielvaughan.com/2026/04/23/codex-cli-custom-model-providers-configuration-guide/
- Repo precedent fixtures: `apps/server/src/serverSettings.test.ts:542-579`,
  `apps/server/src/provider/ProviderInstanceEnvironment.test.ts:10-11`
