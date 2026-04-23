#!/usr/bin/env node
// Suppress Node.js deprecation warnings from third-party packages (e.g. jsdom → punycode).
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name === "DeprecationWarning") return; // swallow
  process.stderr.write(`[warn] ${w.message}\n`);
});
import "dotenv/config";
import { Command } from "commander";
import { join } from "node:path";
import { homedir } from "node:os";
import { ensureConfigured, runSetup } from "../config/setup.js";
import { OpenClaw } from "../core/manager.js";
import type { ProviderName } from "../config/store.js";
import { printWelcome } from "./welcome.js";
import { TelegramClient } from "../telegram/client.js";
import { TelegramSessionManager } from "../telegram/session-manager.js";
import { TelegramMessageHandler } from "../telegram/message-handler.js";
import { createLogger, newTraceId } from "../infra/logger.js";
import { FileCheckpointer } from "../infra/checkpointer.js";
import { FileTaskQueue } from "../infra/taskQueue.js";
import { UserRateLimiter } from "../infra/rateLimit.js";
import { startLlamaServer, findLlamaServerBinary } from "../llamacpp/server.js";

// Manager is created after config/setup resolves — held in closure
let _manager: OpenClaw | undefined;
function getManager(): OpenClaw {
  if (!_manager) throw new Error("Manager not initialised");
  return _manager;
}

const program = new Command()
  .name("openpanda")
  .description("OpenPanda — lightweight agent manager powered by Entropy AI Lab.")
  .version("0.1.0");

// Setup command — reconfigure providers at any time (no banner, no key check)
program.addCommand(
  new Command("setup")
    .description("Configure AI provider API keys")
    .action(async () => {
      await runSetup(true);
    })
);

// All other commands: print banner then ensure at least one provider is ready
program.hook("preAction", async (thisCmd) => {
  if (thisCmd.name() === "setup") return;
  printWelcome();
  const config = await ensureConfigured();
  _manager = new OpenClaw(config);
});

// ── Commands ──────────────────────────────────────────────────────────────────

