import { EventEmitter } from "events";
import type { LLMProvider, UsageInfo } from "./providers.js";
import type { MCPClient } from "../mcp/client.js";
import type {
  AgentConfig,
  AgentEvent,
  AgentMessage,
  AgentState,
  AgentStatus,
} from "./types.js";
import type { Checkpointer } from "../infra/checkpointer.js";

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onToolStart?: (name: string, input: unknown) => void;
  onToolEnd?: (name: string, result: string) => void;
  onUsage?: (usage: UsageInfo) => void;
}

export class Agent extends EventEmitter {
  readonly state: AgentState;
  private _messages: AgentMessage[] = [];
  private provider: LLMProvider;
  private mcp?: MCPClient;
  private abortController?: AbortController;
  private checkpointer?: Checkpointer;

  constructor(config: AgentConfig, provider: LLMProvider, mcp?: MCPClient, checkpointer?: Checkpointer) {
    super();
    this.provider = provider;
    this.mcp = mcp;
    this.checkpointer = checkpointer;
    this.state = {
      config,
      status: "idle",
      messages: this._messages,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  get id() { return this.state.config.id; }
  get name() { return this.state.config.name; }
  get status() { return this.state.status; }

  /** Load message history (e.g. from persisted session). Replaces current history. */
  loadHistory(messages: AgentMessage[]): void {
    this._messages.length = 0;
    for (const m of messages) this._messages.push(m);
  }

  private setStatus(status: AgentStatus) {
    this.state.status = status;
    this.state.updatedAt = new Date();
    this.emit("event", {
      type: "status_change",
      agentId: this.id,
      timestamp: new Date(),
      data: { status },
    } satisfies AgentEvent);
  }

  private pushMessage(msg: AgentMessage) {
    this._messages.push(msg);
    this.emit("event", {
      type: "message",
      agentId: this.id,
      timestamp: new Date(),
      data: msg,
    } satisfies AgentEvent);
  }

  async run(userMessage: string): Promise<string> {
    if (this.state.status === "running") throw new Error(`Agent ${this.id} is already running`);
    this.setStatus("running");
    this.abortController = new AbortController();
    this.pushMessage({ role: "user", content: userMessage });
    try {
      const content = await this.provider.chat(
        this._messages,
        this.state.config.systemPrompt,
        this.state.config.model,
        this.state.config.maxTokens ?? 4096,
        this.abortController.signal
      );
      this.pushMessage({ role: "assistant", content });
      this.setStatus("idle");
      return content;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      this.setStatus("failed");
      throw err;
    }
  }

  // Agentic streaming loop — handles tool calls via MCP until the model
  // returns a final text response with no pending tool calls.
  async stream(userMessage: string, callbacks: StreamCallbacks | ((d: string) => void)): Promise<string> {
    if (this.state.status === "running") throw new Error(`Agent ${this.id} is already running`);

    // Backwards-compat: accept bare onChunk function
    const cbs: StreamCallbacks =
      typeof callbacks === "function" ? { onChunk: callbacks } : callbacks;

    this.setStatus("running");
    this.abortController = new AbortController();
    this.pushMessage({ role: "user", content: userMessage });

    const tools = this.mcp?.tools() ?? [];

    try {
      let finalText = "";
      let iterations = 0;
      const MAX_ITERATIONS = 10;

      while (iterations++ < MAX_ITERATIONS) {
        // Each LLM call gets its own 5-minute deadline. This must be long enough
        // to survive: slow Pi inference + Anthropic rate-limit retries (up to
        // 5+10+20+40s back-off) + large tool-response round-trips.
        // The user-facing abort (abortController.abort()) still works at any time.
        const iterSignal = AbortSignal.any([
          this.abortController.signal,
          AbortSignal.timeout(300_000),
        ]);
        const result = await this.provider.streamWithTools(
          this._messages,
          this.state.config.systemPrompt,
          this.state.config.model,
          this.state.config.maxTokens ?? 4096,
          iterSignal,
          tools,
          cbs.onChunk
        );
        const { text, toolCalls, rawBlocks } = result;

        if (toolCalls.length === 0) {
          // No tool calls — model is done
          finalText = text;
          this.pushMessage({ role: "assistant", content: text });
          if (result.usage) cbs.onUsage?.(result.usage);
          break;
        }

        // Store assistant message with the full raw content blocks so that
        // tool_result messages in subsequent turns can reference the tool_use ids.
        this.pushMessage({ role: "assistant", content: text || "", rawBlocks });

        // Execute each tool call via MCP and collect results
        const toolResults: AgentMessage["toolResults"] = [];
        for (const tc of toolCalls) {
          cbs.onToolStart?.(tc.name, tc.input);
          let toolResult: string;
          try {
            toolResult = await this.mcp!.call(tc.name, tc.input as Record<string, unknown>);
          } catch (err) {
            toolResult = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
          }
          cbs.onToolEnd?.(tc.name, toolResult);
          toolResults.push({ toolUseId: tc.id, content: toolResult });
        }

        // Push tool results as a user message so the model can continue
        this.pushMessage({ role: "user", content: "[tool results]", toolResults });

        // Checkpoint after each tool round-trip (non-fatal if it fails)
        try { this.checkpointer?.save(this.id, [...this._messages]); } catch { /* non-fatal */ }
      }

      this.setStatus("idle");
      return finalText;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      this.setStatus("failed");
      throw err;
    }
  }

  stop() {
    if (this.state.status === "running") {
      this.abortController?.abort();
      this.setStatus("stopped");
    }
  }

  reset() {
    this.stop();
    this._messages.length = 0;
    this.state.error = undefined;
    this.setStatus("idle");
  }
}
