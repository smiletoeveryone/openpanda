import type { Agent } from "../../core/agent.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

export interface Session {
  name: string;
  agent: Agent;
  provider: string;
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  tokenUsage: TokenUsage;
}

