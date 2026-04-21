/**
 * Telegram Bot API types and interfaces
 * Subset of Telegram API covering what OpenPanda needs
 */

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  edit_date?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

export interface TelegramSendMessageResult {
  ok: boolean;
  result?: TelegramMessage;
  error_code?: number;
  description?: string;
}

export interface TelegramEditMessageResult {
  ok: boolean;
  result?: TelegramMessage;
  error_code?: number;
  description?: string;
}

export interface TelegramGetUpdatesResult {
  ok: boolean;
  result?: TelegramUpdate[];
  error_code?: number;
  description?: string;
}

export interface TelegramGetMeResult {
  ok: boolean;
  result?: TelegramUser;
  error_code?: number;
  description?: string;
}
