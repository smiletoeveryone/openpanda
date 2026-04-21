# OpenPanda — Features & Advantages

A complete reference of everything OpenPanda provides, and why each design choice matters.

---

## Multi-Provider LLM Support

| Provider | Models | Key required |
|----------|--------|-------------|
| Anthropic | Claude 3, Claude 4 (Sonnet, Opus, Haiku) | `ANTHROPIC_API_KEY` |
| OpenAI | GPT-4o, GPT-4 Turbo, o1, etc. | `OPENAI_API_KEY` |
| Ollama | Any locally-hosted model (Llama 3, Mistral, Phi, etc.) | None |

**Advantage:** You are never locked to one vendor. Switch provider or model per session, per agent, or per command — without restarting or redeploying. Ollama support means fully offline, zero-cost, privacy-preserving operation.

---

## Agentic Tool-Use Loop

Agents run a `while`-loop over `provider.streamWithTools()`, automatically executing MCP tool calls and feeding results back to the model until it produces a final answer with no tool calls (max 10 iterations).

**Built-in tools (via MCP):**

| Tool | Description |
|------|-------------|
| `fetch_page` | Fetches any URL and extracts clean readable text using Mozilla Readability |
| `search_web` | DuckDuckGo search — no API key required, returns titles, URLs, snippets |
| `fetch_multiple` | Fetches up to 5 URLs in parallel |

**Advantage:** The model can autonomously browse the web, read articles, and chain multi-step research — without you writing any glue code. The `analyst`, `research`, and `sre` skills use these automatically.

---

## Three Interfaces, One Engine

The same `OpenClaw` engine powers three completely different frontends:

### 1. Interactive Streaming TUI (`npm run cli -- chat`)
- Token-by-token streaming with live syntax highlighting
- Multi-session tabs, each with independent provider/model/system prompt
- Auto-saved sessions restored on next launch
- Cost and context-window percentage displayed in real time
- Multiline input, slash commands, command autocomplete
- Optimised for low-spec hardware (Raspberry Pi): 400 ms chunk debounce, capped forced flushes

### 2. Telegram Bot (`npm run cli -- telegram`)
- Live-updating messages via edit (streaming effect in Telegram)
- Per-chat persistent conversation history
- Full slash command suite in chat
- Rate limiting, input validation, circuit breaker protection
- Crash-durable task queue for Raspberry Pi reliability
- Works from any device with Telegram installed

### 3. One-shot CLI (`npm run cli -- spawn`)
- Scriptable: spawn an agent, get a response, exit
- Composable with shell pipelines
- Useful for cron jobs, CI steps, or quick queries

**Advantage:** One codebase, one engine, three deployment targets. Add a new interface without touching core logic.

---

## Production-Grade Infrastructure (`src/infra/`)

Added with zero new npm dependencies, using only Node.js built-ins and the existing `zod`.

### Structured JSON Logging

Every log line is a single JSON object written to `stderr`:

```json
{"ts":"2026-04-21T12:00:00Z","level":"info","component":"telegram-bot","msg":"Received message","traceId":"uuid","chatId":123456}
```

- `LOG_LEVEL` env var controls verbosity (`debug | info | warn | error`, default `info`).
- **Secret masking** — `apiKey`, `Bearer` tokens, and `sk-*` keys are automatically redacted before logging. API keys never appear in log files.
- **Trace IDs** — every Telegram message gets a UUID that appears on every related log line, enabling grep-based distributed tracing without a dedicated tracing backend.
- **Child loggers** — bind `{ traceId, chatId }` once per request; all downstream log calls inherit these fields automatically.

**Advantage:** Log files are machine-readable (pipe into `jq`), secret-safe, and traceable without any external infrastructure.

### Per-User Rate Limiting

Sliding-window rate limiter (20 requests / 60 seconds per Telegram chat by default).

- In-memory `Map<chatId, timestamp[]>` — zero database needed.
- Configurable at construction time.
- `/clear` command resets the window so a user can immediately continue after clearing history.
- `prune()` removes stale entries so the map doesn't grow unboundedly over long bot uptime.

