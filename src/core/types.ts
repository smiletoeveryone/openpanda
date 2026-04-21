import type { ProviderName } from "../config/store.js";

export type AgentStatus = "idle" | "running" | "completed" | "failed" | "stopped";

export interface AgentConfig {
  id: string;
  name: string;
  provider: ProviderName;
  model: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentEvent {
  type: "message" | "tool_call" | "tool_result" | "error" | "status_change";
  agentId: string;
  timestamp: Date;
  data: unknown;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  // Full Anthropic content blocks for assistant turns that used tools.
  // Must be replayed verbatim so tool_result blocks can reference tool_use ids.
  rawBlocks?: unknown[];
  // Tool results for user turns that follow a tool-using assistant turn.
  toolResults?: Array<{ toolUseId: string; content: string }>;
}

export interface AgentState {
  config: AgentConfig;
  status: AgentStatus;
  messages: ReadonlyArray<AgentMessage>;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

export interface ManagerConfig {
  maxConcurrentAgents: number;
  defaultProvider: ProviderName;
  defaultModel: string;
}
