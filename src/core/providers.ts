import type { AppConfig } from "../config/store.js";
import type { MCPToolDef } from "../mcp/client.js";
import type { AgentMessage } from "./types.js";

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
}

export interface StreamWithToolsResult {
  text: string;
  toolCalls: ToolCall[];
  // Raw Anthropic content blocks (text + tool_use) — must be stored in
  // message history so subsequent tool_result blocks can reference tool_use ids.
  rawBlocks: unknown[];
  usage?: UsageInfo;
}

export interface LLMProvider {
  chat(messages: AgentMessage[], system: string | undefined, model: string, maxTokens: number, signal: AbortSignal): Promise<string>;
  stream(messages: AgentMessage[], system: string | undefined, model: string, maxTokens: number, signal: AbortSignal, cb: StreamCallbacks): Promise<string>;
  streamWithTools(messages: AgentMessage[], system: string | undefined, model: string, maxTokens: number, signal: AbortSignal, tools: MCPToolDef[], onChunk: (d: string) => void): Promise<StreamWithToolsResult>;
}

// Convert AgentMessage[] to Anthropic message format.
// rawBlocks must be replayed verbatim for assistant turns that used tools,
// and toolResults must appear in a separate user turn so the API can match
// each tool_result to its tool_use id.
function toAnthropicMessages(messages: AgentMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.rawBlocks?.length) {
      // Assistant turn with tool_use — replay the full content block array
      out.push({ role: "assistant", content: m.rawBlocks });
    } else if (m.toolResults?.length) {
      // User turn carrying tool results
      out.push({
        role: "user",
        content: m.toolResults.map((r) => ({
          type: "tool_result",
          tool_use_id: r.toolUseId,
          content: r.content,
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/**
 * Retry an async operation when Anthropic responds with 429 (rate limit).
 * Waits with exponential backoff and notifies via onChunk if provided.
 */
async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
  onWait?: (waitSecs: number, attempt: number) => void,
  maxRetries = 4,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes("rate_limit") || msg.includes('"429"') || msg.includes("429");
      if (isRateLimit && attempt < maxRetries && !signal.aborted) {
        const waitMs = Math.min(5_000 * 2 ** attempt, 60_000);
        onWait?.(Math.round(waitMs / 1000), attempt + 1);
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, waitMs);
          signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Aborted")); }, { once: true });
        });
        continue;
      }
      throw err;
    }
  }
  throw new Error("Rate limit retries exhausted");
}

