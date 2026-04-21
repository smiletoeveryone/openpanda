# OpenPanda — Architecture

This document describes the internal structure, data flow, and design decisions of the OpenPanda / OpenClaw codebase.

---

## Project layout

```
openpanda/
├── agents/                  # Agent preset files (one .md per preset)
├── skills/                  # Skill preset files (one .md per skill)
├── src/
│   ├── cli/                 # One-shot CLI (Commander)
│   ├── config/              # Provider config: read/write/setup wizard
│   ├── core/                # Engine: agent, manager, providers, types
│   ├── infra/               # Cross-cutting: logger, rate limiter, circuit breaker, queue, checkpointer
│   ├── mcp/                 # MCP server (tools) + in-process client
│   ├── telegram/            # Telegram bot: client, session manager, message handler
│   └── ui/                  # Terminal UIs (Ink/React)
│       └── components/      # Ink components
├── CLAUDE.md
├── README.md
├── ARCHITECTURE.md
├── FEATURES.md
└── TELEGRAM_SETUP.md
```

---

## Infrastructure Layer (`src/infra/`)

A set of zero-extra-dependency modules that provide cross-cutting reliability and observability concerns. All five files use only `node:fs`, `node:crypto`, `node:path`, `node:os`, and the existing `zod` dependency.

### `logger.ts`

Structured JSON logger with secret masking and trace ID support.

```
Output → process.stderr (stdout reserved for user-facing CLI/TUI output)
Controlled by LOG_LEVEL env var: debug | info | warn | error (default: info)
```

Key exports:
- `createLogger(component, baseCtx?)` — returns a `Logger` instance that writes one JSON line per call: `{ ts, level, component, msg, ...ctx }`.
- `child(extra)` — merges extra fields into `baseCtx` and returns a scoped logger. Used to bind `{ traceId, chatId }` per Telegram message.
- `maskSecrets(text)` — strips `"apiKey": "..."`, `Bearer <token>`, and `sk-<key>` patterns from freeform strings before they hit logs.
- `newTraceId()` — returns `crypto.randomUUID()`. One trace ID is generated per incoming Telegram message and attached to every log line for that request.

### `rateLimit.ts` — `UserRateLimiter`

Sliding-window in-memory rate limiter keyed by Telegram `chat_id`.

- Default: **20 requests per 60 seconds** per user.
- `check(userId)` filters expired timestamps, adds current timestamp if allowed, returns `{ allowed, remaining, retryAfterMs }`.
- `reset(userId)` clears the window — called by the `/clear` command.
- `prune()` removes stale map entries to prevent unbounded growth.

### `circuitBreaker.ts` — `CircuitBreaker` + `getProviderCircuitBreaker`

Per-provider circuit breaker with three states:

| State | Entry condition | Behaviour |
|-------|----------------|-----------|
| `closed` | Initial / after recovery | Requests pass through |
| `open` | 5 consecutive failures | `CircuitOpenError` thrown immediately |
| `half-open` | After 30s cooldown | 1 probe request; 2 successes → `closed` |

`getProviderCircuitBreaker(provider)` returns a module-level singleton per provider name — shared across all `spawn()` calls so failures on one agent affect the circuit state for all agents using that provider.

`manager.ts` wraps every provider method (`chat`, `stream`, `streamWithTools`) with `cb.execute(() => ...)` via `wrapWithCircuitBreaker()`.

### `taskQueue.ts` — `FileTaskQueue`

File-based durable task queue stored at `~/.openpanda/queue.json`.

- `enqueue(task)` → writes atomically (tmp → rename) and returns a `QueuedTask` with a UUID `id`.
- `remove(taskId)` → removes the task and writes atomically.
- A corrupt file is treated as empty (defensive `try/catch`).

**Crash recovery flow:** The CLI enqueues a task before calling `handler.handleMessage()` and removes it after success. On bot restart, any tasks still in the queue are drained before the polling loop begins.

### `checkpointer.ts` — `FileCheckpointer`

Per-agent snapshot files at `~/.openpanda/checkpoints/<agentId>.json`.

- `save(agentId, messages)` — atomic write after each tool round-trip in `agent.stream()`.
- `load(agentId)` — reads snapshot for potential recovery (e.g. resuming interrupted multi-tool chains).
- `clear(agentId)` — removes the checkpoint file.
- Agent IDs are sanitized (`/[^a-zA-Z0-9_\-]/g → "_"`) before use as filenames (path traversal prevention).

---

## Core engine (`src/core/`)

