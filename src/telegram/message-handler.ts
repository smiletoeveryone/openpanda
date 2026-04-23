/**
 * Telegram message handler
 * Routes messages to agents, handles commands, manages streaming
 */

import { z } from "zod";
import type { TelegramMessage } from "./types.js";
import { TelegramClient } from "./client.js";
import { TelegramSessionManager } from "./session-manager.js";
import type { ProviderName } from "../config/store.js";
import type { UserRateLimiter } from "../infra/rateLimit.js";
import type { Logger } from "../infra/logger.js";
import { createLogger, newTraceId } from "../infra/logger.js";
import { loadSkills } from "../ui/skillLoader.js";
import { loadAgents } from "../ui/agentLoader.js";
import { mdToTelegramHtml, findSplitPoint } from "./format.js";

// Load skill and agent preset registries once at startup
const SKILLS = loadSkills();
const AGENT_PRESETS = loadAgents();

interface StreamBuffer {
  text: string;        // full accumulated raw text — never cleared mid-stream
  flushedLen: number;  // length of text at the time of the last flush
  lastHtml: string;    // last HTML sent — skip edit when content hasn't changed
  messageId?: number;
  timer?: NodeJS.Timeout;
}

const CHUNK_BUFFER_SIZE = 2000;   // Flush early so we have room to split before hitting Telegram's 4096 limit
const CHUNK_FLUSH_INTERVAL = 3000; // ms — 3s between edits; kinder to Telegram rate limits on slow models
const MIN_FLUSH_CHARS = 80;        // Don't flush tiny increments (avoids spam on Pi / local LLMs)

/** Input validation: non-empty string, max 4000 chars, trimmed. */
const InputSchema = z.string().min(1).max(4000).transform((s) => s.trim());

export class TelegramMessageHandler {
  private client: TelegramClient;
  private sessionManager: TelegramSessionManager;
  private streamBuffers: Map<number, StreamBuffer> = new Map();
  private rateLimiter?: UserRateLimiter;
  private log: Logger;

  constructor(
    client: TelegramClient,
    sessionManager: TelegramSessionManager,
    options?: { rateLimiter?: UserRateLimiter; logger?: Logger }
  ) {
    this.client = client;
    this.sessionManager = sessionManager;
    this.rateLimiter = options?.rateLimiter;
    this.log = options?.logger ?? createLogger("message-handler");
  }

  /**
   * Handle incoming Telegram message
   */
  async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const traceId = newTraceId();
    const log = this.log.child({ traceId, chatId, username: message.from?.username });

    // Validate input
    const parsed = InputSchema.safeParse(message.text ?? "");
    if (!parsed.success) {
      await this.client.sendMessage(chatId, "❌ Invalid message (empty or too long, max 4000 chars).");
      return;
    }
    const text = parsed.data;

    // Rate limit check
    if (this.rateLimiter) {
      const rl = this.rateLimiter.check(chatId);
      if (!rl.allowed) {
        const retrySecs = Math.ceil(rl.retryAfterMs / 1000);
        await this.client.sendMessage(chatId, `⏳ Rate limited. Try again in ${retrySecs}s.`);
        return;
      }
    }

    const isCommand = text.startsWith("/");
    log.info("handling message", { len: text.length, isCommand });

    // Handle slash commands
    if (isCommand) {
      await this.handleCommand(chatId, text, message.from?.username);
      return;
    }

    // Handle regular messages - get or create session
    const session = await this.sessionManager.getOrCreateSession(
      chatId,
      message.from?.username
    );

    if (!session.agent) {
      await this.client.sendMessage(chatId, "❌ Failed to create agent session");
      return;
    }

    // Avoid overlapping messages
    if (this.sessionManager.isStreaming(chatId)) {
      await this.client.sendMessage(chatId, "⏳ Still processing previous message...");
      return;
    }

    // Stream response with buffering
    await this.streamResponse(chatId, message, session.agent, text);