**Advantage:** Prevents a single user from accidentally (or intentionally) exhausting your API quota in a burst. Friendly error message tells the user exactly how long to wait.

### Circuit Breaker (per LLM Provider)

Three-state machine per provider (`closed → open → half-open → closed`):

- **5 consecutive failures** open the circuit — requests fail fast without waiting for a timeout.
- **30-second cooldown** before a probe request is allowed through.
- **2 consecutive successes** close the circuit and resume normal operation.
- Module-level singleton per provider name — shared across all agents, so a flaky API affects the entire system's health view, not just one agent.
- **Automatic provider fallback:** if the requested provider's circuit is open, `manager.spawn()` transparently tries the next enabled provider.

**Advantage:** Prevents thundering-herd retries against an already-failing API. Gives the API time to recover. The fallback chain means the bot stays available even if one provider is down.

### Durable Task Queue

Every incoming Telegram message is persisted to `~/.openpanda/queue.json` **before** being processed:

1. Message arrives → `taskQueue.enqueue(task)` (atomic write).
2. `handler.handleMessage(...)` processes the message.
3. `taskQueue.remove(taskId)` (atomic write).

On restart after a crash, any tasks still in the queue are drained before the polling loop begins.

**Advantage:** No message is silently lost when the bot crashes mid-response. On a Raspberry Pi with occasional power cuts, this is the difference between "message lost" and "message processed after restart".

### Agent Checkpointing

After each tool-use round-trip inside `agent.stream()`, the full message history is written atomically to `~/.openpanda/checkpoints/<agentId>.json`.

**Advantage:** A crash during a 5-tool research chain leaves a recoverable snapshot. The checkpoint captures exactly which tools ran and what they returned, enabling future resume logic.

### Agent Message Isolation

`AgentState.messages` is typed as `ReadonlyArray<AgentMessage>`. External code cannot call `.push()` directly on it at compile time — the TypeScript compiler rejects it.

- Internal mutation goes through `Agent._messages` (private).
- External restoration uses `agent.loadHistory(messages)`.

**Advantage:** Eliminates an entire class of bug where two subsystems race to modify the same message array. The constraint is enforced at compile time, not at runtime.

### Input Validation (Zod)

All incoming Telegram message text is validated with a Zod schema before any processing:

```typescript
z.string().min(1).max(4000).transform(s => s.trim())
```

Empty messages and messages exceeding 4 000 characters are rejected with a clear error reply. This runs before rate-limit checks, session lookup, or agent calls.

**Advantage:** The system never passes unexpected input to the LLM or session machinery. Zod provides precise, typed error details with zero boilerplate.

### Config File Hardening

`~/.openpanda/config.json` is set to `chmod 600` and `~/.openpanda/` to `chmod 700` on every `saveConfig()` call.

**Advantage:** API keys in `config.json` are never world-readable. On a shared server or Raspberry Pi, other users cannot read your Anthropic or OpenAI keys.

---

## Skills System (30 Built-in Presets)

Skills are Markdown files with YAML frontmatter in `skills/`. They set the system prompt and optionally suggest a model and provider.

**Categories:**

| Category | Skills |
|----------|--------|
| Engineering | `coder`, `reviewer`, `architect`, `debugger`, `tester`, `frontend`, `backend`, `sql`, `api`, `shell` |
| Ops / Security | `devops`, `cloudops`, `sre`, `security`, `tech-auditor` |
| Data | `analyst`, `datasci` |
| Product / Design | `planner`, `pm`, `ux` |
| Writing | `writer`, `docs`, `editor`, `summarizer`, `translator` |
| Learning | `teacher`, `interviewer`, `socratic`, `brainstorm`, `prompt` |

**Advantage:** Instead of writing the same system prompt every session, activate a battle-tested prompt with one command (`/skill coder`). Adding a custom skill requires only a Markdown file — no TypeScript, no rebuild.

---

## Agent Preset System

Agent presets go further than skills — they configure the entire agent: provider, model, `maxTokens`, and system prompt.