### `types.ts`
Central type hub. Every other module imports from here — no circular dependencies.

Key types:
- `AgentConfig` — id, name, provider, model, systemPrompt, tools, maxTokens
- `AgentState` — config + status + `messages: ReadonlyArray<AgentMessage>` + timestamps + error
- `AgentMessage` — role, content, optional rawBlocks (for tool-use replay), optional toolResults
- `AgentEvent` — typed event emitted by agents and re-emitted by the manager
- `AgentStatus` — `"idle" | "running" | "completed" | "failed" | "stopped"`

**`messages: ReadonlyArray<AgentMessage>`** — external code cannot call `.push()` on the message array at compile time. The `Agent` class owns a private mutable `_messages: AgentMessage[]` and exposes the readonly view through `state.messages`.

### `agent.ts` — `Agent extends EventEmitter`
Wraps a single `LLMProvider`. Owns its own `AgentState` (message history, status, error).

**Private `_messages: AgentMessage[]`** — the mutable backing array. `state.messages` is a `ReadonlyArray` alias for the same reference.

**`loadHistory(messages)`** — copies an external message array into `_messages`. Used by `TelegramSessionManager` to restore persisted sessions without bypassing the immutability contract.

**`stream(userMessage, callbacks)`** — the main agentic loop:
1. Pushes the user message onto the history.
2. Calls `provider.streamWithTools()` inside a `while` loop (max 10 iterations).
3. Each LLM call gets a 90-second `AbortSignal.any()` timeout (guards against stalled SSE streams).
4. If the response contains tool calls, executes them via MCP and pushes results as a user turn, then loops.
5. After each tool round-trip, calls `this.checkpointer?.save(agentId, messages)` (non-fatal if it fails).
6. When the response contains no tool calls, finalises the assistant message, fires `onUsage`, and exits the loop.

**Constructor** gains a 4th optional parameter `checkpointer?: Checkpointer` — backward-compatible.

**Callbacks on `StreamCallbacks`:**
- `onChunk(delta)` — called for every streamed text token
- `onToolStart(name, input)` — called before each MCP tool execution
- `onToolEnd(name, result)` — called after each MCP tool execution
- `onUsage(usage)` — called once when the final LLM response arrives, with `{ inputTokens, outputTokens }`

### `manager.ts` — `OpenClaw extends EventEmitter`
Creates and tracks `Agent` instances. Re-emits all agent events upward so the TUI can subscribe once.

**Constructor** gains an optional third argument `options?: { checkpointer?: Checkpointer; logger?: Logger }`. Backward-compatible with all existing call sites.

**`spawn()` — provider fallback chain:**
1. Builds a candidate list: `[requestedProvider, ...enabledProviders]` (deduplicated, `"telegram"` excluded).
2. Iterates the list; skips any provider whose circuit breaker is `"open"`.
3. Wraps the successfully built provider with `wrapWithCircuitBreaker()` so every API call participates in circuit tracking.
4. Passes `this.checkpointer` as the 4th constructor argument to `new Agent(...)`.
5. Logs a warning if it fell back to a different provider than requested.

- `maxConcurrentAgents` is checked at **`agent.run()`/`agent.stream()` time**, not at spawn time.
- `stopAll()` — called on `Ctrl+C`.

### `providers.ts` — `LLMProvider` interface
Three implementations: Anthropic, OpenAI, Ollama.

**`streamWithTools()`** returns `StreamWithToolsResult`:
```typescript
{
  text: string;
  toolCalls: ToolCall[];
  rawBlocks: unknown[];   // verbatim Anthropic content blocks for history replay
  usage?: UsageInfo;      // { inputTokens, outputTokens }
}
```

**Rate limit retry (`withRateLimitRetry`):** The Anthropic `streamWithTools` implementation wraps every API call in a retry helper. On a `429 rate_limit_error` response it waits with exponential backoff (5 s → 10 s → 20 s → 40 s, capped at 60 s) and retries up to 4 times. During the wait, `onChunk` is called with a `⏳ Rate limited — retrying in Xs...` message so the Telegram user sees feedback. If the `AbortSignal` fires during the wait, the retry is cancelled immediately.

**Anthropic streaming events captured:**
- `message_start` → `usage.input_tokens`
- `content_block_start` / `content_block_delta` / `content_block_stop` → text + tool call accumulation
- `message_delta` → `usage.output_tokens`

**OpenAI / Ollama:** tool call accumulation via index-keyed maps; usage not yet captured (APIs differ).

