/**
 * Structured JSON logger with trace ID support and secret masking.
 * Output goes to process.stderr (stdout is reserved for user-facing CLI/TUI output).
 * Controlled by LOG_LEVEL env var: debug | info | warn | error (default: info).
 */

import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  /** Return a new logger with extra fields bound to every log line. */
  child(extra: Record<string, unknown>): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
const MIN_ORDER = LEVEL_ORDER[MIN_LEVEL] ?? 1;

const SECRET_KEYS = new Set([
  "apikey", "api_key", "key", "token", "password", "secret",
  "authorization", "auth", "credential",
]);

/** Strip secret values from a plain object before logging. */
function maskContext(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? "***" : v;
  }
  return out;
}

/** Strip secret patterns from a freeform string. */
export function maskSecrets(text: string): string {
  return text
    .replace(/"apiKey"\s*:\s*"[^"]+"/g, '"apiKey": "***"')
    .replace(/\bBearer\s+[A-Za-z0-9\-_.]+/g, "Bearer ***")
    .replace(/\bsk-[A-Za-z0-9]{8,}/g, "sk-***");
}

/** Generate a short random trace ID for correlating log lines. */
export function newTraceId(): string {
  return randomUUID();
}

function write(level: LogLevel, component: string, msg: string, ctx: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < MIN_ORDER) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    msg: maskSecrets(msg),
    ...maskContext(ctx),
  });
  process.stderr.write(line + "\n");
}

export function createLogger(component: string, baseCtx: Record<string, unknown> = {}): Logger {
  return {
    debug: (msg, ctx = {}) => write("debug", component, msg, { ...baseCtx, ...ctx }),
    info:  (msg, ctx = {}) => write("info",  component, msg, { ...baseCtx, ...ctx }),
    warn:  (msg, ctx = {}) => write("warn",  component, msg, { ...baseCtx, ...ctx }),
    error: (msg, ctx = {}) => write("error", component, msg, { ...baseCtx, ...ctx }),
    child: (extra) => createLogger(component, { ...baseCtx, ...extra }),
  };
}