```markdown
---
name: reasoning
provider: anthropic
model: claude-opus-4-6
maxTokens: 8192
---
You are a careful, methodical reasoner…
```

**Built-in presets:** `reasoning` · `fast` · `research` · `localai`

**Advantage:** One command (`/agent reasoning`) instantly reconfigures everything — no need to remember which model is best for which task. Custom presets are just Markdown files.

---

## Session Persistence

Chat sessions are automatically saved to `~/.openpanda/sessions/<name>.json` after every exchange and restored on next use. Saved data includes:

- Full message history (non-system messages)
- Provider and model
- Token usage totals and cost

**Advantage:** Close the terminal, restart the bot, or reboot the Pi — conversations pick up exactly where they left off.

---

## Cost & Token Tracking

The TUI chat interface tracks per-session and cumulative:
- Input and output token counts
- Dollar cost (from a built-in model→pricing table)
- Context window usage percentage (colored: gray → yellow >60% → red >80%)

**Advantage:** You always know your spend without logging into the provider dashboard. The context percentage prevents surprise failures from exceeding the model's window.

---

## Rate Limit Resilience (Anthropic)

The Anthropic provider wraps every `streamWithTools` call in `withRateLimitRetry`:

- Detects `429 rate_limit_error` responses.
- Waits with exponential backoff: 5 s → 10 s → 20 s → 40 s (capped at 60 s).
- Retries up to 4 times.
- Notifies the user via `onChunk` during the wait (`⏳ Rate limited — retrying in Xs...`).
- Respects `AbortSignal` — cancels immediately if the user aborts.

**Advantage:** Temporary rate-limit spikes are handled transparently. The user sees a progress message instead of a hard error.

---

## Raspberry Pi Optimisations

OpenPanda was built and tested on a Raspberry Pi. Specific adaptations:

| Concern | Solution |
|---------|----------|
| Slow network / stalled SSE | 90s `AbortSignal.any()` per LLM call iteration |
| Telegram HTTP vs poll timeout | Manual 65s `AbortController` timeout (> 30s poll window) |
| Ink re-render cost | 400ms chunk debounce + 4000-char forced flush in TUI |
| Telegram edit cost | 500ms debounce + 3500-char forced flush in bot |
| Crash recovery | Durable task queue + atomic file writes |
| Power cuts | Atomic writes (`write tmp → rename`) — files never corrupt mid-write |

**Advantage:** Runs reliably on the cheapest hardware. The same codebase scales up to a server without any changes.

---

## Developer Experience

- **No build step in development** — `tsx` runs TypeScript directly.
- **ESM throughout** — modern module format with full tree-shaking when compiled.
- **TypeScript strict mode** — `ReadonlyArray`, Zod schemas, and exhaustive type checking catch bugs before runtime.
- **Vitest test suite** — fast, ESM-native test runner.
- **Zero-dependency infra** — the five `src/infra/` modules add no new `node_modules` entries.
- **Constructor injection** — all infra (logger, checkpointer, rate limiter) is opt-in; existing callers compile and run without changes.
- **Markdown-only extensibility** — add skills and agent presets without touching TypeScript.

---

## Security Posture

| Threat | Mitigation |
|--------|-----------|
| API key leakage in logs | `maskSecrets()` strips keys from log output |
| API key leakage on disk | `chmod 600` on `config.json`, `chmod 700` on `~/.openpanda/` |
| Prompt injection via long inputs | Zod `max(4000)` validation rejects oversized messages |
| API quota exhaustion by one user | Per-user sliding-window rate limiter |
| Cascading failures to one provider | Circuit breaker + provider fallback chain |
| Data corruption on crash | Atomic `write tmp → rename` for all persistent files |
| Unauthorized Telegram access | Optional `chatId` restriction in config |

---

## Summary

OpenPanda combines a powerful agentic engine with a production-ready infrastructure layer that would otherwise require dedicated services (log aggregation, rate limiting, circuit breakers, task queues). Everything runs in a single Node.js process, persists to simple JSON files, and works on hardware as modest as a Raspberry Pi — with no compromises on reliability or observability.