program.addCommand(
  new Command("spawn")
    .description("Spawn a new agent and send it a prompt")
    .requiredOption("-n, --name <name>", "Agent name")
    .option("-m, --model <model>", "Model to use")
    .option("-p, --provider <provider>", "Provider: anthropic | openai | ollama")
    .option("-s, --system <prompt>", "System prompt")
    .argument("<prompt>", "Initial user prompt")
    .action(async (prompt: string, opts) => {
      const { default: chalk } = await import("chalk");
      try {
        const agent = await getManager().spawn({
          name: opts.name,
          model: opts.model,
          provider: opts.provider as ProviderName | undefined,
          systemPrompt: opts.system,
        });
        console.log(chalk.cyan(`Spawned: ${agent.name} [${agent.id}]`));
        const result = await agent.run(prompt);
        console.log(chalk.green("\nResponse:"));
        console.log(result);
      } catch (err) {
        console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    })
);

program.addCommand(
  new Command("list")
    .alias("ls")
    .description("List all agents")
    .action(async () => {
      const { default: chalk } = await import("chalk");
      const agents = getManager().list();
      if (!agents.length) { console.log(chalk.gray("No agents.")); return; }
      for (const a of agents) {
        const colors: Record<string, (s: string) => string> = {
          idle: chalk.gray, running: chalk.yellow,
          completed: chalk.green, failed: chalk.red, stopped: chalk.magenta,
        };
        const c = colors[a.status] ?? chalk.white;
        const providerLabel = (a.config as { provider?: string }).provider ?? "?";
        console.log(
          `${chalk.bold(a.config.name)} ${chalk.dim(a.config.id)} — ${c(a.status)} — ${chalk.dim(providerLabel + "/" + a.config.model)}`
        );
      }
    })
);

program.addCommand(
  new Command("stop")
    .description("Stop a running agent by ID")
    .argument("<id>", "Agent ID")
    .action(async (id: string) => {
      const { default: chalk } = await import("chalk");
      const agent = getManager().get(id);
      if (!agent) { console.error(chalk.red(`Agent ${id} not found`)); process.exit(1); }
      getManager().stop(id);
      console.log(chalk.magenta(`Stopped: ${agent.name}`));
    })
);

program.addCommand(
  new Command("chat")
    .description("Start an interactive streaming chat session")
    .option("-n, --name <name>", "Agent name", "panda")
    .option("-p, --provider <provider>", "Provider: anthropic | openai | ollama")
    .option("-m, --model <model>", "Model to use")
    .option("-s, --system <prompt>", "System prompt")
    .action(async (opts) => {
      const { render } = await import("ink");
      const React = (await import("react")).default;
      const { ChatApp } = await import("../ui/components/ChatApp.js");
      render(React.createElement(ChatApp, {
        manager: getManager(),
        agentName: opts.name as string,
        provider: opts.provider as string | undefined,
        model: opts.model as string | undefined,
        systemPrompt: opts.system as string | undefined,
      }));
    })
);

program.addCommand(
  new Command("ui")
    .description("Launch the interactive terminal UI")
    .action(async () => {
      const { render } = await import("ink");
      const React = (await import("react")).default;
      const { App } = await import("../ui/components/App.js");
      render(React.createElement(App, { manager: getManager() }));
    })
);

program.addCommand(
  new Command("telegram")
    .description("Start Telegram bot polling loop")
    .action(async () => {
      const { default: chalk } = await import("chalk");

      // Ensure config is loaded
      const config = await ensureConfigured();

      // Check if Telegram is configured
      if (!config.providers.telegram?.apiKey || !config.providers.telegram?.enabled) {
        console.error(
          chalk.red(
            "❌ Telegram bot token not configured.\n" +
            "Run: npm run cli -- setup\n" +
            "Then select 'Telegram Bot (messaging)' option"
          )
        );
        process.exit(1);
      }

      // Validate token
      const client = new TelegramClient(config.providers.telegram.apiKey);
      const isValid = await client.validateToken();
      if (!isValid) {
        console.error(chalk.red("❌ Invalid Telegram bot token"));
        process.exit(1);
      }

      // ── Infra setup ──────────────────────────────────────────────────────────
      const openpandaDir = join(homedir(), ".openpanda");
      const log = createLogger("telegram-bot");
      const checkpointer = new FileCheckpointer(join(openpandaDir, "checkpoints"));
      const taskQueue = new FileTaskQueue(join(openpandaDir, "queue.json"));
      const rateLimiter = new UserRateLimiter({ windowMs: 60_000, maxRequests: 20 });

      // Initialize manager and handlers
      const manager = new OpenClaw(config, 5, { checkpointer, logger: log });
      const sessionManager = new TelegramSessionManager(manager);
      const handler = new TelegramMessageHandler(client, sessionManager, { rateLimiter, logger: log });

      console.log(chalk.cyan("🤖 Telegram bot started. Listening for messages...\n"));
      console.log(chalk.dim("Press Ctrl+C to stop\n"));

      // Get bot info for display — non-fatal if network hiccups here
      try {
        const meResult = await client.getMe();
        if (meResult.ok && meResult.result) {
          console.log(chalk.green(`✓ Bot: @${meResult.result.username || meResult.result.first_name}`));
          if (config.providers.telegram?.chatId) {
            console.log(chalk.green(`✓ Restricted to chat: ${config.providers.telegram.chatId}`));
          } else {
            console.log(chalk.yellow("⚠ Bot accepts messages from any user"));
          }
          console.log("");
        }
      } catch {
        console.log(chalk.yellow("⚠ Could not fetch bot info (network hiccup), continuing...\n"));
      }

      // ── Drain leftover tasks from previous crash ─────────────────────────────
      const leftover = taskQueue.list();
      if (leftover.length > 0) {
        log.info("Draining leftover tasks from previous run", { count: leftover.length });
        console.log(chalk.yellow(`⚠ Draining ${leftover.length} task(s) from previous run...`));
        for (const task of leftover) {
          try {
            const session = await sessionManager.getOrCreateSession(task.chatId, task.username);
            if (session.agent) {
              await handler.handleMessage({
                message_id: 0,
                date: 0,
                chat: { id: task.chatId, type: "private" },
                text: task.text,
              });
            }
          } catch (err) {
            log.error("Failed to drain task", { taskId: task.id, error: err instanceof Error ? err.message : String(err) });
          }
          taskQueue.remove(task.id);
        }
      }

      // ── Polling loop ─────────────────────────────────────────────────────────
      let offset = 0;
      let pollErrors = 0;
      const maxPollErrors = 5;

      const poll = async () => {
        try {
          const updates = await client.getUpdates(offset, 30);
          pollErrors = 0;

          for (const update of updates) {
            // Always advance the offset so non-message updates (edited_message,
            // callback_query, etc.) don't get re-fetched on the next poll.
            offset = update.update_id + 1;

            if (update.message) {
              // Check chat ID restriction if configured
              if (
                config.providers.telegram?.chatId &&
                update.message.chat.id !== Number(config.providers.telegram?.chatId)
              ) {
                log.debug("Rejecting message from unauthorized chat", { chatId: update.message.chat.id });
                continue;
              }

              const traceId = newTraceId();
              log.info("Received message", {
                traceId,
                chatId: update.message.chat.id,
                username: update.message.from?.username,
                preview: update.message.text?.substring(0, 40),
              });

              // Enqueue for durability before processing
              const task = taskQueue.enqueue({
                chatId: update.message.chat.id,
                username: update.message.from?.username,
                text: update.message.text ?? "",
                traceId,
              });

              try {
                await handler.handleMessage(update.message);
                taskQueue.remove(task.id);
              } catch (err) {
                log.error("Error handling message", {
                  traceId,
                  taskId: task.id,
                  error: err instanceof Error ? err.message : String(err),
                });
                taskQueue.remove(task.id);
              }
            }
          }
        } catch (err) {
          pollErrors++;
          log.error("Poll error", { attempt: pollErrors, max: maxPollErrors, error: err instanceof Error ? err.message : String(err) });
          console.error(
            chalk.red(
              `Poll error (${pollErrors}/${maxPollErrors}): ${err instanceof Error ? err.message : err}`
            )
          );

          if (pollErrors >= maxPollErrors) {
            log.error("Max poll errors reached, exiting");
            console.error(chalk.red("Max poll errors reached, exiting"));
            process.exit(1);
          }

          // Backoff before retrying
          await new Promise((r) => setTimeout(r, 5000));
        }
      };

      // Long polling loop
      while (true) {
        await poll();
      }
    })
);

program.addCommand(
  new Command("llamacpp")
    .description("Start a llama.cpp server (Llama 4 / any GGUF model) with an OpenAI-compatible API")
    .option("--model <path>", "Path to .gguf model file (overrides config)")
    .option("--port <port>", "Server port (default: 8080)")
    .option("--gpu-layers <n>", "GPU layers to offload (0 = CPU only, -1 = all)")
    .option("--ctx-size <n>", "Context window size in tokens (default: 4096)")
    .option("--server-path <path>", "Path to llama-server binary (auto-detected if omitted)")
    .action(async (opts) => {
      const { default: chalk } = await import("chalk");

      const config = await ensureConfigured();

      // Merge CLI flags over stored config
      const serverCfg = {
        ...config.llamacpp,
        ...(opts.model       && { modelPath:    opts.model }),
        ...(opts.port        && { port:         parseInt(opts.port, 10) }),
        ...(opts.gpuLayers   && { nGpuLayers:   parseInt(opts.gpuLayers, 10) }),
        ...(opts.ctxSize     && { ctxSize:       parseInt(opts.ctxSize, 10) }),
        ...(opts.serverPath  && { serverPath:    opts.serverPath }),
      };

      // Resolve model from env if still not set
      if (!serverCfg.modelPath && process.env.LLAMACPP_MODEL) {
        serverCfg.modelPath = process.env.LLAMACPP_MODEL;
      }

      if (!serverCfg.modelPath) {
        console.error(
          chalk.red("\n❌ No model path set.\n") +
          chalk.dim("  Run: openpanda setup\n") +
          chalk.dim("  Or:  LLAMACPP_MODEL=/path/to/model.gguf openpanda llamacpp\n")
        );
        process.exit(1);
      }

      // Show binary status
      const binary = findLlamaServerBinary(serverCfg.serverPath);
      if (!binary) {
        console.error(
          chalk.red("\n❌ llama-server binary not found.\n") +
          chalk.dim("  Install llama.cpp: https://github.com/ggerganov/llama.cpp\n") +
          chalk.dim("  Then ensure `llama-server` is on your PATH.\n")
        );
        process.exit(1);
      }

      const host = serverCfg.host ?? "127.0.0.1";
      const port = serverCfg.port ?? 8080;
      const endpoint = `http://${host}:${port}`;

      console.log(chalk.bold.cyan("\n🦙 OpenPanda — llama.cpp Server\n"));
      console.log(chalk.dim(`  Model:    ${serverCfg.modelPath}`));
      console.log(chalk.dim(`  Binary:   ${binary}`));
      console.log(chalk.dim(`  Endpoint: ${endpoint}/v1  (OpenAI-compatible)\n`));
      console.log(chalk.dim("  Starting llama-server…\n"));

      const server = startLlamaServer(serverCfg);

      // Graceful shutdown on Ctrl+C / SIGTERM
      const shutdown = () => {
        console.log(chalk.dim("\n  Stopping llama-server…"));
        server.stop();
        process.exit(0);
      };
      process.on("SIGINT",  shutdown);
      process.on("SIGTERM", shutdown);

      try {
        await server.waitForReady(60_000);
      } catch (err) {
        console.error(chalk.red(`\n❌ ${err instanceof Error ? err.message : err}\n`));
        server.stop();
        process.exit(1);
      }

      console.log(chalk.green(`\n✓ llama-server is ready!\n`));
      console.log(chalk.bold("  OpenAI-compatible endpoints:"));
      console.log(chalk.cyan(`  ${endpoint}/v1/chat/completions`));
      console.log(chalk.cyan(`  ${endpoint}/v1/models`));
      console.log(chalk.cyan(`  ${endpoint}/v1/completions`));
      console.log(chalk.dim("\n  Connect any OpenAI client to this URL:"));
      console.log(chalk.dim(`    base_url="${endpoint}/v1"  api_key="local"\n`));
      console.log(chalk.dim("  Use in OpenPanda:"));
      console.log(chalk.dim("    openpanda chat -p llamacpp -m local\n"));
      console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

      // Keep the process alive — llama-server runs as a child process
      await new Promise<void>(() => { /* wait for SIGINT/SIGTERM */ });
    })
);

program.parse(process.argv);