**Message format conversion:** `toAnthropicMessages()` handles the three-way split between plain messages, assistant turns with `rawBlocks` (tool-use turns), and user turns with `toolResults`.

---

## MCP layer (`src/mcp/`)

### `server.ts` — built-in tool server
Creates an in-process MCP server with three tools:

| Tool | Description |
|------|-------------|
| `fetch_page` | Fetches a URL, extracts readable text via Mozilla Readability + JSDOM |
| `search_web` | DuckDuckGo HTML search (no API key) |
| `fetch_multiple` | Parallel fetch of up to 5 URLs |

### `client.ts` — in-process MCP client
Connects to the server via `InMemoryTransport` (no network hop). Exposes:
- `tools()` — list of `MCPToolDef` passed to each `streamWithTools()` call
- `call(name, input)` — executes a tool and returns its text content

A singleton `getMcpClient()` is shared across all agents in the process.

---

## CLI (`src/cli/`)

Entry: `src/cli/index.ts` (Commander).

Each subcommand (`spawn`, `list`, `stop`, `chat`, `ui`, `setup`, `telegram`) lives in `commands/` and receives the shared `OpenClaw` instance. Commands are one-shot: spawn → run → print → exit, with the exception of `chat` and `telegram` which run indefinitely.

The `chat` subcommand renders `<ChatApp>` via Ink. The `ui` subcommand renders `<App>` (the dashboard). The `telegram` subcommand starts a long-polling loop (see below).

**Telegram command wires all infra at startup:**
```typescript
const log = createLogger("telegram-bot");
const checkpointer = new FileCheckpointer(join(openpandaDir, "checkpoints"));
const taskQueue = new FileTaskQueue(join(openpandaDir, "queue.json"));
const rateLimiter = new UserRateLimiter({ windowMs: 60_000, maxRequests: 20 });
const manager = new OpenClaw(config, 5, { checkpointer, logger: log });
const handler = new TelegramMessageHandler(client, sessionManager, { rateLimiter, logger: log });
```

**Crash recovery:** leftover tasks are drained from `queue.json` before the polling loop begins.

**Per-message durability:** each update is enqueued before `handleMessage()` and dequeued after completion (success or error).

---

## Telegram Bot (`src/telegram/`)

The Telegram integration turns OpenPanda into a conversational bot accessible from any Telegram client. It is started via `npm run cli -- telegram` and runs as a long-polling loop in the same process.

### `client.ts` — `TelegramClient`

Wraps the Telegram Bot HTTP API. All requests go through a single `request<T>()` method that:

- JSON-serializes array and object parameters (Telegram requires `allowed_updates` as a JSON array, not a plain string).
- Uses a manual `AbortController` + `setTimeout` for a 65-second HTTP timeout — 35 seconds longer than the 30-second long-poll window, giving the Pi's network enough headroom. When the timer fires, the error message names the method for easier diagnosis.

**`getUpdates(offset, timeout)`** long-polls Telegram for new updates, filtering to `message` events only. The `offset` is always advanced for every update type (including `edited_message`, `callback_query`, etc.) to prevent the poll offset from stalling on non-message updates.

**`sendMessage` / `editMessageText`** split messages that exceed Telegram's 4 096-character limit and send them as consecutive chunks.

### `session-manager.ts` — `TelegramSessionManager`

Maps Telegram `chat_id` values to `Agent` instances and `TelegramSession` objects. Each session tracks the current provider, model, system prompt, and streaming state.

- `getOrCreateSession(chatId, username)` — looks up an in-memory session, then falls back to loading a persisted session from `~/.openpanda/sessions/telegram_<chatId>_<username>.json`. If neither exists, spawns a fresh agent.
- **Provider guard:** If `defaultProvider` is `"telegram"` (a misconfiguration from setup), the session manager falls back to `"anthropic"` so agents always receive a valid LLM provider.
- `persistSession()` / `clearSession()` — delegate to `sessionStore.ts` using the same file format as the TUI chat sessions.
- **History restoration:** uses `agent.loadHistory(messages)` instead of directly pushing onto `agent.state.messages`, respecting the `ReadonlyArray` immutability contract.

### `message-handler.ts` — `TelegramMessageHandler`

Routes incoming messages to agents and handles slash commands.

**Constructor** accepts optional `options?: { rateLimiter?: UserRateLimiter; logger?: Logger }` — backward-compatible.

**Input validation:** All incoming text is validated with a Zod schema (`z.string().min(1).max(4000).transform(trim)`) before any processing. Invalid input is rejected with an error reply.

