<div align="center">
  <img src="assets/panda.svg" width="120" alt="OpenPanda logo" />
  <h1>OpenPanda</h1>
  <p>Lightweight AI agent manager with a CLI and an interactive streaming terminal UI, powered by <strong>Scott of Entropy AI Lab</strong>.</p>
  <p>Supports <strong>Anthropic (Claude)</strong>, <strong>OpenAI (GPT)</strong>, and <strong>Ollama (local)</strong> out of the box.</p>
</div>

---

## Install

```bash
npm install
```

## Setup

Run the interactive provider wizard on first use, or any time you want to change keys:

```bash
npm run cli -- setup
```

You'll be prompted to choose providers and enter API keys. Config is saved to `~/.openpanda/config.json`.

**Supported Providers:**
- **Anthropic (Claude)** — LLM provider
- **OpenAI (GPT)** — LLM provider  
- **Ollama (local)** — Local LLM, no key required
- **Telegram** — Bot messaging interface (optional)

**API key priority order:**
1. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL`, `TELEGRAM_BOT_TOKEN`) — always win
2. `~/.openpanda/config.json` — written by `setup`
3. `.env` file in the project root

---

## Commands

### CLI (one-shot)

```bash
# Spawn an agent and run a prompt
npm run cli -- spawn -n myagent "Explain recursion in one paragraph"

# Spawn with a specific provider and model
npm run cli -- spawn -n coder -p openai -m gpt-4o -s "You are a coding assistant" "Write fizzbuzz in Go"

# List active agents
npm run cli -- list

# Stop an agent by ID
npm run cli -- stop <agent-id>

# Re-run provider setup
npm run cli -- setup
```

### Telegram Bot

```bash
npm run cli -- telegram
```

Starts a long-polling loop. The bot accepts messages from any Telegram user (or only from a specific chat ID if `chatId` is set in config). Responses stream token-by-token and are buffered before sending to Telegram. The bot retains per-chat conversation history across messages.

**Telegram slash commands (in chat):**

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model <name>` | Change LLM model for this session |
| `/provider <name>` | Switch LLM provider (`anthropic`, `openai`, `ollama`) |
| `/agent <name>` | Apply an agent preset |
| `/skill <name>` | Apply a skill preset |
| `/info` | Show session info (provider, model, message count) |
| `/clear` | Clear message history and reset rate-limit window |

> **Note:** Telegram is a messaging interface, not an LLM provider. It requires at least one LLM provider (Anthropic, OpenAI, or Ollama) to be configured alongside it. Use `AI + Telegram` in setup to configure both together.

See [TELEGRAM_SETUP.md](./TELEGRAM_SETUP.md) for full setup instructions.

---

### Interactive chat UI (streaming TUI)

```bash
npm run cli -- chat
# With options:
npm run cli -- chat -n myagent -p anthropic -m claude-sonnet-4-6 -s "You are a pirate"
```

Responses stream token-by-token. Sessions are **automatically saved** to `~/.openpanda/sessions/` and restored on next use.

#### Chat slash commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `/help` | `/h`, `/?` | Show all commands |
| `/new <name> [provider] [model]` | | Create (or restore) a session |
| `/switch <name>` | `/sw` | Switch to another open session |
| `/sessions` | `/ls` | List open sessions with token/cost stats |
| `/close` | | Close current session |
| `/clear` | | Clear message history |
| `/model <name>` | `/m` | Change model for this session |
| `/provider <name>` | `/p` | Change provider for this session |
| `/system [prompt]` | `/sys` | Show or set the system prompt |
| `/info` | | Show session stats (model, tokens, cost, context %) |
| `/skill <name> [message]` | `/sk` | Apply a skill preset |
| `/skills` | | List all available skills |
| `/agent <name> [message]` | `/ag` | Apply an agent preset (model + provider + system prompt) |
| `/agents` | | List all available agent presets |
| `/export [filename]` | | Export session to markdown |
| `/search <query>` | `/find` | Search message history |

#### Chat keyboard shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Alt+Enter` / `Ctrl+N` | Add newline (multi-line input) |
| `Esc` | Abort streaming · dismiss suggestions · clear multiline buffer |
| `↑` / `↓` | Scroll message history (or navigate suggestions) |
| `PgUp` / `PgDn` | Scroll by 10 messages |
| `Tab` | Complete a slash command suggestion |
| `Ctrl+C` | Quit |