export async function buildProvider(providerName: string, config: AppConfig): Promise<LLMProvider> {
  const providerCfg = config.providers[providerName as keyof typeof config.providers];

  // ── Anthropic ──────────────────────────────────────────────────────────────
  if (providerName === "anthropic") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: providerCfg?.apiKey });

    return {
      async chat(messages, system, model, maxTokens, signal) {
        const res = await client.messages.create(
          { model, max_tokens: maxTokens, system, messages: toAnthropicMessages(messages) as never },
          { signal }
        );
        return res.content[0].type === "text" ? res.content[0].text : "";
      },

      async stream(messages, system, model, maxTokens, signal, { onChunk }) {
        let full = "";
        const s = await client.messages.stream(
          { model, max_tokens: maxTokens, system, messages: toAnthropicMessages(messages) as never },
          { signal }
        );
        for await (const chunk of s) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            full += chunk.delta.text;
            onChunk(chunk.delta.text);
          }
        }
        return full;
      },

      async streamWithTools(messages, system, model, maxTokens, signal, tools, onChunk) {
        const anthropicTools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        }));

        return withRateLimitRetry(async () => {
          const s = await client.messages.stream(
            {
              model,
              max_tokens: maxTokens,
              system,
              messages: toAnthropicMessages(messages) as never,
              tools: anthropicTools.length ? (anthropicTools as never) : undefined,
            },
            { signal }
          );

          let text = "";
          const toolCalls: ToolCall[] = [];
          const pendingTools = new Map<number, { id: string; name: string; inputJson: string }>();
          let inputTokens = 0;
          let outputTokens = 0;

          for await (const chunk of s) {
            if (chunk.type === "message_start") {
              inputTokens = (chunk as { message: { usage: { input_tokens: number } } }).message.usage.input_tokens;
            } else if (chunk.type === "message_delta") {
              const u = (chunk as { usage?: { output_tokens: number } }).usage;
              if (u) outputTokens = u.output_tokens;
            } else if (chunk.type === "content_block_start") {
              if (chunk.content_block.type === "tool_use") {
                pendingTools.set(chunk.index, {
                  id: chunk.content_block.id,
                  name: chunk.content_block.name,
                  inputJson: "",
                });
              }
            } else if (chunk.type === "content_block_delta") {
              if (chunk.delta.type === "text_delta") {
                text += chunk.delta.text;
                onChunk(chunk.delta.text);
              } else if (chunk.delta.type === "input_json_delta") {
                const pending = pendingTools.get(chunk.index);
                if (pending) pending.inputJson += chunk.delta.partial_json;
              }
            } else if (chunk.type === "content_block_stop") {
              const pending = pendingTools.get(chunk.index);
              if (pending) {
                toolCalls.push({
                  id: pending.id,
                  name: pending.name,
                  input: pending.inputJson ? JSON.parse(pending.inputJson) : {},
                });
                pendingTools.delete(chunk.index);
              }
            }
          }

          // Build raw content blocks to replay verbatim in message history
          const rawBlocks: unknown[] = [];
          if (text) rawBlocks.push({ type: "text", text });
          for (const tc of toolCalls) {
            rawBlocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
          }

          return { text, toolCalls, rawBlocks, usage: { inputTokens, outputTokens } };
        }, signal, (waitSecs, attempt) => {
          onChunk(`\n⏳ Rate limited — retrying in ${waitSecs}s (attempt ${attempt})...\n`);
        });
      },
    };
  }

  // ── OpenAI ─────────────────────────────────────────────────────────────────
  if (providerName === "openai") {
    const { OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: providerCfg?.apiKey });

    const toOAIMessages = (messages: AgentMessage[], system?: string) => [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    return {
      async chat(messages, system, model, maxTokens, signal) {
        const res = await client.chat.completions.create(
          { model, max_tokens: maxTokens, messages: toOAIMessages(messages, system) },
          { signal }
        );
        return res.choices[0]?.message?.content ?? "";
      },

      async stream(messages, system, model, maxTokens, signal, { onChunk }) {
        let full = "";
        const s = await client.chat.completions.create(
          { model, max_tokens: maxTokens, messages: toOAIMessages(messages, system), stream: true },
          { signal }
        );
        for await (const chunk of s) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) { full += delta; onChunk(delta); }
        }
        return full;
      },

      async streamWithTools(messages, system, model, maxTokens, signal, tools, onChunk) {
        const oaiTools = tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        }));

        let full = "";
        const toolCalls: ToolCall[] = [];

        const s = await client.chat.completions.create(
          {
            model,
            max_tokens: maxTokens,
            messages: toOAIMessages(messages, system),
            tools: oaiTools.length ? oaiTools : undefined,
            stream: true,
          },
          { signal }
        );

        const accumulator = new Map<number, { id: string; name: string; args: string }>();

        for await (const chunk of s) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) { full += delta.content; onChunk(delta.content); }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!accumulator.has(idx)) {
                accumulator.set(idx, { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" });
              }
              const acc = accumulator.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
            }
          }
        }

        for (const [, acc] of accumulator) {
          toolCalls.push({ id: acc.id, name: acc.name, input: acc.args ? JSON.parse(acc.args) : {} });
        }

        return { text: full, toolCalls, rawBlocks: [] };
      },
    };
  }

  // ── llama.cpp (OpenAI-compatible) ──────────────────────────────────────────
  if (providerName === "llamacpp") {
    const baseUrl = providerCfg?.baseUrl ?? "http://127.0.0.1:8080";
    const v1 = `${baseUrl}/v1`;

    /**
     * Remove JSON-Schema meta-fields that llama-server may reject
     * ($schema, additionalProperties) from tool parameter schemas.
     */
    function stripSchemaExtensions(schema: Record<string, unknown>): Record<string, unknown> {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { $schema, additionalProperties, ...rest } = schema;
      return rest;
    }

    /**
     * Rough token estimator: ~4 chars per token (good enough for trimming).
     * Avoids needing a real tokenizer.
     */
    function estimateTokens(text: string): number {
      return Math.ceil(text.length / 4);
    }

    /**
     * Trim message history so the total estimated token count (system + messages
     * + tool definitions + safety margin) stays under the context window.
     * Always keeps the most recent messages; trims from the oldest pairs first.
     */
    function trimToContext(
      messages: AgentMessage[],
      system: string | undefined,
      toolsJson: string,
      ctxSize: number
    ): AgentMessage[] {
      const SAFETY_MARGIN = 1024; // headroom for the model's reply
      const budget = ctxSize - SAFETY_MARGIN
        - estimateTokens(system ?? "")
        - estimateTokens(toolsJson);

      // Walk messages newest-first, accumulating until we exceed budget
      let used = 0;
      let keepFrom = messages.length;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        const tokens = estimateTokens(m.content ?? "") + estimateTokens(JSON.stringify(m.rawBlocks ?? [])) + estimateTokens(JSON.stringify(m.toolResults ?? []));
        if (used + tokens > budget) break;
        used += tokens;
        keepFrom = i;
      }
      return messages.slice(keepFrom);
    }

    /**
     * Convert AgentMessage[] to OpenAI-compatible message objects.
     * Handles tool-call history (rawBlocks stored as OAI tool_calls, and
     * toolResults as role:"tool" messages) so multi-turn tool use works.
     */
    const toMessages = (messages: AgentMessage[], system?: string): unknown[] => {
      const out: unknown[] = [];
      if (system) out.push({ role: "system", content: system });

      for (const m of messages) {
        if (m.rawBlocks && Array.isArray(m.rawBlocks) && m.rawBlocks.length > 0) {
          // Assistant turn that made tool calls — rawBlocks are stored as
          // { type:"llamacpp_tool_calls", tool_calls:[...] } by this provider
          const block = m.rawBlocks[0] as { type?: string; tool_calls?: unknown[] };
          if (block?.type === "llamacpp_tool_calls" && block.tool_calls) {
            out.push({ role: "assistant", content: m.content || null, tool_calls: block.tool_calls });
            continue;
          }
        }
        if (m.toolResults && m.toolResults.length > 0) {
          // Tool result turn — emit one role:"tool" message per result
          for (const r of m.toolResults) {
            out.push({ role: "tool", tool_call_id: r.toolUseId, content: r.content });
          }
          continue;
        }
        out.push({ role: m.role, content: m.content || "" });
      }
      return out;
    };

    /** Parse an OpenAI-compatible SSE stream, yielding each delta object. */
    async function* sseDeltas(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") return;
            try {
              type Delta = {
                content?: string;
                tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
              };
              const json = JSON.parse(payload) as { choices?: Array<{ delta?: Delta }> };
              const delta = json.choices?.[0]?.delta;
              if (delta) yield delta;
            } catch { /* skip malformed SSE frame */ }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    const CTX_SIZE = config.llamacpp?.ctxSize ?? 32768;

    return {
      async chat(messages, system, model, maxTokens, signal) {
        const trimmed = trimToContext(messages, system, "", CTX_SIZE);
        const body = JSON.stringify({ model, messages: toMessages(trimmed, system), max_tokens: maxTokens, stream: false });
        const res = await fetch(`${v1}/chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body, signal,
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          throw new Error(`llamacpp: HTTP ${res.status} — ${errBody}`);
        }
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        return data.choices?.[0]?.message?.content ?? "";
      },

      async stream(messages, system, model, maxTokens, signal, { onChunk }) {
        const trimmed = trimToContext(messages, system, "", CTX_SIZE);
        const body = JSON.stringify({ model, messages: toMessages(trimmed, system), max_tokens: maxTokens, stream: true });
        const res = await fetch(`${v1}/chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body, signal,
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          throw new Error(`llamacpp: HTTP ${res.status} — ${errBody}`);
        }
        let full = "";
        for await (const delta of sseDeltas(res.body!, signal)) {
          if (delta.content) { full += delta.content; onChunk(delta.content); }
        }
        return full;
      },

      async streamWithTools(messages, system, model, maxTokens, signal, tools, onChunk) {
        const oaiTools = tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: stripSchemaExtensions(t.input_schema),
          },
        }));

        const toolsJson = JSON.stringify(oaiTools);
        const trimmed = trimToContext(messages, system, toolsJson, CTX_SIZE);
        const payload = {
          model,
          messages: toMessages(trimmed, system),
          max_tokens: maxTokens,
          stream: true,
          tools: oaiTools.length ? oaiTools : undefined,
        };
        const body = JSON.stringify(payload);
        const res = await fetch(`${v1}/chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body, signal,
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          throw new Error(`llamacpp: HTTP ${res.status} — ${errBody}`);
        }

        let full = "";
        const toolCalls: ToolCall[] = [];
        const pending = new Map<number, { id: string; name: string; args: string }>();

        for await (const delta of sseDeltas(res.body!, signal)) {
          if (delta.content) { full += delta.content; onChunk(delta.content); }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!pending.has(tc.index)) pending.set(tc.index, { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" });
              const entry = pending.get(tc.index)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name = tc.function.name;
              if (tc.function?.arguments) entry.args += tc.function.arguments;
            }
          }
        }

        for (const [, entry] of pending) {
          toolCalls.push({ id: entry.id, name: entry.name, input: entry.args ? JSON.parse(entry.args) : {} });
        }

        // Store tool_calls in rawBlocks using a llamacpp-specific marker so
        // toMessages() can reconstruct the proper assistant turn on the next call.
        const rawBlocks: unknown[] = toolCalls.length ? [{
          type: "llamacpp_tool_calls",
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        }] : [];

        return { text: full, toolCalls, rawBlocks };
      },
    };
  }

  // ── Ollama ─────────────────────────────────────────────────────────────────
  if (providerName === "ollama") {
    const baseUrl = providerCfg?.baseUrl ?? "http://localhost:11434";

    const toOllamaMessages = (messages: AgentMessage[], system?: string) => [
      ...(system ? [{ role: "system", content: system }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    return {
      async chat(messages, system, model, _maxTokens, signal) {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: toOllamaMessages(messages, system), stream: false }),
          signal,
        });
        const data = await res.json() as { message?: { content?: string } };
        return data.message?.content ?? "";
      },

      async stream(messages, system, model, _maxTokens, signal, { onChunk }) {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: toOllamaMessages(messages, system), stream: true }),
          signal,
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
            const json = JSON.parse(line) as { message?: { content?: string } };
            const delta = json.message?.content ?? "";
            if (delta) { full += delta; onChunk(delta); }
          }
        }
        return full;
      },

      // Ollama tool use: pass through as plain stream (limited model support)
      async streamWithTools(messages, system, model, maxTokens, signal, _tools, onChunk) {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: toOllamaMessages(messages, system), stream: true }),
          signal,
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
            const json = JSON.parse(line) as { message?: { content?: string } };
            const delta = json.message?.content ?? "";
            if (delta) { full += delta; onChunk(delta); }
          }
        }
        return { text: full, toolCalls: [], rawBlocks: [] };
      },
    };
  }

  throw new Error(`Unknown provider: ${providerName}`);
}
