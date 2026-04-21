import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { OpenClaw } from "../../core/manager.js";
import { Agent } from "../../core/agent.js";
import type { ProviderName } from "../../config/store.js";
import {
  SLASH_COMMANDS,
  SKILLS,
  suggestCommands,
  parseArgs,
  type SlashCommand,
} from "../commands.js";
import { AGENT_PRESETS } from "../agentLoader.js";
import { saveSession, loadSession, exportSession, deleteSession, type PersistedSession } from "../sessionStore.js";
import { parseSegments, lineColor } from "../highlight.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

interface Session {
  name: string;
  agent: Agent;
  provider: string;
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  tokenUsage: TokenUsage;
}

interface Props {
  manager: OpenClaw;
  agentName?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
}

// ── Category colours ──────────────────────────────────────────────────────────

const CAT_COLOR: Record<SlashCommand["category"], string> = {
  session: "cyan",
  agent: "yellow",
  skill: "magenta",
  util: "gray",
};

// ── Model metadata ────────────────────────────────────────────────────────────

const CTX_WINDOW: Record<string, number> = {
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
};

// Pricing in $ per million tokens { input, output }
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "gpt-4o": { input: 5, output: 15 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

function fmtCost(cost: number): string {
  if (cost < 0.001) return `<$0.001`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── MessageContent: syntax-highlighted renderer ───────────────────────────────

function MessageContent({ content, streaming }: { content: string; streaming?: boolean }) {
  const segments = parseSegments(content);
  return (
    <Box flexDirection="column" width="100%">
      {segments.map((seg, si) => {
        if (seg.type === "text") {
          return (
            <Box key={si} paddingY={0} width="100%">
              <Text wrap="wrap">
                {seg.content}
                {streaming && si === segments.length - 1 ? <Text color="yellow">▋</Text> : null}
              </Text>
            </Box>
          );
        }
        // Code block — with better styling
        const lines = seg.content.split("\n");
        const langLabel = seg.lang && seg.lang !== "text" ? seg.lang : "code";
        return (
          <Box key={si} flexDirection="column" marginY={1} width="100%"
            borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
            {/* Language badge */}
            <Box paddingTop={0} paddingBottom={0} marginBottom={0}>
              <Text color="gray" bold>{`╭─ ${langLabel} `}</Text>
            </Box>
            {/* Code lines */}
            <Box flexDirection="column" paddingLeft={1} paddingRight={0}>
              {lines.map((line, li) => {
                const color = lineColor(line);
                return (
                  <Box key={li} width="100%">
                    <Text color={color} wrap="wrap">{line || " "}</Text>
                  </Box>
                );
              })}
            </Box>
            {/* Bottom border */}
            <Box paddingTop={0} marginTop={0}>
              <Text color="gray" bold>╰</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatApp({
  manager,
  agentName = "panda",
  provider,
  model,
  systemPrompt,
}: Props) {
  const { exit } = useApp();

  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [currentName, setCurrentName] = useState<string>(agentName);
  const [input, setInput] = useState("");
  // Committed lines for multiline mode (Alt+Enter appends here)
  const [inputLines, setInputLines] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SlashCommand[]>([]);
  const [suggestionIdx, setSuggestionIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const autoScroll = useRef(true);
  const initialized = useRef(false);
  const currentNameRef = useRef(currentName);
  useEffect(() => { currentNameRef.current = currentName; }, [currentName]);

  // ── Init first session ────────────────────────────────────────────────────

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const welcome: ChatMessage = {
      role: "system",
      content:
        "Type a message to chat, or / to see commands.\n" +
        "Try /skill coder · /agent reasoning · /new mysession · /help\n" +
        "Alt+Enter for multi-line input · Esc to abort stream",
    };

    manager
      .spawn({
        name: agentName,
        provider: provider as ProviderName | undefined,
        model,
        systemPrompt,
      })
      .then((agent) => {
        // Always start fresh on app startup — no auto-restore of initial session.
        // Users can restore saved sessions explicitly with /new <name>
        const session: Session = {
          name: agentName,
          agent,
          provider: provider ?? manager.config.defaultProvider,
          model: model ?? manager.config.defaultModel,
          systemPrompt,
          messages: [welcome],
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
        };
        setSessions(new Map([[agentName, session]]));
      });
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const current = sessions.get(currentName);

  const updateSession = useCallback(
    (name: string, updater: (s: Session) => Session) => {
      setSessions((prev) => {
        const s = prev.get(name);
        if (!s) return prev;
        const next = new Map(prev);
        next.set(name, updater(s));
        return next;
      });
    },
    []
  );

  const pushMsg = useCallback(
    (sessionName: string, msg: ChatMessage) => {
      updateSession(sessionName, (s) => ({
        ...s,
        messages: [...s.messages, msg],
      }));
    },
    [updateSession]
  );

  const sysMsg = useCallback(
    (content: string) => {
      const lines = content.split("\n");
      updateSession(currentName, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          ...lines.map((line) => ({ role: "system" as const, content: line })),
        ],
      }));
    },
    [currentName, updateSession]
  );

  // ── Persistence helpers ───────────────────────────────────────────────────

  const persistSession = useCallback((name: string, sessMap: Map<string, Session>) => {
    const s = sessMap.get(name);
    if (!s) return;
    const persisted: PersistedSession = {
      name: s.name,
      provider: s.provider,
      model: s.model,
      systemPrompt: s.systemPrompt,
      messages: s.messages.filter((m) => m.role !== "system"),
      tokenUsage: s.tokenUsage,
      savedAt: new Date().toISOString(),
    };
    saveSession(persisted);
  }, []);

  // ── Chunk buffer ─────────────────────────────────────────────────────────

  const chunkBuf = useRef("");
  const chunkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushChunks = useCallback(() => {
    const delta = chunkBuf.current;
    if (!delta) return;
    chunkBuf.current = "";
    const name = currentNameRef.current;
    setSessions((prev) => {
      const s = prev.get(name);
      if (!s) return prev;
      const msgs = s.messages;
      const streamIdx = msgs.findLastIndex((m: ChatMessage) => m.streaming);
      const next = new Map(prev);
      if (streamIdx >= 0) {
        const updated = [...msgs];
        updated[streamIdx] = { ...updated[streamIdx], content: updated[streamIdx].content + delta };
        next.set(name, { ...s, messages: updated });
      } else {
        next.set(name, {
          ...s,
          messages: [...msgs, { role: "assistant", content: delta, streaming: true }],
        });
      }
      return next;
    });
  }, []);

  const appendChunk = useCallback(
    (delta: string) => {
      chunkBuf.current += delta;
      if (chunkBuf.current.length > 4_000) {
        if (chunkTimer.current) { clearTimeout(chunkTimer.current); chunkTimer.current = null; }
        flushChunks();
      } else if (!chunkTimer.current) {
        chunkTimer.current = setTimeout(() => {
          chunkTimer.current = null;
          flushChunks();
        }, 400);
      }
    },
    [flushChunks]
  );

  const finalizeStream = useCallback(() => {
    if (chunkTimer.current) {
      clearTimeout(chunkTimer.current);
      chunkTimer.current = null;
    }
    flushChunks();
    const name = currentNameRef.current;
    setSessions((prev) => {
      const s = prev.get(name);
      if (!s) return prev;
      if (!s.messages.some((m) => m.streaming)) return prev;
      const next = new Map(prev);
      next.set(name, {
        ...s,
        messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      });
      return next;
    });
  }, [flushChunks]);

  // ── Slash command handler ─────────────────────────────────────────────────

  const runCommand = useCallback(
    async (raw: string): Promise<string | undefined> => {
      const { cmd, args } = parseArgs(raw);

      // /help
      if (cmd === "help" || cmd === "h" || cmd === "?") {
        const lines = ["Available commands:\n"];
        const byCategory = new Map<string, SlashCommand[]>();
        for (const c of SLASH_COMMANDS) {
          const list = byCategory.get(c.category) ?? [];
          list.push(c);
          byCategory.set(c.category, list);
        }
        for (const [cat, cmds] of byCategory) {
          lines.push(`[${cat}]`);
          for (const c of cmds) {
            const alias = c.aliases ? ` (${c.aliases.map((a) => "/" + a).join(", ")})` : "";
            lines.push(`  ${c.usage}${alias}\n    ${c.description}`);
          }
        }
        sysMsg(lines.join("\n"));
        return;
      }

      // /sessions | /ls
      if (cmd === "sessions" || cmd === "ls") {
        if (!sessions.size) { sysMsg("No sessions."); return; }
        const lines = ["Sessions (→ = current):"];
        for (const [name, s] of sessions) {
          const active = name === currentName ? "→ " : "  ";
          const usage = s.tokenUsage.inputTokens > 0
            ? `  [${fmtTokens(s.tokenUsage.inputTokens + s.tokenUsage.outputTokens)} tok · ${fmtCost(s.tokenUsage.totalCost)}]`
            : "";
          lines.push(
            `${active}${name}  [${s.provider}/${s.model}]  ${s.messages.filter((m) => m.role !== "system").length} msgs${usage}`
          );
        }
        sysMsg(lines.join("\n"));
        return;
      }

      // /new <name> [provider] [model]
      if (cmd === "new") {
        const [name, prov, mdl] = args;
        if (!name) { sysMsg("Usage: /new <session-name> [provider] [model]"); return; }
        if (sessions.has(name)) { sysMsg(`Session "${name}" already exists. Use /switch ${name}`); return; }
        // Try to restore saved session
        const saved = loadSession(name);
        sysMsg(saved ? `Restoring session "${name}"…` : `Creating session "${name}"…`);
        const agent = await manager.spawn({
          name,
          provider: (prov ?? saved?.provider) as ProviderName | undefined,
          model: mdl ?? saved?.model,
          systemPrompt: saved?.systemPrompt,
        });
        const session: Session = {
          name,
          agent,
          provider: prov ?? saved?.provider ?? manager.config.defaultProvider,
          model: mdl ?? saved?.model ?? manager.config.defaultModel,
          systemPrompt: saved?.systemPrompt,
          messages: saved?.messages?.length
            ? [
                ...saved.messages,
                { role: "system", content: `↩ Restored ${saved.messages.filter(m => m.role !== "system").length} messages.` },
              ]
            : [{ role: "system", content: `Session "${name}" ready.` }],
          tokenUsage: saved?.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalCost: 0 },
        };
        setSessions((prev) => new Map(prev).set(name, session));
        setCurrentName(name);
        return;
      }

      // /switch <name>
      if (cmd === "switch" || cmd === "sw") {
        const [name] = args;
        if (!name) { sysMsg("Usage: /switch <session-name>"); return; }
        if (!sessions.has(name)) {
          sysMsg(`No session "${name}". Sessions: ${[...sessions.keys()].join(", ")}`);
          return;
        }
        setCurrentName(name);
        return;
      }

      // /close
      if (cmd === "close") {
        if (sessions.size === 1) { sysMsg("Cannot close the last session."); return; }
        const closing = currentName;
        sessions.get(closing)?.agent.stop();
        setSessions((prev) => {
          const next = new Map(prev);
          next.delete(closing);
          return next;
        });
        const remaining = [...sessions.keys()].filter((k) => k !== closing);
        setCurrentName(remaining[0]);
        return;
      }

      // /clear
      if (cmd === "clear") {
        current?.agent.reset();
        deleteSession(currentName); // Delete persisted session so it doesn't auto-restore on restart
        updateSession(currentName, (s) => ({
          ...s,
          messages: [{ role: "system", content: "History cleared. Persisted session deleted." }],
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
        }));
        return;
      }

      // /model <model>
      if (cmd === "model" || cmd === "m") {
        const [mdl] = args;
        if (!mdl) {
          sysMsg(`Current model: ${current?.model ?? "unknown"}`);
          return;
        }
        if (!current) return;
        const agent = await manager.spawn({
          name: currentName,
          provider: current.provider as ProviderName,
          model: mdl,
          systemPrompt: current.systemPrompt,
        });
        updateSession(currentName, (s) => ({
          ...s,
          agent,
          model: mdl,
          messages: [...s.messages, { role: "system", content: `Model → ${mdl}` }],
        }));
        return;
      }

      // /provider <name>
      if (cmd === "provider" || cmd === "p") {
        const [prov] = args;
        if (!prov) { sysMsg(`Current provider: ${current?.provider ?? "unknown"}`); return; }
        if (!current) return;
        const agent = await manager.spawn({
          name: currentName,
          provider: prov as ProviderName,
          model: current.model,
          systemPrompt: current.systemPrompt,
        });
        updateSession(currentName, (s) => ({
          ...s,
          agent,
          provider: prov,
          messages: [...s.messages, { role: "system", content: `Provider → ${prov}` }],
        }));
        return;
      }

      // /system [prompt]
      if (cmd === "system" || cmd === "sys") {
        if (!args.length) {
          sysMsg(`System prompt: ${current?.systemPrompt ?? "(none)"}`);
          return;
        }
        const prompt = args.join(" ");
        if (!current) return;
        const agent = await manager.spawn({
          name: currentName,
          provider: current.provider as ProviderName,
          model: current.model,
          systemPrompt: prompt,
        });
        updateSession(currentName, (s) => ({
          ...s,
          agent,
          systemPrompt: prompt,
          messages: [...s.messages, { role: "system", content: `System prompt updated.` }],
        }));
        return;
      }

      // /info
      if (cmd === "info") {
        if (!current) return;
        const msgCount = current.messages.filter((m) => m.role !== "system").length;
        const { inputTokens, outputTokens, totalCost } = current.tokenUsage;
        const ctxMax = CTX_WINDOW[current.model] ?? 128_000;
        sysMsg(
          `Session: ${current.name}\n` +
          `Provider: ${current.provider}\n` +
          `Model:    ${current.model}  (ctx ${fmtTokens(ctxMax)})\n` +
          `System:   ${current.systemPrompt ?? "(none)"}\n` +
          `Messages: ${msgCount}\n` +
          `Tokens:   ${fmtTokens(inputTokens)} in · ${fmtTokens(outputTokens)} out\n` +
          `Cost:     ${fmtCost(totalCost)}`
        );
        return;
      }

      // /export [filename]
      if (cmd === "export") {
        if (!current) return;
        const persisted: PersistedSession = {
          name: current.name,
          provider: current.provider,
          model: current.model,
          systemPrompt: current.systemPrompt,
          messages: current.messages.filter((m) => m.role !== "system"),
          tokenUsage: current.tokenUsage,
          savedAt: new Date().toISOString(),
        };
        const outPath = exportSession(persisted, args[0]);
        sysMsg(`Exported to: ${outPath}`);
        return;
      }

      // /search <query>
      if (cmd === "search" || cmd === "find") {
        if (!args.length) { sysMsg("Usage: /search <query>"); return; }
        if (!current) return;
        const query = args.join(" ").toLowerCase();
        const hits = current.messages
          .map((m, i) => ({ m, i }))
          .filter(({ m }) => m.role !== "system" && m.content.toLowerCase().includes(query));
        if (!hits.length) {
          sysMsg(`No matches for "${args.join(" ")}"`);
          return;
        }
        const lines = [`Found ${hits.length} match${hits.length !== 1 ? "es" : ""} for "${args.join(" ")}":\n`];
        for (const { m, i } of hits.slice(0, 10)) {
          const excerpt = m.content.slice(0, 120).replace(/\n/g, " ");
          lines.push(`  #${i} [${m.role}] ${excerpt}${m.content.length > 120 ? "…" : ""}`);
        }
        if (hits.length > 10) lines.push(`  … and ${hits.length - 10} more`);
        sysMsg(lines.join("\n"));
        return;
      }

      // /skills
      if (cmd === "skills") {
        const byCategory = new Map<string, typeof SKILLS[string][]>();
        for (const skill of Object.values(SKILLS)) {
          const list = byCategory.get(skill.category) ?? [];
          list.push(skill);
          byCategory.set(skill.category, list);
        }
        const lines = ["Available skills (use /skill <name>):\n"];
        for (const [cat, skillList] of byCategory) {
          lines.push(`[${cat}]`);
          for (const s of skillList) {
            lines.push(`  /skill ${s.name.padEnd(14)} ${s.description}`);
          }
        }
        sysMsg(lines.join("\n"));
        return;
      }

      // /skill <name> [optional follow-up message...]
      if (cmd === "skill" || cmd === "sk") {
        const [skillName, ...rest] = args;
        if (!skillName) { sysMsg("Usage: /skill <name>  —  try /skills to list them"); return; }
        const skill = SKILLS[skillName.toLowerCase()];
        if (!skill) { sysMsg(`Unknown skill "${skillName}". Try /skills`); return; }
        if (!current) return;
        const agent = await manager.spawn({
          name: currentName,
          provider: (skill.provider ?? current.provider) as ProviderName,
          model: skill.suggestedModel ?? current.model,
          systemPrompt: skill.systemPrompt,
        });
        updateSession(currentName, (s) => ({
          ...s,
          agent,
          systemPrompt: skill.systemPrompt,
          messages: [
            ...s.messages,
            { role: "system", content: `Skill applied: ${skill.name} — ${skill.description}` },
          ],
        }));
        return rest.length ? rest.join(" ") : undefined;
      }

      // /agents
      if (cmd === "agents") {
        const presets = Object.values(AGENT_PRESETS);
        if (!presets.length) { sysMsg("No agent presets found in agents/."); return; }
        const lines = ["Available agent presets (use /agent <name>):\n"];
        for (const a of presets) {
          const meta = [a.provider, a.model].filter(Boolean).join("/");
          lines.push(`  /agent ${a.name.padEnd(12)} ${a.description}${meta ? `  [${meta}]` : ""}`);
        }
        sysMsg(lines.join("\n"));
        return;
      }

      // /agent <name> [optional follow-up message...]
      if (cmd === "agent" || cmd === "ag") {
        const [presetName, ...rest] = args;
        if (!presetName) { sysMsg("Usage: /agent <name>  —  try /agents to list them"); return; }
        const preset = AGENT_PRESETS[presetName.toLowerCase()];
        if (!preset) { sysMsg(`Unknown agent preset "${presetName}". Try /agents`); return; }
        if (!current) return;
        const agent = await manager.spawn({
          name: currentName,
          provider: (preset.provider ?? current.provider) as ProviderName,
          model: preset.model ?? current.model,
          systemPrompt: preset.systemPrompt,
          maxTokens: preset.maxTokens,
        });
        updateSession(currentName, (s) => ({
          ...s,
          agent,
          provider: preset.provider ?? s.provider,
          model: preset.model ?? s.model,
          systemPrompt: preset.systemPrompt,
          messages: [
            ...s.messages,
            { role: "system", content: `Agent preset: ${preset.name} — ${preset.description}` },
          ],
        }));
        return rest.length ? rest.join(" ") : undefined;
      }

      sysMsg(`Unknown command "/${cmd}". Try /help`);
    },
    [current, currentName, sessions, manager, sysMsg, updateSession]
  );

  // ── Submit handler ────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !current) return;
    setIsStreaming(true);

    try {
      pushMsg(currentName, { role: "user", content: text });
      await current.agent.stream(text, {
        onChunk: appendChunk,
        onToolStart: (name, input) => {
          finalizeStream();
          const url = (input as Record<string, unknown>)?.url as string | undefined;
          const query = (input as Record<string, unknown>)?.query as string | undefined;
          const detail = url ?? query ?? "";
          sysMsg(`⚙ ${name}${detail ? ` → ${detail}` : ""}`);
        },
        onToolEnd: (_name, result) => {
          sysMsg(`  └ ${result.length.toLocaleString()} chars`);
        },
        onUsage: (usage) => {
          const name = currentNameRef.current;
          setSessions((prev) => {
            const s = prev.get(name);
            if (!s) return prev;
            const cost = calcCost(s.model, usage.inputTokens, usage.outputTokens);
            const next = new Map(prev);
            next.set(name, {
              ...s,
              tokenUsage: {
                inputTokens: s.tokenUsage.inputTokens + usage.inputTokens,
                outputTokens: s.tokenUsage.outputTokens + usage.outputTokens,
                totalCost: s.tokenUsage.totalCost + cost,
              },
            });
            return next;
          });
        },
      });
      finalizeStream();
      // Persist after each completed exchange
      setSessions((prev) => { persistSession(currentNameRef.current, prev); return prev; });
    } catch (err) {
      finalizeStream();
      sysMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsStreaming(false);
    }
  }, [current, currentName, pushMsg, appendChunk, finalizeStream, sysMsg, persistSession]);

  // ── Pending message (fired after React commits new agent from /skill etc.) ─

  const sendMessageRef = useRef<((text: string) => Promise<void>) | null>(null);

  // Step 1: keep ref current (runs first — declared first).
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  // Step 2: fire queued message now that ref points to the right agent.
  useEffect(() => {
    if (!pendingMessage || isStreaming) return;
    const msg = pendingMessage;
    setPendingMessage(null);
    sendMessageRef.current?.(msg);
  }, [pendingMessage, isStreaming]);

  const submit = useCallback(async () => {
    // Combine multiline buffer with current input
    const allLines = [...inputLines, input].filter(Boolean);
    const text = allLines.join("\n").trim();
    if (!text || isStreaming) return;

    setInput("");
    setInputLines([]);
    setSuggestions([]);

    if (text.startsWith("/")) {
      const trailing = await runCommand(text);
      if (trailing) setPendingMessage(trailing);
      return;
    }

    await sendMessage(text);
  }, [input, inputLines, isStreaming, runCommand, sendMessage]);

  // ── Input change — show suggestions for slash commands ────────────────────

  const handleInputChange = useCallback((val: string) => {
    setInput(val);
    if (inputLines.length === 0 && val.startsWith("/") && !val.includes(" ")) {
      const matches = suggestCommands(val);
      setSuggestions(matches);
      setSuggestionIdx(0);
    } else {
      setSuggestions([]);
    }
  }, [inputLines.length]);

  // ── Scroll management ─────────────────────────────────────────────────────

  const msgCount = current?.messages.length ?? 0;

  useEffect(() => {
    if (autoScroll.current) setScrollOffset(0);
  }, [msgCount]);

  useEffect(() => {
    setScrollOffset(0);
    autoScroll.current = true;
  }, [currentName]);

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      manager.stopAll();
      exit();
      return;
    }

    // Escape: abort stream or clear multiline buffer
    if (key.escape) {
      if (isStreaming) {
        current?.agent.stop();
        setIsStreaming(false);
        return;
      }
      if (inputLines.length > 0) {
        setInputLines([]);
        return;
      }
      if (suggestions.length) {
        setSuggestions([]);
        return;
      }
    }

    // Alt+Enter or Ctrl+N: add newline to multiline buffer
    if ((key.meta && key.return) || (key.ctrl && ch === "n")) {
      if (input.trim() || inputLines.length > 0) {
        setInputLines((lines) => [...lines, input]);
        setInput("");
        setSuggestions([]);
      }
      return;
    }

    if (suggestions.length) {
      if (key.upArrow) { setSuggestionIdx((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (key.downArrow) { setSuggestionIdx((i) => (i + 1) % suggestions.length); return; }
      if (key.tab) { setInput("/" + suggestions[suggestionIdx].name + " "); setSuggestions([]); return; }
    }

    // Scroll message history when not navigating suggestions
    if (!suggestions.length) {
      const step = 1;  // Scroll by single message for finer control
      if (key.upArrow) { autoScroll.current = false; setScrollOffset((o) => o + step); return; }
      if (key.downArrow) {
        setScrollOffset((o) => { const n = Math.max(0, o - step); if (n === 0) autoScroll.current = true; return n; });
        return;
      }
      if (key.pageUp) { autoScroll.current = false; setScrollOffset((o) => o + 5); return; }
      if (key.pageDown) {
        setScrollOffset((o) => { const n = Math.max(0, o - 5); if (n === 0) autoScroll.current = true; return n; });
        return;
      }
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  const allMessages = current?.messages ?? [];
  const totalMsgs = allMessages.length;
  const rows = process.stdout.rows ?? 24;
  // Reserve rows: tab bar(1) + info bar(1) + input area(2+inputLines) + divider(1) + suggestions
  const inputAreaRows = 2 + inputLines.length;
  const msgAreaRows = Math.max(6, rows - inputAreaRows - (suggestions.length ? Math.min(suggestions.length, 6) + 2 : 0) - 3);
  // Show more messages to allow better scrolling context (1 row per message is more realistic with wrapping)
  const MSGS_PER_SCREEN = Math.max(8, Math.floor(msgAreaRows / 1.2));
  const maxOffset = Math.max(0, totalMsgs - Math.max(1, Math.floor(msgAreaRows / 2.5)));
  const safeOffset = Math.min(scrollOffset, maxOffset);
  const endIdx = totalMsgs - safeOffset;
  const startIdx = Math.max(0, endIdx - MSGS_PER_SCREEN);
  const visibleMessages = allMessages.slice(startIdx, safeOffset > 0 ? endIdx : undefined);

  // Scrollbar
  const showScrollbar = totalMsgs > Math.floor(msgAreaRows / 2.5);
  const barH = msgAreaRows;
  const visibleCount = Math.max(1, Math.floor(msgAreaRows / 2.5));
  const thumbH = showScrollbar ? Math.max(1, Math.round((barH * visibleCount) / totalMsgs)) : barH;
  const thumbTop = (showScrollbar && maxOffset > 0)
    ? Math.round(((barH - thumbH) * (maxOffset - safeOffset)) / maxOffset) : 0;
  const scrollbarStr = Array.from({ length: barH }, (_, i) =>
    i >= thumbTop && i < thumbTop + thumbH ? "█" : "░"
  ).join("\n");

  // Scroll position indicator
  const scrollPct = totalMsgs > 0 ? Math.round((safeOffset / Math.max(1, maxOffset)) * 100) : 0;
  const msgStart = startIdx + 1;
  const msgEnd = endIdx;
  const scrollIndicator = `${msgStart}-${msgEnd}/${totalMsgs}${safeOffset > 0 ? ` (${scrollPct}%)` : ""}`;

  // Context window progress
  const ctxMax = CTX_WINDOW[current?.model ?? ""] ?? 128_000;
  const ctxUsed = current?.tokenUsage.inputTokens ?? 0;
  const ctxPct = Math.min(100, Math.round((ctxUsed / ctxMax) * 100));
  const ctxColor = ctxPct > 80 ? "red" : ctxPct > 60 ? "yellow" : "gray";

  const sessionNames = [...sessions.keys()];

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? 24}>

      {/* ── Session tab bar ── */}
      <Box paddingX={1} paddingY={0} borderStyle="single" borderBottom borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
        {sessionNames.map((name) => (
          <Box key={name} marginRight={1}>
            <Text color={name === currentName ? "cyan" : "gray"} bold={name === currentName}>
              {name === currentName ? "● " : "◯ "}{name}
            </Text>
          </Box>
        ))}
        <Box marginLeft={2}>
          <Text dimColor>  /new · /switch · /skill · /agent · /help</Text>
        </Box>
      </Box>

      {/* ── Info bar: provider/model · token usage · context window ── */}
      {current && (
        <Box paddingX={1} paddingY={0} borderStyle="single" borderTop borderBottom borderLeft={false} borderRight={false} borderColor="gray" justifyContent="space-between">
          <Box>
            <Text dimColor bold>{current.provider}</Text>
            <Text dimColor> / </Text>
            <Text dimColor>{current.model.replace("claude-", "").replace("gpt-4o", "gpt").replace(/-.*/g, "")}</Text>
            {current.systemPrompt && (
              <Box marginLeft={2}>
                <Text dimColor italic>📋 {current.systemPrompt.slice(0, 25)}…</Text>
              </Box>
            )}
          </Box>
          <Box>
            {current.tokenUsage.inputTokens > 0 && (
              <Box marginRight={2}>
                <Text dimColor>📊 {fmtTokens(current.tokenUsage.inputTokens + current.tokenUsage.outputTokens)} tok</Text>
                <Text dimColor> · </Text>
                <Text dimColor>{fmtCost(current.tokenUsage.totalCost)}</Text>
              </Box>
            )}
            <Text color={ctxColor} bold>{ctxPct > 80 ? "🔴" : ctxPct > 60 ? "🟡" : "🟢"} ctx {ctxPct}%</Text>
          </Box>
        </Box>
      )}

      {/* ── Messages + scrollbar ── */}
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
          {/* Scroll position indicator at top */}
          {totalMsgs > 10 && (
            <Box marginY={0} paddingX={1}>
              <Text dimColor>{scrollIndicator}  Use ↑↓ · PgUp/Dn · Home/End to scroll</Text>
            </Box>
          )}
          {/* Messages above indicator */}
          {safeOffset > 0 && startIdx > 0 && (
            <Box marginY={0} paddingX={1}>
              <Text color="yellow" dimColor>  ↑ {startIdx} message{startIdx !== 1 ? "s" : ""} above — scroll up to see</Text>
            </Box>
          )}
          {visibleMessages.map((msg, msgIdx, allVisible) => {
            if (msg.role === "system") {
              return (
                <Box key={msgIdx} flexDirection="column" marginY={0} paddingX={0}>
                  <Box borderStyle="single" borderLeft borderRight={false} borderTop={false} borderBottom={false} borderColor="cyan" paddingX={1} paddingY={0}>
                    <Text color="cyan" dimColor bold>ℹ {msg.content}</Text>
                  </Box>
                </Box>
              );
            }
            if (msg.role === "user") {
              return (
                <Box key={msgIdx} flexDirection="column" marginY={1} paddingX={0} width="100%">
                  {/* User message header */}
                  <Box marginBottom={0} paddingX={1}>
                    <Text color="blue" bold>💬 You</Text>
                    <Text dimColor>{` [${startIdx + msgIdx + 1}/${totalMsgs}]`}</Text>
                  </Box>
                  {/* User message content */}
                  <Box paddingX={2} paddingY={0} width="100%">
                    <Text wrap="wrap" dimColor>{msg.content}</Text>
                  </Box>
                  {/* Divider */}
                  {msgIdx < allVisible.length - 1 && (
                    <Box marginTop={0} paddingX={1}>
                      <Text color="gray" dimColor>─</Text>
                    </Box>
                  )}
                </Box>
              );
            }
            const displayContent = msg.streaming ? msg.content.slice(-2000) : msg.content;
            return (
              <Box key={msgIdx} flexDirection="column" marginY={1} paddingX={0} width="100%">
                {/* Assistant message header */}
                <Box marginBottom={0} paddingX={1}>
                  <Text color="green" bold>🤖 {(current?.name ?? "Assistant").padEnd(12)}</Text>
                  <Text dimColor>{` [${startIdx + msgIdx + 1}/${totalMsgs}]`}</Text>
                  {msg.streaming && <Text color="yellow" bold>{" ✨ streaming"}</Text>}
                </Box>
                {/* Assistant message content */}
                <Box paddingX={2} paddingY={0} width="100%">
                  <Box flexGrow={1} flexDirection="column">
                    <MessageContent content={displayContent} streaming={msg.streaming} />
                  </Box>
                </Box>
                {/* Divider */}
                {msgIdx < allVisible.length - 1 && (
                  <Box marginTop={0} paddingX={1}>
                    <Text color="gray" dimColor>─</Text>
                  </Box>
                )}
              </Box>
            );
          })}
          {/* Messages below indicator */}
          {endIdx < totalMsgs && (
            <Box marginY={0} paddingX={1}>
              <Text color="yellow" dimColor>  ↓ {totalMsgs - endIdx} message{totalMsgs - endIdx !== 1 ? "s" : ""} below — scroll down to see</Text>
            </Box>
          )}
        </Box>
        {showScrollbar && (
          <Box width={1} flexDirection="column">
            <Text dimColor={true}>{scrollbarStr}</Text>
          </Box>
        )}
      </Box>

      {/* ── Slash command suggestions ── */}
      {suggestions.length > 0 && (
        <Box flexDirection="column" paddingX={2} paddingY={1} borderStyle="round" borderColor="gray" marginX={1} marginY={0}>
          <Text bold dimColor>Available commands:</Text>
          {suggestions.slice(0, 6).map((s, i) => (
            <Box key={s.name} marginY={0}>
              <Text color={i === suggestionIdx ? CAT_COLOR[s.category] : "gray"} bold={i === suggestionIdx}>
                {i === suggestionIdx ? "▶ " : "  "}
                <Text color={CAT_COLOR[s.category]}>{"/" + s.name.padEnd(12)}</Text>
              </Text>
              <Text dimColor>{s.description}</Text>
            </Box>
          ))}
          <Box marginTop={0}>
            <Text dimColor>  ↑↓ navigate · Tab complete · Esc dismiss</Text>
          </Box>
        </Box>
      )}

      {/* ── Divider ── */}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" />

      {/* ── Multiline buffer display ── */}
      {inputLines.length > 0 && (
        <Box flexDirection="column" paddingX={1} marginY={0} paddingY={0}>
          {inputLines.map((line, i) => (
            <Box key={i} paddingX={1} marginY={0} paddingY={0}>
              <Text color="cyan" bold>{i === 0 ? "✎ " : "  "}</Text>
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Input ── */}
      <Box paddingX={1} paddingY={0}>
        {isStreaming ? (
          <Box flexDirection="row">
            <Text color="yellow" bold>⏳ </Text>
            <Text dimColor>streaming… (Esc to abort)</Text>
          </Box>
        ) : (
          <Box>
            <Text color="cyan" bold>{inputLines.length > 0 ? "  " : "❯ "}</Text>
            <TextInput
              value={input}
              onChange={handleInputChange}
              onSubmit={submit}
              placeholder={inputLines.length > 0 ? "…continue (Enter to send, Alt+Enter for more lines)" : "Message or /command…"}
            />
          </Box>
        )}
      </Box>

    </Box>
  );
}
