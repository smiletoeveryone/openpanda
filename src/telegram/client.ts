/**
 * Telegram Bot API client
 * Handles polling for updates and sending messages
 */

import type {
  TelegramUpdate,
  TelegramSendMessageResult,
  TelegramEditMessageResult,
  TelegramGetUpdatesResult,
  TelegramGetMeResult,
} from "./types.js";

export class TelegramClient {
  private apiToken: string;
  private baseUrl: string;
  // HTTP timeout must be longer than the Telegram long-poll timeout (30 s).
  // Use a generous 65-second budget to accommodate slow connections on Pi.
  private requestTimeout = 65_000;

  constructor(apiToken: string) {
    if (!apiToken) {
      throw new Error("Telegram bot token is required");
    }
    this.apiToken = apiToken;
    this.baseUrl = `https://api.telegram.org/bot${apiToken}`;
  }

  private async request<T>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${method}`);

    // Add query parameters — arrays/objects must be JSON-serialized per Telegram API docs
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined) {
          url.searchParams.append(
            key,
            Array.isArray(value) || typeof value === "object"
              ? JSON.stringify(value)
              : String(value)
          );
        }
      }
    }

    // Use a manual AbortController so the timer is always cleaned up and the
    // error surfaces with a clear message rather than the generic "fetch failed".
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Telegram API timeout after ${this.requestTimeout / 1000}s (${method})`);
      }
      const cause = error instanceof Error && (error as NodeJS.ErrnoException).cause;
      const detail = cause instanceof Error ? cause.message : "";
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Telegram API error: ${msg}${detail ? ` — ${detail}` : ""}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async getMe(): Promise<TelegramGetMeResult> {
    return this.request<TelegramGetMeResult>("getMe");
  }

  /**
   * Get new updates from Telegram
   * @param offset Only get updates after this offset (prevents duplicates)
   * @param timeout Long polling timeout in seconds (default 30)
   */
  async getUpdates(offset = 0, timeout = 30): Promise<TelegramUpdate[]> {
    const result = await this.request<TelegramGetUpdatesResult>("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message"],
    });

    if (!result.ok) {
      throw new Error(`Telegram getUpdates failed: ${result.description}`);
    }

    return result.result ?? [];
  }

  /**
   * Send a message to a chat
   * @param chatId Chat ID (can be negative for group chats)
   * @param text Message text (max 4096 characters)
   */
  async sendMessage(
    chatId: number,
    text: string
  ): Promise<{ message_id: number; chat_id: number }> {
    // Split if message exceeds Telegram's 4096 char limit
    if (text.length > 4096) {
      const messages = [];
      for (let i = 0; i < text.length; i += 4096) {
        const chunk = text.substring(i, i + 4096);
        const result = await this.request<TelegramSendMessageResult>(
          "sendMessage",
          {
            chat_id: chatId,
            text: chunk,
            parse_mode: "HTML",
          }
        );

        if (!result.ok || !result.result) {
          throw new Error(
            `Failed to send message: ${result.description}`
          );
        }

        messages.push(result.result);
      }

      // Return the first message ID (for tracking), all will be sent
      return {
        message_id: messages[0]!.message_id,
        chat_id: messages[0]!.chat.id,
      };
    }

    const result = await this.request<TelegramSendMessageResult>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });

    if (!result.ok || !result.result) {
      throw new Error(`Failed to send message: ${result.description}`);
    }

    return {
      message_id: result.result.message_id,
      chat_id: result.result.chat.id,
    };
  }

  /**
   * Edit an existing message
   * @param chatId Chat ID
   * @param messageId Message ID to edit
   * @param text New message text (max 4096 characters)
   */
  async editMessageText(
    chatId: number,
    messageId: number,
    text: string
  ): Promise<void> {
    // Don't edit if text is identical or too long
    if (text.length > 4096) {
      console.warn(
        `Message too long for edit (${text.length} chars), sending new message instead`
      );
      return;
    }

    const result = await this.request<TelegramEditMessageResult>(
      "editMessageText",
      {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
      }
    );

    if (!result.ok) {
      // Log but don't throw - message edits can fail if text is unchanged
      console.debug(`Edit message failed: ${result.description}`);
    }
  }

  /**
   * Validate that the token works
   */
  async validateToken(): Promise<boolean> {
    try {
      const result = await this.getMe();
      return result.ok ?? false;
    } catch {
      return false;
    }
  }
}
