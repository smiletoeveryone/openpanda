import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type ProviderName = "anthropic" | "openai" | "ollama" | "telegram";

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  chatId?: string;
  enabled: boolean;
}

export interface AppConfig {
  providers: Partial<Record<ProviderName, ProviderConfig>>;
  defaultProvider: ProviderName;
  defaultModel: string;
}

const CONFIG_DIR = join(homedir(), ".openpanda");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULTS: AppConfig = {
  providers: {},
  defaultProvider: "anthropic",
  defaultModel: "claude-sonnet-4-6",
};

export function loadConfig(): AppConfig {
  // env vars always take precedence
  const fromEnv = configFromEnv();

  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULTS, ...fromEnv };
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as AppConfig;
    return mergeWithEnv(raw, fromEnv);
  } catch {
    return { ...DEFAULTS, ...fromEnv };
  }
}

export function saveConfig(config: AppConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  try { chmodSync(CONFIG_DIR, 0o700); } catch { /* non-POSIX */ }
  try { chmodSync(CONFIG_FILE, 0o600); } catch { /* non-POSIX */ }
}

export function configPath(): string {
  return CONFIG_FILE;
}

function configFromEnv(): Partial<AppConfig> {
  const providers: Partial<Record<ProviderName, ProviderConfig>> = {};

  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY, enabled: true };
  }
  if (process.env.OPENAI_API_KEY) {
    providers.openai = { apiKey: process.env.OPENAI_API_KEY, enabled: true };
  }
  if (process.env.OLLAMA_BASE_URL) {
    providers.ollama = { baseUrl: process.env.OLLAMA_BASE_URL, enabled: true };
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    providers.telegram = { apiKey: process.env.TELEGRAM_BOT_TOKEN, enabled: true };
  }

  return Object.keys(providers).length ? { providers } : {};
}

function mergeWithEnv(saved: AppConfig, fromEnv: Partial<AppConfig>): AppConfig {
  if (!fromEnv.providers) return saved;
  return {
    ...saved,
    providers: { ...saved.providers, ...fromEnv.providers },
  };
}

export function enabledProviders(config: AppConfig): ProviderName[] {
  return (Object.entries(config.providers) as [ProviderName, ProviderConfig][])
    .filter(([, v]) => v.enabled && (v.apiKey || v.baseUrl))
    .map(([k]) => k);
}