#### Status bar

The info bar shows `provider/model · total tokens · cost · ctx N%` (context window usage). The `ctx` indicator turns yellow above 60 % and red above 80 %.

### Agent dashboard (TUI)

```bash
npm run ui
# or:
npm run cli -- ui
```

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate agent list |
| `Enter` | Open agent detail & message history |
| `s` | Stop selected agent |
| `d` | Remove selected agent |
| `Esc` / `b` | Back to list |
| `q` | Quit |

---

## Robustness & Infra Layer (`src/infra/`)

OpenPanda includes a production-grade infrastructure layer with zero additional npm dependencies:

### Structured Logging

All log output is newline-delimited JSON to `stderr` (stdout is reserved for user output). Enable debug logs with `LOG_LEVEL=debug`.

```bash
LOG_LEVEL=debug npm run cli -- telegram 2>/tmp/op.log &
cat /tmp/op.log | head -5
# {"ts":"2026-04-21T12:00:00.000Z","level":"info","component":"telegram-bot","msg":"Received message","traceId":"...","chatId":123}
```

- Every Telegram message gets a unique **trace ID** that appears on all related log lines.
- **Secret masking** automatically strips `apiKey`, `Bearer` tokens, and `sk-*` values before writing to logs.
- Per-component child loggers bind `{ traceId, chatId }` for easy grepping.

### Per-User Rate Limiting

Telegram users are limited to **20 messages per 60 seconds** per chat. Exceeded requests receive a friendly `⏳ Rate limited. Try again in Xs.` reply. The `/clear` command resets the window.

Configurable when wiring up the bot:
```typescript
new UserRateLimiter({ windowMs: 60_000, maxRequests: 20 })
```

### Circuit Breaker (per Provider)

Each LLM provider (`anthropic`, `openai`, `ollama`) has its own circuit breaker:

| State | Condition | Behaviour |
|-------|-----------|-----------|
| Closed | Normal | Requests pass through |
| Open | 5 consecutive failures | Requests rejected immediately |
| Half-open | After 30s cooldown | 1 trial request; 2 successes → closed |

When the primary provider's circuit is open, `OpenClaw.spawn()` automatically tries the next enabled provider in the fallback chain.

### Durable Task Queue

Every incoming Telegram message is persisted to `~/.openpanda/queue.json` **before** being processed. On restart after a crash, queued tasks are drained automatically:

```bash
cat ~/.openpanda/queue.json    # tasks waiting to be processed
```

Writes are atomic (`write tmp → rename`) so the file is never left in a partial state.

### Agent Checkpointing

After each tool-use round-trip, the agent's message history is written atomically to `~/.openpanda/checkpoints/<agentId>.json`. This means a crash mid-tool-chain leaves a recoverable snapshot.

```bash
ls ~/.openpanda/checkpoints/   # one JSON file per active agent
```

### Agent Isolation

`AgentState.messages` is typed as `ReadonlyArray<AgentMessage>` — external code cannot call `.push()` on it at compile time. Use `agent.loadHistory(messages)` to restore a persisted session.

### Config File Hardening

`~/.openpanda/config.json` is set to `600` (owner read/write only) and `~/.openpanda/` to `700` on every `saveConfig()` call. API keys are never world-readable.

---

## Skills

Skills are **system prompt presets** stored as Markdown files in `skills/`. Each file has YAML frontmatter and a body that becomes the system prompt.

```markdown
---
name: coder
category: engineering
description: Expert software engineer — code, debug, architect
---

You are an expert software engineer…
```

Apply with `/skill coder` or chain a message: `/skill analyst https://example.com`.

To add a custom skill, create a new `.md` file in `skills/` — it's picked up automatically on next launch. No TypeScript required.

**Available categories:** `engineering` · `ops` · `security` · `data` · `product` · `writing` · `learning` · `creative`

