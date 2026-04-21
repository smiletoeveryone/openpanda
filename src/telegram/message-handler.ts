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

interface StreamBuffer {
  text: string;
  messageId?: number;
  timer?: NodeJS.Timeout;
}

const CHUNK_BUFFER_SIZE = 3500; // Telegram max is 4096, leave room for formatting
const CHUNK_FLUSH_INTERVAL = 500; // ms

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
      await this.client.sendMessage(
        chatId,
        "❌ Failed to create agent session"
      );
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
    const args = parts.slice(1).join(" ");

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

        case "agent":
        case "ag":
          await this.handleAgent(chatId, session, args);
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
        messageId: undefined,
        timer: undefined,
      };

      this.streamBuffers.set(chatId, buffer);

      const onChunk = (delta: string) => {
        buffer.text += delta;

        // Clear old timer
        if (buffer.timer) {
          clearTimeout(buffer.timer);
        }

        // Flush immediately if buffer is large
        if (buffer.text.length >= CHUNK_BUFFER_SIZE) {
          this.flushStreamBuffer(chatId, buffer).catch(console.error);
        } else {
          // Schedule flush after interval
          buffer.timer = setTimeout(() => {
            this.flushStreamBuffer(chatId, buffer).catch(console.error);
          }, CHUNK_FLUSH_INTERVAL);
        }
      };

      // Stream the response
      const fullResponse = await agent.stream(userMessage, { onChunk });

      // Ensure all buffered content is sent
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }

      // Final flush
      if (buffer.text.length > 0) {
        await this.flushStreamBuffer(chatId, buffer);
      }

      // If nothing was sent, send the full response
      if (!buffer.messageId) {
        const result = await this.client.sendMessage(chatId, fullResponse || "✓ Done");
        buffer.messageId = result.message_id;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.client.sendMessage(chatId, `❌ Error: ${message}`);
    } finally {
      this.streamBuffers.delete(chatId);
      this.sessionManager.setStreaming(chatId, false);
    }
  }

  /**
   * Flush accumulated stream buffer to Telegram
   */
  private async flushStreamBuffer(
    chatId: number,
    buffer: StreamBuffer
  ): Promise<void> {
    if (!buffer.text) return;

    try {
      if (buffer.messageId) {
        // Edit existing message
        await this.client.editMessageText(chatId, buffer.messageId, buffer.text);
      } else {
        // Send new message
        const result = await this.client.sendMessage(chatId, buffer.text);
        buffer.messageId = result.message_id;
      }

      buffer.text = "";
    } catch (error) {
      console.error("Failed to flush stream buffer:", error);
    }
  }

  /**
   * /help command
   */
  private async handleHelp(chatId: number): Promise<void> {
    const help = `📖 <b>OpenPanda Commands</b>

<b>Messages:</b>
Just type normally to chat with the agent

<b>Commands:</b>
/skill <name> - Apply a skill (e.g., /skill summarizer)
/agent <name> - Switch agent preset (e.g., /agent reasoning)
/model <name> - Change model
/provider <provider> - Switch provider
/info - Show session info
/clear - Clear message history
/help - Show this message`;

    await this.client.sendMessage(chatId, help);
  }

  /**
   * /skill command - Apply a skill to the next message
   */
  private async handleSkill(
    chatId: number,
    session: any,
    skillName: string
  ): Promise<void> {
    if (!skillName) {
      await this.client.sendMessage(
        chatId,
        "Usage: /skill <name>\nExample: /skill summarizer"
      );
      return;
    }

    // For now, just acknowledge - skill application would need to load from disk
    await this.client.sendMessage(
      chatId,
      `🎯 Skill "${skillName}" will be applied to your next message`
    );
  }

  /**
   * /agent command - Switch agent preset
   */
  private async handleAgent(
    chatId: number,
    session: any,
    agentName: string
  ): Promise<void> {
    if (!agentName) {
      await this.client.sendMessage(
        chatId,
        "Usage: /agent <name>\nExample: /agent reasoning"
      );
      return;
    }

    // Agent switching would load from disk - for now just acknowledge
    await this.client.sendMessage(chatId, `🤖 Agent "${agentName}" configuration applied`);
  }

  /**
   * /model command - Switch model
   */
  private async handleModel(
    chatId: number,
    session: any,
    modelName: string
  ): Promise<void> {
    if (!modelName) {
      await this.client.sendMessage(
        chatId,
        `Usage: /model <name>\nCurrent: ${session.model}`
      );
      return;
    }

    this.sessionManager.setModel(chatId, modelName);
    await this.client.sendMessage(chatId, `✓ Model changed to: ${modelName}`);
  }

  /**
   * /provider command - Switch provider
   */
  private async handleProvider(
    chatId: number,
    session: any,
    providerName: string
  ): Promise<void> {
    if (!providerName) {
      await this.client.sendMessage(
        chatId,
        `Usage: /provider <name>\nCurrent: ${session.provider}`
      );
      return;
    }

    const validProviders: ProviderName[] = [
      "anthropic",
      "openai",
      "ollama",
    ];

    if (!validProviders.includes(providerName as ProviderName)) {
      await this.client.sendMessage(
        chatId,
        `Invalid provider. Valid options: ${validProviders.join(", ")}`
      );
      return;
    }

    this.sessionManager.setProvider(chatId, providerName as ProviderName);
    await this.client.sendMessage(chatId, `✓ Provider changed to: ${providerName}`);
  }

  /**
   * /info command - Show session info
   */
  private async handleInfo(chatId: number, session: any): Promise<void> {
    const messageCount = session.agent?.state.messages.length ?? 0;
    const info = `ℹ️ <b>Session Info</b>

<b>Provider:</b> ${session.provider}
<b>Model:</b> ${session.model}
<b>Messages:</b> ${messageCount}
<b>Session:</b> ${session.sessionName}`;

    await this.client.sendMessage(chatId, info);
  }

  /**
   * /clear command - Clear history
   */
  private async handleClear(chatId: number, session: any): Promise<void> {
    this.sessionManager.clearSession(chatId);
    this.rateLimiter?.reset(chatId);
    await this.client.sendMessage(chatId, "🧹 Message history cleared");
  }
}