**Rate limiting:** `rateLimiter.check(chatId)` is called before routing. If the limit is exceeded, the user receives `⏳ Rate limited. Try again in Xs.` and the message is dropped.

**Trace IDs + logging:** `newTraceId()` is called at the top of `handleMessage()`, and a child logger bound with `{ traceId, chatId }` is used for all subsequent log calls.

**Regular messages → `streamResponse()`:**
1. Creates a `StreamBuffer` (`{ text, messageId, timer }`).
2. Passes an `onChunk` callback to `agent.stream()`. Chunks accumulate in `buffer.text`.
3. A 500 ms debounce timer calls `flushStreamBuffer()`, which either sends a new Telegram message (first flush) or edits the existing one (subsequent flushes). This produces a live-updating message effect.
4. A forced flush triggers at 3 500 characters to stay under Telegram's 4 096-character edit limit.
5. On completion, if no message was ever sent (e.g., empty response), a fallback `"✓ Done"` is sent.

**Slash commands:** `/help`, `/model`, `/provider`, `/agent`, `/skill`, `/info`, `/clear`. Each sub-handler sends a direct reply via `sendMessage`. `/clear` also calls `rateLimiter.reset(chatId)`.

**Concurrency guard:** If `isStreaming(chatId)` is true when a new message arrives, the bot replies with `"⏳ Still processing previous message..."` and discards the new message.

---

## Config (`src/config/`)

### `store.ts` — `saveConfig()`

After writing `config.json`, calls `chmodSync(CONFIG_DIR, 0o700)` and `chmodSync(CONFIG_FILE, 0o600)` (both wrapped in `try/catch` for non-POSIX portability). This ensures API keys are never world-readable.

### `setup.ts`

Interactive provider setup wizard. Filters `"telegram"` from the list of selectable **default providers** and **default models** — Telegram is a messaging interface, not an LLM provider. A defensive fallback in `session-manager.ts` also guards against stale configs where `defaultProvider === "telegram"`.

---

## Terminal UI (`src/ui/`)

Built with **Ink 5** (React for terminals) + **ink-text-input**.

### `components/ChatApp.tsx`
The main chat interface. Key state:

| State | Purpose |
|-------|---------|
| `sessions: Map<string, Session>` | All open sessions, keyed by name |
| `currentName` | Active session |
| `input` | Current line being typed |
| `inputLines: string[]` | Committed lines for multiline input |
| `isStreaming` | Blocks input while a response is in flight |
| `pendingMessage` | Message queued to fire after a React commit (used by `/skill` / `/agent`) |
| `scrollOffset` | Rows scrolled up from the bottom |
| `autoScroll: ref` | Whether to snap to bottom on new messages |

**Chunk buffering:** Streamed tokens accumulate in `chunkBuf` (a ref). A 400 ms debounce timer flushes the buffer to React state, capped at a forced flush every 4 000 chars. This keeps Ink re-render frequency low enough for Raspberry Pi.

**Effect ordering (critical):** `sendMessageRef` update effect is declared *before* the `pendingMessage` effect. React runs effects in declaration order within the same commit. If reversed, the pending message fires with a stale ref pointing to the pre-skill agent.

**Multiline input:** `Alt+Enter` / `Ctrl+N` pushes the current line onto `inputLines` and clears `input`. Regular `Enter` joins all `inputLines` + current `input` and sends.

**Session persistence:** After each completed exchange, `saveSession()` is called with the non-system messages and token usage. On `/new <name>` and startup, `loadSession(name)` is checked; if a saved session exists it is restored automatically.

**Token & cost tracking:** `onUsage` callback accumulates per-session `{ inputTokens, outputTokens, totalCost }`. Cost is calculated from a model→pricing table ($/M tokens). Displayed in the info bar as `N tok · $X.XXX · ctx N%`.

**Context window indicator:** A model→max-context map provides the denominator. `inputTokens / ctxMax` gives the percentage, colored gray → yellow (>60%) → red (>80%).

**Syntax highlighting:** Assistant messages are parsed into text and fenced-code-block segments by `highlight.ts`. Code blocks render in a left-bordered box with a language label. Lines containing comments are dim-gray; lines containing keywords are yellow.

### `components/App.tsx`
Agent dashboard. Polls `manager.list()` every 500 ms and subscribes to manager events for immediate updates. Arrow keys + Enter to drill into `AgentDetail`; `s` to stop, `d` to remove, `q` to quit.

---

## Skills system (`skills/`, `src/ui/skillLoader.ts`)

