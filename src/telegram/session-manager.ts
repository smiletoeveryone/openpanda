/**
 * Telegram Session Manager
 * Maps Telegram chat IDs to OpenPanda agents and sessions
 * Reuses agents across messages for the same chat
 */

import { loadSession, saveSession, deleteSession, type PersistedSession } from "../ui/sessionStore.js";
import type { OpenClaw } from "../core/manager.js";
import type { Agent } from "../core/agent.js";
import type { ProviderName } from "../config/store.js";

export interface TelegramSession {
  chatId: number;
  username?: string;
  sessionName: string; // e.g., "telegram_12345_username"
  agent?: Agent;
  provider: ProviderName;
  model: string;
  systemPrompt?: string;
  lastMessageId?: number; // For message editing during streaming
  streaming: boolean;
}

export class TelegramSessionManager {
  private sessions: Map<number, TelegramSession> = new Map();
  private manager: OpenClaw;

  constructor(manager: OpenClaw) {
    this.manager = manager;
  }

  /**
   * Get or create a session for a Telegram chat
   */
  async getOrCreateSession(
    chatId: number,
    username?: string
  ): Promise<TelegramSession> {
    // Return existing session if already created
    let session = this.sessions.get(chatId);
    if (session) {
      return session;
    }

    // Try to load from disk if was previously saved
    const sessionName = this.getSessionName(chatId, username);
    const savedSession = loadSession(sessionName);

    // "telegram" is a messaging interface, not an LLM provider — fall back to anthropic
    const provider: ProviderName =
      this.manager.config.defaultProvider !== "telegram"
        ? this.manager.config.defaultProvider
        : "anthropic";
    const model =
      this.manager.config.defaultModel !== "telegram"
        ? this.manager.config.defaultModel
        : "claude-sonnet-4-6";

    // Create new session
    session = {
      chatId,
      username,
      sessionName,
      provider,
      model,
      systemPrompt: undefined,
      streaming: false,
    };

    // Restore agent if we have a saved session
    if (savedSession) {
      try {
        const agent = await this.manager.spawn({
          name: sessionName,
          provider,
          model,
          systemPrompt: session.systemPrompt,
        });

        // Replay messages from saved session
        agent.loadHistory(
          (savedSession.messages ?? []).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );

        session.agent = agent;
      } catch (error) {
        console.error(
          `Failed to restore agent for session ${sessionName}:`,
          error
        );
        // Fall through to create a fresh agent
      }
    }

    // Create fresh agent if not restored
    if (!session.agent) {
      session.agent = await this.manager.spawn({
        name: sessionName,
        provider,
        model,
        systemPrompt: session.systemPrompt,
      });
    }

    this.sessions.set(chatId, session);
    return session;
  }

  /**
   * Get an existing session
   */
  getSession(chatId: number): TelegramSession | undefined {
    return this.sessions.get(chatId);
  }

  /**
   * Close and remove a session
   */
  deleteSession(chatId: number): void {
    const session = this.sessions.get(chatId);
    if (session?.agent) {
      this.manager.stop(session.agent.id);
      this.manager.remove(session.agent.id);
    }
    this.sessions.delete(chatId);
  }

  /**
   * Persist session to disk
   */
  async persistSession(session: TelegramSession): Promise<void> {
    if (!session.agent) return;

    const messages = session.agent.state.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const persisted: PersistedSession = {
      name: session.sessionName,
      provider: session.provider,
      model: session.model,
      systemPrompt: session.systemPrompt,
      messages,
      savedAt: new Date().toISOString(),
    };

    saveSession(persisted);
  }

  /**
   * Clear session history
   */
  clearSession(chatId: number): void {
    const session = this.sessions.get(chatId);
    if (session?.agent) {
      session.agent.reset();
      deleteSession(session.sessionName);
    }
  }

  /**
   * Set provider for a session
   */
  setProvider(
    chatId: number,
    provider: ProviderName
  ): void {
    const session = this.sessions.get(chatId);
    if (session) {
      session.provider = provider;
    }
  }

  /**
   * Set model for a session
   */
  setModel(chatId: number, model: string): void {
    const session = this.sessions.get(chatId);
    if (session) {
      session.model = model;
    }
  }

  /**
   * Set system prompt for a session
   */
  setSystemPrompt(chatId: number, systemPrompt: string | undefined): void {
    const session = this.sessions.get(chatId);
    if (session) {
      session.systemPrompt = systemPrompt;
    }
  }

  /**
   * Check if a session is currently streaming
   */
  isStreaming(chatId: number): boolean {
    return this.sessions.get(chatId)?.streaming ?? false;
  }

  /**
   * Set streaming state for a session
   */
  setStreaming(chatId: number, streaming: boolean): void {
    const session = this.sessions.get(chatId);
    if (session) {
      session.streaming = streaming;
    }
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): TelegramSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Generate session name from chat ID and username
   */
  private getSessionName(chatId: number, username?: string): string {
    const userPart = username ? `_${username}` : "_anon";
    return `telegram_${chatId}${userPart}`;
  }
}
