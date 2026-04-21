import { select, password, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import {
  loadConfig,
  saveConfig,
  configPath,
  enabledProviders,
  type AppConfig,
  type ProviderName,
} from "./store.js";

const PROVIDER_META: Record<
  ProviderName,
  { label: string; keyLabel: string; models: string[]; needsKey: boolean }
> = {
  anthropic: {
    label: "Anthropic (Claude)",
    keyLabel: "ANTHROPIC_API_KEY",
    models: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"],
    needsKey: true,
  },
  openai: {
    label: "OpenAI (GPT)",
    keyLabel: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    needsKey: true,
  },
  ollama: {
    label: "Ollama (local)",
    keyLabel: "",
    models: ["llama3", "mistral", "phi3"],
    needsKey: false,
  },
  telegram: {
    label: "Telegram Bot",
    keyLabel: "TELEGRAM_BOT_TOKEN",
    models: ["telegram"],
    needsKey: true,
  },
};

/** Step-by-step Telegram bot setup with instructions */
async function setupTelegram(config: AppConfig): Promise<void> {
  const existing = config.providers.telegram?.apiKey;

  console.log(chalk.dim("\n  📱 How to get your Telegram Bot Token:\n"));
  console.log(chalk.dim("  Step 1: Open Telegram and search for: BotFather"));
  console.log(chalk.dim("  Step 2: Start a chat with @BotFather"));
  console.log(chalk.dim("  Step 3: Send the command: /newbot"));
  console.log(chalk.dim("  Step 4: Enter a name for your bot (e.g., 'MyOpenPandaBot')"));
  console.log(chalk.dim("  Step 5: Enter a username (must be unique, e.g., 'my_openpanda_bot')"));
  console.log(chalk.dim("  Step 6: BotFather will give you a token like:"));
  console.log(chalk.dim("           123456:ABCdefGHIjklmnoPQRstuvWXYZ"));
  console.log(chalk.dim("  Step 7: Copy that token and paste it below\n"));

  const openBotFather = await confirm({
    message: "  Ready? (Open https://t.me/BotFather in your browser first)",
    default: true,
  });

  if (openBotFather) {
    console.log(chalk.dim("  → Visit: https://t.me/BotFather\n"));
  }

  const token = await password({
    message: `  Telegram Bot Token${existing ? ` (current: ${existing.slice(0, 15)}…)` : ""}:`,
    mask: "•",
  });

  if (token || existing) {
    config.providers.telegram = {
      apiKey: token || existing,
      enabled: true,
    };

    console.log(chalk.green("\n  ✓ Telegram bot token saved\n"));

    // Optional: Get chat ID to restrict bot to specific chats
    const restrictChat = await confirm({
      message: "  Want to restrict this bot to specific chat(s)? (optional)",
      default: false,
    });

    if (restrictChat) {
      console.log(chalk.dim("\n  📌 To find your chat ID:\n"));
      console.log(chalk.dim("  1. Send any message to your bot on Telegram"));
      console.log(chalk.dim("  2. Visit this URL in your browser:"));
      console.log(chalk.dim("     https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"));
      console.log(chalk.dim("  3. Replace <YOUR_TOKEN> with your bot token from above"));
      console.log(chalk.dim("  4. Look for 'chat': { 'id': <YOUR_CHAT_ID> }"));
      console.log(chalk.dim("  5. Copy your chat ID (can be negative, like -123456789)\n"));

      const chatIdStr = await input({
        message: "  Chat ID (or press Enter to skip):",
      });

      if (chatIdStr.trim()) {
        config.providers.telegram = {
          ...config.providers.telegram!,
          chatId: chatIdStr.trim(),
        };
        console.log(chalk.green("  ✓ Chat ID saved - bot will only respond in that chat\n"));
      } else {
        console.log(chalk.dim("  ℹ Bot will respond to all users\n"));
      }
    }
  }
}

export async function runSetup(force = false): Promise<AppConfig> {
  const config = loadConfig();
  const active = enabledProviders(config);

  if (!force && active.length > 0) return config;

  console.log(chalk.bold.cyan("\n  ◆ OpenPanda — Provider Setup\n"));
  console.log(
    chalk.dim(
      `  Config will be saved to: ${chalk.white(configPath())}\n` +
        `  You can re-run setup anytime with: ${chalk.white("openpanda setup")}\n`
    )
  );

  const chosen = await select<ProviderName[]>({
    message: "Which AI providers do you want to configure?",
    choices: [
      { name: "Anthropic (Claude) only", value: ["anthropic"] },
      { name: "OpenAI (GPT) only", value: ["openai"] },
      { name: "Both Anthropic + OpenAI", value: ["anthropic", "openai"] },
      { name: "Ollama (local, no key needed)", value: ["ollama"] },
      { name: "Telegram Bot (messaging)", value: ["telegram"] },
      { name: "All AI providers (Anthropic + OpenAI + Ollama)", value: ["anthropic", "openai", "ollama"] },
      { name: "AI + Telegram", value: ["anthropic", "openai", "telegram"] },
    ],
  });

  for (const provider of chosen) {
    const meta = PROVIDER_META[provider];
    console.log(chalk.bold(`\n  ${meta.label}`));

    if (provider === "telegram") {
      // Special Telegram setup with step-by-step instructions
      await setupTelegram(config);
    } else if (meta.needsKey) {
      const existing = config.providers[provider]?.apiKey;
      const masked = existing ? `  (current: ${existing.slice(0, 8)}…)` : "";

      const key = await password({
        message: `  ${meta.keyLabel}${masked}:`,
        mask: "•",
      });

      if (key || existing) {
        config.providers[provider] = {
          apiKey: key || existing,
          enabled: true,
        };
      }
    } else {
      // Ollama: ask for base URL
      const defaultUrl = config.providers.ollama?.baseUrl ?? "http://localhost:11434";
      const url = await input({
        message: "  Ollama base URL:",
        default: defaultUrl,
      });
      config.providers.ollama = { baseUrl: url, enabled: true };
    }
  }

  // Default provider — telegram is a messaging interface, not an LLM provider
  const available = enabledProviders(config);
  const llmProviders = available.filter((p) => p !== "telegram");
  if (llmProviders.length > 1) {
    const defaultProvider = await select<ProviderName>({
      message: "\n  Default provider for new agents:",
      choices: llmProviders.map((p) => ({
        name: PROVIDER_META[p].label,
        value: p,
      })),
    });
    config.defaultProvider = defaultProvider;
  } else if (llmProviders.length === 1) {
    config.defaultProvider = llmProviders[0];
  }
  // If only Telegram was configured, keep defaultProvider as "anthropic" (the default)
  // so the user is prompted to add an LLM provider before agents will work.

  // Default model — only show choices for real LLM providers
  const llmDefault: ProviderName =
    config.defaultProvider !== "telegram" ? config.defaultProvider : "anthropic";
  const modelChoices = PROVIDER_META[llmDefault].models;
  const defaultModel = await select({
    message: "  Default model:",
    choices: modelChoices.map((m) => ({ name: m, value: m })),
  });
  config.defaultModel = defaultModel;

  saveConfig(config);

  console.log(
    chalk.green("\n  ✓ Config saved.") +
      chalk.dim(` Default: ${config.defaultProvider} / ${config.defaultModel}\n`)
  );

  return config;
}

/** Check if at least one provider is ready; run setup if not. */
export async function ensureConfigured(): Promise<AppConfig> {
  const config = loadConfig();
  const active = enabledProviders(config);

  if (active.length > 0) return config;

  console.log(
    chalk.yellow("\n  No API keys configured yet.") +
      chalk.dim(" Let's set up a provider.\n")
  );

  return runSetup(true);
}