**Built-in skills (30):** `coder` · `reviewer` · `architect` · `debugger` · `tester` · `frontend` · `backend` · `sql` · `api` · `shell` · `devops` · `cloudops` · `sre` · `security` · `analyst` · `datasci` · `planner` · `pm` · `ux` · `writer` · `docs` · `editor` · `summarizer` · `translator` · `teacher` · `interviewer` · `socratic` · `brainstorm` · `prompt` · `tech-auditor`

### Example: Summarizer Skill

The `summarizer` skill produces professional, detailed summaries of any content (100-1000 words depending on source volume):

```bash
# In chat:
/skill summarizer

# Then paste or describe content to summarize, e.g.:
"Summarize this article about machine learning in production"
```

**Features:**
- **Adaptive length:** 100-200 words for short content, up to 1000 words for long documents
- **Structured output:** Executive summary, key points, context & implications, actionable takeaways, caveats
- **Professional tone:** Objective, industry-specific, business-ready
- **Content-aware:** Handles research papers, news articles, technical docs, business analysis, opinions differently
- **Preserved specificity:** Retains key numbers, dates, names, and evidence

**Example output structure:**
```
Executive Summary
[Concise 1-2 sentence hook]

Key Points
• [Main finding] — [supporting detail or metric]
• [Main finding] — [supporting detail or metric]
• [Main finding] — [supporting detail or metric]

Context & Implications
[Why this matters, who's affected, strategic impact]

Actionable Takeaways
• [Who should do what]
• [Specific next steps or considerations]

Limitations
• [Any gaps, constraints, or assumptions]
```

## Agent Presets

Agent presets in `agents/` configure the **full agent** — provider, model, max tokens, and system prompt. Apply with `/agent <name>`.

```markdown
---
name: reasoning
description: Deep-thinking agent — careful, step-by-step analysis
provider: anthropic
model: claude-opus-4-6
maxTokens: 8192
---

You are a careful, methodical reasoner…
```

**Built-in presets:** `reasoning` · `fast` · `research` · `localai`

---

## Built-in Tools (via MCP)

The agent runtime ships three built-in web tools available to all sessions:

| Tool | Description |
|------|-------------|
| `fetch_page` | Fetch a URL and extract clean readable text (Mozilla Readability) |
| `search_web` | DuckDuckGo search — returns titles, URLs, snippets |
| `fetch_multiple` | Fetch up to 5 URLs in parallel |

The `analyst` and `research` skill/preset use these automatically.

---

## Provider options

| Provider | Flag | Key env var | Purpose | Notes |
|----------|------|-------------|---------|-------|
| Anthropic | `-p anthropic` | `ANTHROPIC_API_KEY` | LLM (Claude models) | Default |
| OpenAI | `-p openai` | `OPENAI_API_KEY` | LLM (GPT models) | |
| Ollama | `-p ollama` | `OLLAMA_BASE_URL` | Local LLM | No key needed; defaults to `http://localhost:11434` |
| Telegram | — | `TELEGRAM_BOT_TOKEN` | Bot messaging interface | Requires a separate LLM provider; see [TELEGRAM_SETUP.md](./TELEGRAM_SETUP.md) |

---

## Data stored on disk

| Path | Contents |
|------|----------|
| `~/.openpanda/config.json` | Provider API keys and defaults (chmod 600) |
| `~/.openpanda/sessions/<name>.json` | Auto-saved chat sessions |
| `~/.openpanda/exports/<name>-<timestamp>.md` | `/export` output |
| `~/.openpanda/queue.json` | Durable Telegram task queue (crash recovery) |
| `~/.openpanda/checkpoints/<agentId>.json` | Per-agent tool-round-trip checkpoints |

---

## Development

```bash
npm run typecheck     # type-check without emitting
npm run build         # compile to dist/
npm run test:run      # run tests once
npm run test          # run tests in watch mode

# Run a single test file
npx vitest run src/core/manager.test.ts

# Run CLI directly (no build step)
ANTHROPIC_API_KEY=... npx tsx src/cli/index.ts spawn -n myagent "Hello"

# Run TUI directly
ANTHROPIC_API_KEY=... npx tsx src/ui/index.ts

# Debug structured logs from Telegram bot
LOG_LEVEL=debug npm run cli -- telegram 2>&1 | tee /tmp/op.log
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed breakdown of the codebase.
See [FEATURES.md](FEATURES.md) for a full feature list and advantages overview.
