import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ProviderName } from "../config/store.js";

export interface AgentPreset {
  name: string;
  description: string;
  provider?: ProviderName;
  model?: string;
  maxTokens?: number;
  systemPrompt: string;
}

// Resolve agents directory with multiple fallback strategies.
const AGENTS_DIR = (() => {
  // Strategy 1: relative to this file's directory via import.meta.url
  const fromMetaUrl = fileURLToPath(new URL("../../agents", import.meta.url));
  if (existsSync(fromMetaUrl)) return fromMetaUrl;

  // Strategy 2: from current working directory (used when npm run ui/chat)
  const fromCwd = join(process.cwd(), "agents");
  if (existsSync(fromCwd)) return fromCwd;

  // Strategy 3: check if we're in a build output; go to project root
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const fromProjectRoot = join(currentDir, "..", "..", "..", "agents");
  if (existsSync(fromProjectRoot)) return fromProjectRoot;

  // Default (will return empty if directory doesn't exist)
  return fromMetaUrl;
})();

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw.trim() };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of raw.slice(3, end).trim().split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { meta, body: raw.slice(end + 4).trim() };
}

export function loadAgents(): Record<string, AgentPreset> {
  if (!existsSync(AGENTS_DIR)) return {};
  const presets: Record<string, AgentPreset> = {};
  try {
    for (const file of readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"))) {
      const { meta, body } = parseFrontmatter(
        readFileSync(join(AGENTS_DIR, file), "utf-8")
      );
      const name = meta.name ?? file.replace(/\.md$/, "");
      presets[name] = {
        name,
        description: meta.description ?? "",
        systemPrompt: body,
        ...(meta.provider ? { provider: meta.provider as ProviderName } : {}),
        ...(meta.model ? { model: meta.model } : {}),
        ...(meta.maxTokens ? { maxTokens: Number(meta.maxTokens) } : {}),
      };
    }
  } catch (err) {
    console.error("[agentLoader] Error loading agents:", err);
  }
  return presets;
}

export const AGENT_PRESETS = loadAgents();
