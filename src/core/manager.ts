import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { Agent } from "./agent.js";
import { buildProvider, type LLMProvider } from "./providers.js";
import { getMcpClient } from "../mcp/client.js";
import { enabledProviders, type AppConfig, type ProviderName } from "../config/store.js";
import type { AgentConfig, AgentEvent, AgentState } from "./types.js";
import { getProviderCircuitBreaker, CircuitOpenError, type CircuitBreaker } from "../infra/circuitBreaker.js";
import type { Checkpointer } from "../infra/checkpointer.js";
import type { Logger } from "../infra/logger.js";
import { createLogger } from "../infra/logger.js";

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function wrapWithCircuitBreaker(provider: LLMProvider, cb: CircuitBreaker): LLMProvider {
  return {
    chat: (...args) => cb.execute(() => provider.chat(...args)),
    stream: (...args) => cb.execute(() => provider.stream(...args)),
    streamWithTools: (...args) => cb.execute(() => provider.streamWithTools(...args)),
  };
}

export class OpenClaw extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private appConfig: AppConfig;
  private checkpointer?: Checkpointer;
  private log: Logger;
  readonly config: { maxConcurrentAgents: number; defaultProvider: ProviderName; defaultModel: string };

  constructor(
    appConfig: AppConfig,
    maxConcurrentAgents = 5,
    options?: { checkpointer?: Checkpointer; logger?: Logger }
  ) {
    super();
    this.appConfig = appConfig;
    this.checkpointer = options?.checkpointer;
    this.log = options?.logger ?? createLogger("manager");
    this.config = {
      maxConcurrentAgents,
      defaultProvider: appConfig.defaultProvider,
      defaultModel: appConfig.defaultModel,
    };
  }

  async spawn(
    options: Partial<Omit<AgentConfig, "id">> & { name: string }
  ): Promise<Agent> {
    const runningCount = [...this.agents.values()].filter(
      (a) => a.status === "running"
    ).length;

    if (runningCount >= this.config.maxConcurrentAgents) {
      throw new Error(`Max concurrent agents (${this.config.maxConcurrentAgents}) reached`);
    }

    const primaryProvider = options.provider ?? this.config.defaultProvider;

    // Build a fallback chain: try the requested provider first, then any other
    // enabled LLM provider (telegram excluded). Skip providers whose circuit is open.
    const enabled = enabledProviders(this.appConfig).filter((p) => p !== "telegram");
    const chain = dedupe([primaryProvider as ProviderName, ...enabled]);

    let llm: LLMProvider | undefined;
    let resolvedProvider = primaryProvider;

    for (const p of chain) {
      const cb = getProviderCircuitBreaker(p);
      if (cb.state === "open") {
        this.log.warn("Circuit breaker open, skipping provider", { provider: p });
        continue;
      }
      try {
        const raw = await buildProvider(p, this.appConfig);
        llm = wrapWithCircuitBreaker(raw, cb);
        resolvedProvider = p;
        break;
      } catch (err) {
        this.log.warn("Failed to build provider, trying next", {
          provider: p,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!llm) {
      throw new Error(`All providers unavailable (tried: ${chain.join(", ")})`);
    }

    if (resolvedProvider !== primaryProvider) {
      this.log.info("Fell back to alternate provider", {
        requested: primaryProvider,
        resolved: resolvedProvider,
      });
    }

    const mcp = await getMcpClient();

    const agentConfig: AgentConfig = {
      id: uuidv4(),
      name: options.name,
      provider: resolvedProvider as ProviderName,
      model: options.model ?? this.config.defaultModel,
      systemPrompt: options.systemPrompt,
      tools: options.tools,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    };

    const agent = new Agent(agentConfig, llm, mcp, this.checkpointer);
    agent.on("event", (event: AgentEvent) => this.emit("event", event));
    this.agents.set(agentConfig.id, agent);
    this.emit("agent:spawned", agentConfig.id);
    this.log.debug("Agent spawned", { agentId: agentConfig.id, name: options.name, provider: resolvedProvider });
    return agent;
  }

  get(id: string): Agent | undefined { return this.agents.get(id); }
  list(): AgentState[] { return [...this.agents.values()].map((a) => a.state); }

  stop(id: string): void { this.agents.get(id)?.stop(); }

  remove(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    agent.stop();
    this.agents.delete(id);
    this.emit("agent:removed", id);
    return true;
  }

  stopAll(): void { for (const a of this.agents.values()) a.stop(); }

  runningCount(): number {
    return [...this.agents.values()].filter((a) => a.status === "running").length;
  }
}
