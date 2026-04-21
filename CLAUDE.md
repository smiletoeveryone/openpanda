# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # install deps
npm run build            # compile TypeScript → dist/
npm run typecheck        # type-check without emit
npm run lint             # ESLint over src/
npm run test             # vitest (watch mode)
npm run test:run         # vitest single run
npm run cli              # run CLI via tsx (no build required)
npm run ui               # run terminal UI via tsx
```

Run a single test file:
```bash
npx vitest run src/core/manager.test.ts
```

Run the CLI directly:
```bash
ANTHROPIC_API_KEY=... npx tsx src/cli/index.ts spawn -n myagent "Tell me a joke"
ANTHROPIC_API_KEY=... npx tsx src/cli/index.ts list
ANTHROPIC_API_KEY=... npx tsx src/cli/index.ts stop <agent-id>
```

Run the TUI:
```bash
ANTHROPIC_API_KEY=... npx tsx src/ui/index.ts
```

## Architecture

**OpenClaw** is the internal engine name; **OpenPanda** is the public-facing CLI binary name. The project exposes the same `OpenClaw` manager class to both the CLI and the TUI — they share one instance per process.

### Core (`src/core/`)

- `types.ts` — all shared interfaces and enums (`AgentConfig`, `AgentState`, `AgentStatus`, `AgentEvent`, etc.). Every other module imports types from here; no circular deps.
- `agent.ts` — `Agent extends EventEmitter`. Wraps a single Anthropic messages call, tracks its own `AgentState` (messages history, status, error), and emits typed `AgentEvent`s. Supports `run(prompt)`, `stop()`, and `reset()`.
- `manager.ts` — `OpenClaw extends EventEmitter`. Creates and tracks `Agent` instances, enforces `maxConcurrentAgents` (checked against *running* agents at `agent.run()` time, not at spawn time), re-emits all agent events, and owns the shared `Anthropic` client.

### CLI (`src/cli/`)

Entry: `src/cli/index.ts`. Uses **Commander**. Each subcommand lives in `commands/` and receives the shared `OpenClaw` instance as an argument. Commands are one-shot (spawn→run→print→exit). The CLI constructs a new `OpenClaw` per process, so agent state is ephemeral.

### TUI (`src/ui/`)

Entry: `src/ui/index.ts`. Uses **Ink** (React for terminals). `App.tsx` owns state via React hooks and polls `manager.list()` every 500 ms, supplemented by event listeners for immediate updates. Navigation: arrow keys + enter to drill into `AgentDetail`; `s` to stop, `d` to remove, `q` to quit.

### Event flow

```
agent.run() → Anthropic API → agent emits AgentEvent
  → manager re-emits AgentEvent
    → TUI App listener → setAgents() → re-render
```

## Key conventions

- ESM throughout (`"type": "module"` in package.json). All local imports must use `.js` extension even for `.ts` source files (Node ESM requirement).
- `tsx` is used for development (no build step); `tsc` produces `dist/` for the installed binary.
- `ANTHROPIC_API_KEY` env var is the only required configuration. Copy `.env.example` to `.env` and source it, or export it directly.
- The `OpenClaw` constructor throws immediately if no API key is found — no lazy validation.
- Agent state is in-memory only; there is no persistence layer.