    // Persist session after successful exchange
    await this.sessionManager.persistSession(session);
  }

  /**
   * Handle slash commands
   */
  private async handleCommand(
    chatId: number,
    text: string,
    username?: string
  ): Promise<void> {
    const parts = text.slice(1).split(" ");
    const command = parts[0]?.toLowerCase() ?? "";
    const args = parts.slice(1).join(" ").trim();

    const session = await this.sessionManager.getOrCreateSession(chatId, username);

    try {
      switch (command) {
        case "help":
        case "h":
          await this.handleHelp(chatId);
          break;

        case "skill":
        case "sk":
          await this.handleSkill(chatId, session, args);
          break;

        case "skills":
          await this.handleListSkills(chatId);
          break;

        case "agent":
        case "ag":
          await this.handleAgent(chatId, session, args);
          break;

        case "agents":
          await this.handleListAgents(chatId);
          break;

        case "model":
        case "m":
          await this.handleModel(chatId, session, args);
          break;

        case "provider":
        case "p":
          await this.handleProvider(chatId, session, args);
          break;

        case "info":
          await this.handleInfo(chatId, session);
          break;

        case "clear":
          await this.handleClear(chatId, session);
          break;

        default:
          await this.client.sendMessage(
            chatId,
            `❓ Unknown command: /${command}\n\nType /help for available commands`
          );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.client.sendMessage(chatId, `❌ Error: ${message}`);
    }
  }

  /**
   * Stream agent response to Telegram with buffering
   */
  private async streamResponse(
    chatId: number,
    message: TelegramMessage,
    agent: any,
    userMessage: string
  ): Promise<void> {
    this.sessionManager.setStreaming(chatId, true);

    try {
      const buffer: StreamBuffer = {
        text: "",
        flushedLen: 0,
        lastHtml: "",
        messageId: undefined,
        timer: undefined,
      };

      this.streamBuffers.set(chatId, buffer);

      const onChunk = (delta: string) => {
        // Rate-limit retry notices come through onChunk but must not pollute the
        // Telegram message. Log them to stderr and discard from the buffer.
        if (delta.includes("⏳ Rate limited")) {
          process.stderr.write(`[rate-limit] ${delta.trim()}\n`);
          return;
        }

        buffer.text += delta;

        if (buffer.timer) clearTimeout(buffer.timer);

        // Force-flush when accumulated text is approaching Telegram's limit
        if (buffer.text.length >= CHUNK_BUFFER_SIZE) {
          this.flushStreamBuffer(chatId, buffer).catch(console.error);
        } else {
          // Only schedule a timed flush if there's enough new content to be worth
          // an API call — avoids spamming Telegram on slow local models (Pi / llamacpp)
          const newChars = buffer.text.length - buffer.flushedLen;
          if (newChars >= MIN_FLUSH_CHARS || !buffer.messageId) {
            buffer.timer = setTimeout(() => {
              this.flushStreamBuffer(chatId, buffer).catch(console.error);
            }, CHUNK_FLUSH_INTERVAL);
          }
        }
      };

      const fullResponse = await agent.stream(userMessage, { onChunk });

      // Cancel any pending debounce timer
      if (buffer.timer) clearTimeout(buffer.timer);

      // Final flush — send whatever hasn't been flushed yet
      if (buffer.text.length > buffer.flushedLen) {
        await this.flushStreamBuffer(chatId, buffer);
      }

      // If nothing was ever sent (e.g. empty response), send the fallback
      if (!buffer.messageId) {
        const fallback = fullResponse ? mdToTelegramHtml(fullResponse) : "✓ Done";
        const result = await this.client.sendMessage(chatId, fallback);
        buffer.messageId = result.message_id;
      }
    } catch (error) {
      // Cancel any pending debounce timer so it can't fire after the error
      // and send stale chunks (e.g. rate-limit retry messages) as phantom messages.
      const buf = this.streamBuffers.get(chatId);
      if (buf?.timer) clearTimeout(buf.timer);
      const message = error instanceof Error ? error.message : String(error);
      await this.client.sendMessage(chatId, `❌ Error: ${message}`);
    } finally {
      this.streamBuffers.delete(chatId);
      this.sessionManager.setStreaming(chatId, false);
    }
  }

  /**
   * Flush accumulated stream buffer to Telegram.
   * Converts raw markdown to Telegram HTML and edits the live message so the
   * user sees the response grow in place. When the HTML would exceed Telegram's
   * 4096-char limit, the current message is sealed and a new message is started
   * for the remainder. buffer.text is reset on split so buffer.flushedLen always
   * refers to the current (unsealed) segment.
   *
   * Resilience: identical HTML is skipped before hitting the API (avoids
   * Telegram's "message is not modified" 400). Network errors on sendMessage
   * are retried once; errors on editMessageText are absorbed by the client.
   */
  private async flushStreamBuffer(
    chatId: number,
    buffer: StreamBuffer
  ): Promise<void> {
    if (buffer.text.length === buffer.flushedLen) return; // nothing new

    const MAX_HTML = 3800; // well below Telegram's 4096 limit
    const html = mdToTelegramHtml(buffer.text);

    // Skip when HTML is unchanged — avoids Telegram's "message is not modified" 400
    if (html === buffer.lastHtml) return;

    const sendWithRetry = async (text: string): Promise<{ message_id: number }> => {
      try {
        return await this.client.sendMessage(chatId, text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("fetch failed") || msg.includes("ECONNRESET")) {
          // One retry after a short pause on network blip
          await new Promise((r) => setTimeout(r, 2000));
          return this.client.sendMessage(chatId, text);
        }
        throw err;
      }
    };

    try {
      if (html.length > MAX_HTML) {
        // Estimate how many raw chars map to MAX_HTML rendered chars
        const ratio = buffer.text.length / Math.max(html.length, 1);
        const targetRaw = Math.floor(MAX_HTML * ratio);
        const splitAt = findSplitPoint(buffer.text, Math.min(targetRaw, buffer.text.length));

        const firstHtml = mdToTelegramHtml(buffer.text.slice(0, splitAt));

        if (buffer.messageId) {
          await this.client.editMessageText(chatId, buffer.messageId, firstHtml);
        } else {
          const result = await sendWithRetry(firstHtml);
          buffer.messageId = result.message_id;
        }
        buffer.lastHtml = firstHtml;

        // Seal the current message; start fresh for the remainder
        buffer.text = buffer.text.slice(splitAt);
        buffer.flushedLen = 0;
        buffer.lastHtml = "";
        buffer.messageId = undefined;

        if (buffer.text.length > 0) {
          await this.flushStreamBuffer(chatId, buffer);
        }
      } else {
        if (buffer.messageId) {
          await this.client.editMessageText(chatId, buffer.messageId, html);
        } else {
          const result = await sendWithRetry(html);
          buffer.messageId = result.message_id;
        }
        buffer.lastHtml = html;
        buffer.flushedLen = buffer.text.length;
      }
    } catch (error) {
      console.error("Failed to flush stream buffer:", error);
    }
  }

  // ── Command handlers ────────────────────────────────────────────────────────

  private async handleHelp(chatId: number): Promise<void> {
    const skillCount = Object.keys(SKILLS).length;
    const agentCount = Object.keys(AGENT_PRESETS).length;

    const help = `🐼 <b>OpenPanda Commands</b>

<b>Skills (${skillCount} available):</b>
/skill &lt;name&gt; — Apply a skill preset (system prompt)
/skills — List all available skills

<b>Agent presets (${agentCount} available):</b>
/agent &lt;name&gt; — Switch to an agent preset (provider + model + prompt)
/agents — List all available agent presets

<b>Session:</b>
/model &lt;name&gt; — Change LLM model
/provider &lt;name&gt; — Switch provider (anthropic, openai, ollama)
/info — Show current session info
/clear — Clear message history

/help — Show this message

<i>Tip: /skill coder, /skill summarizer, /agent reasoning</i>`;

    await this.client.sendMessage(chatId, help);
  }

  private async handleSkill(chatId: number, session: any, args: string): Promise<void> {
    const [skillName, ...rest] = args.split(" ");

    if (!skillName) {
      const names = Object.keys(SKILLS).sort().join(", ");
      await this.client.sendMessage(
        chatId,
        `Usage: /skill &lt;name&gt;\n\nAvailable: ${names}\n\nOr use /skills for details`
      );
      return;
    }

    const skill = SKILLS[skillName.toLowerCase()];
    if (!skill) {
      await this.client.sendMessage(
        chatId,
        `❓ Unknown skill: <b>${skillName}</b>\n\nUse /skills to see all available skills.`
      );
      return;
    }

    await this.client.sendMessage(chatId, `⏳ Applying skill <b>${skill.name}</b>...`);

    const provider = (skill.provider ?? session.provider) as ProviderName;
    const model = skill.suggestedModel ?? session.model;

    await this.sessionManager.respawnAgent(chatId, provider, model, skill.systemPrompt);

    const confirmation = `✅ <b>Skill applied: ${skill.name}</b>
<i>${skill.description}</i>

Provider: ${provider} · Model: ${model}
Message history preserved.${rest.length > 0 ? "\n\n<i>Sending your message now...</i>" : ""}`;

    await this.client.sendMessage(chatId, confirmation);

    // If trailing args provided, send them as the first message with the new skill
    if (rest.length > 0) {
      const followUp = rest.join(" ").trim();
      const updatedSession = await this.sessionManager.getOrCreateSession(chatId);
      if (updatedSession.agent) {
        await this.streamResponse(chatId, { message_id: 0, date: 0, chat: { id: chatId, type: "private" }, text: followUp }, updatedSession.agent, followUp);
        await this.sessionManager.persistSession(updatedSession);
      }
    }
  }

  private async handleListSkills(chatId: number): Promise<void> {
    const byCategory: Record<string, string[]> = {};

    for (const skill of Object.values(SKILLS)) {
      const cat = skill.category ?? "other";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(`  /skill ${skill.name} — ${skill.description}`);
    }

    const lines = ["🎯 <b>Available Skills</b>\n"];
    for (const [cat, entries] of Object.entries(byCategory).sort()) {
      lines.push(`<b>${cat.charAt(0).toUpperCase() + cat.slice(1)}</b>`);
      lines.push(...entries);
      lines.push("");
    }

    await this.client.sendMessage(chatId, lines.join("\n").trim());
  }

  private async handleAgent(chatId: number, session: any, args: string): Promise<void> {
    const [presetName, ...rest] = args.split(" ");

    if (!presetName) {
      const names = Object.keys(AGENT_PRESETS).sort().join(", ");
      await this.client.sendMessage(
        chatId,
        `Usage: /agent &lt;name&gt;\n\nAvailable: ${names}\n\nOr use /agents for details`
      );
      return;
    }

    const preset = AGENT_PRESETS[presetName.toLowerCase()];
    if (!preset) {
      await this.client.sendMessage(
        chatId,
        `❓ Unknown agent preset: <b>${presetName}</b>\n\nUse /agents to see all available presets.`
      );
      return;
    }

    await this.client.sendMessage(chatId, `⏳ Switching to agent <b>${preset.name}</b>...`);

    const provider = (preset.provider ?? session.provider) as ProviderName;
    const model = preset.model ?? session.model;

    await this.sessionManager.respawnAgent(chatId, provider, model, preset.systemPrompt);

    const confirmation = `✅ <b>Agent preset applied: ${preset.name}</b>
<i>${preset.description}</i>

Provider: ${provider} · Model: ${model}${preset.maxTokens ? ` · Max tokens: ${preset.maxTokens}` : ""}
Message history preserved.${rest.length > 0 ? "\n\n<i>Sending your message now...</i>" : ""}`;

    await this.client.sendMessage(chatId, confirmation);

    if (rest.length > 0) {
      const followUp = rest.join(" ").trim();
      const updatedSession = await this.sessionManager.getOrCreateSession(chatId);
      if (updatedSession.agent) {
        await this.streamResponse(chatId, { message_id: 0, date: 0, chat: { id: chatId, type: "private" }, text: followUp }, updatedSession.agent, followUp);
        await this.sessionManager.persistSession(updatedSession);
      }
    }
  }

  private async handleListAgents(chatId: number): Promise<void> {
    const lines = ["🤖 <b>Available Agent Presets</b>\n"];

    for (const preset of Object.values(AGENT_PRESETS).sort((a, b) => a.name.localeCompare(b.name))) {
      const meta = [preset.provider, preset.model].filter(Boolean).join(" · ");
      lines.push(`<b>/agent ${preset.name}</b> — ${preset.description}`);
      if (meta) lines.push(`  <i>${meta}</i>`);
      lines.push("");
    }

    await this.client.sendMessage(chatId, lines.join("\n").trim());
  }

  private async handleModel(chatId: number, session: any, modelName: string): Promise<void> {
    if (!modelName) {
      await this.client.sendMessage(chatId, `Usage: /model &lt;name&gt;\nCurrent: ${session.model}`);
      return;
    }
    await this.sessionManager.respawnAgent(chatId, session.provider, modelName, session.systemPrompt);
    await this.client.sendMessage(chatId, `✓ Model changed to: <b>${modelName}</b>\nMessage history preserved.`);
  }

  private async handleProvider(chatId: number, session: any, providerName: string): Promise<void> {
    if (!providerName) {
      await this.client.sendMessage(chatId, `Usage: /provider &lt;name&gt;\nCurrent: ${session.provider}`);
      return;
    }

    const validProviders: ProviderName[] = ["anthropic", "openai", "ollama", "llamacpp"];
    if (!validProviders.includes(providerName as ProviderName)) {
      await this.client.sendMessage(
        chatId,
        `Invalid provider. Valid options: ${validProviders.join(", ")}`
      );
      return;
    }

    await this.sessionManager.respawnAgent(chatId, providerName as ProviderName, session.model, session.systemPrompt);
    await this.client.sendMessage(chatId, `✓ Provider changed to: <b>${providerName}</b>\nMessage history preserved.`);
  }

  private async handleInfo(chatId: number, session: any): Promise<void> {
    const messageCount = session.agent?.state.messages.length ?? 0;
    const skillNames = Object.keys(SKILLS).length;
    const agentNames = Object.keys(AGENT_PRESETS).length;

    const info = `ℹ️ <b>Session Info</b>

<b>Provider:</b> ${session.provider}
<b>Model:</b> ${session.model}
<b>System prompt:</b> ${session.systemPrompt ? "custom" : "default"}
<b>Messages:</b> ${messageCount}
<b>Session:</b> ${session.sessionName}

<b>Available:</b> ${skillNames} skills · ${agentNames} agent presets`;

    await this.client.sendMessage(chatId, info);
  }

  private async handleClear(chatId: number, session: any): Promise<void> {
    this.sessionManager.clearSession(chatId);
    this.rateLimiter?.reset(chatId);
    await this.client.sendMessage(chatId, "🧹 Message history cleared");
  }
}