Skills are **system prompt presets**. Each is a Markdown file with YAML frontmatter:

```markdown
---
name: coder
category: engineering
description: Expert software engineer — code, debug, architect
suggestedModel: claude-opus-4-6   # optional
provider: anthropic                # optional
---

System prompt body…
```

`loadSkills()` reads `skills/*.md` at startup using `import.meta.url` to resolve the path. Works identically in dev (`tsx`, source at `src/ui/`) and production (compiled at `dist/ui/`).

`SKILLS = loadSkills()` is evaluated once at module load and exported from `commands.ts`.

To add a skill: drop a `.md` file in `skills/` and restart.

---

## Agent presets system (`agents/`, `src/ui/agentLoader.ts`)

Agent presets configure the **full agent** — provider, model, maxTokens, and system prompt:

```markdown
---
name: reasoning
description: Deep-thinking agent
provider: anthropic
model: claude-opus-4-6
maxTokens: 8192
---

System prompt body…
```

`AGENT_PRESETS = loadAgents()` follows the same pattern as `SKILLS`. Applied via `/agent <name>`, which re-spawns the agent with the preset's full config and updates the session state.

---

## Persistence (`src/ui/sessionStore.ts`)

All persistence lives under `~/.openpanda/`:

| Path | Written by | Read by |
|------|-----------|---------|
| `config.json` | `setup` wizard / `saveConfig()` | all commands on startup |
| `sessions/<name>.json` | `saveSession()` after each exchange | `loadSession()` on `/new` and init |
| `exports/<name>-<ts>.md` | `/export` command | user |
| `queue.json` | `FileTaskQueue` | Telegram bot on startup (drain) and per-message |
| `checkpoints/<agentId>.json` | `FileCheckpointer` | crash recovery / future resumption |

`PersistedSession` stores only non-system messages (system messages are UI-generated and not worth replaying). Token usage is preserved across restarts.

---

## Event flow

```
User types → submit() → sendMessage()
  → agent.stream(text, callbacks)
    → provider.streamWithTools()          (Anthropic / OpenAI / Ollama)
      → chunk event → onChunk()
        → chunkBuf accumulation (debounced 400 ms)
          → flushChunks() → setSessions() → Ink re-render
      → tool_call detected → onToolStart()
        → mcp.call(name, input)           (in-process, no network)
          → onToolEnd()
          → push tool result → loop back to provider
          → checkpointer.save()           (atomic JSON write)
      → final text, no tool calls → onUsage()
        → setSessions() (update tokenUsage)
    → finalizeStream() → mark streaming=false
    → saveSession() → ~/.openpanda/sessions/<name>.json
  → setIsStreaming(false) → input re-enabled
```

**Telegram message flow:**

```
Telegram update received
  → taskQueue.enqueue(task)               (durable before processing)
  → rateLimiter.check(chatId)            (rate gate)
  → InputSchema.safeParse(text)          (Zod validation)
  → circuitBreaker.execute(providerCall) (fault isolation)
  → agent.stream(text, callbacks)
      → … (same as above)
  → taskQueue.remove(taskId)             (dequeue on success)
  → sessionManager.persistSession()
```

---

## Key conventions

- **ESM throughout** — `"type": "module"` in `package.json`. All local imports use `.js` extensions even for `.ts` source files.
- **`tsx` for dev** — no build step needed. `tsc` produces `dist/` for the installed binary.
- **No lazy validation** — `OpenClaw` constructor throws immediately if no API key is found.
- **In-memory agent state** — agent message history lives in `AgentState.messages[]` on the `Agent` instance. Chat session persistence is a separate layer in `sessionStore.ts`.
- **`ReadonlyArray` immutability** — `AgentState.messages` is `ReadonlyArray<AgentMessage>`; only `Agent` itself mutates via `_messages`. External code must call `agent.loadHistory()`.
- **Atomic file writes** — all infra file writes use `writeFileSync(tmp) + renameSync(tmp, final)` — POSIX-atomic, safe on the Raspberry Pi's Linux filesystem.
- **Constructor injection** — logger, checkpointer, and rate limiter are injected as optional constructor params. All infra is opt-in; existing callers need no changes.
- **Telegram is a messaging interface, not an LLM provider** — `"telegram"` must never appear as `defaultProvider` or `defaultModel`. The setup wizard filters it out of the default provider/model selection. The `TelegramSessionManager` also guards against stale configs by falling back to `"anthropic"` if `defaultProvider === "telegram"`. LLM API calls go to whichever real provider (Anthropic / OpenAI / Ollama) is configured.
