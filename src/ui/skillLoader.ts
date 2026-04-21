import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ProviderName } from "../config/store.js";

export type SkillCategory =
  | "engineering"
  | "writing"
  | "data"
  | "product"
  | "security"
  | "learning"
  | "ops"
  | "creative";

export interface Skill {
  name: string;
  category: SkillCategory;
  description: string;
  systemPrompt: string;
  suggestedModel?: string;
  provider?: ProviderName;
}

// Resolve skills directory with multiple fallback strategies.
const SKILLS_DIR = (() => {
  // Strategy 1: relative to this file's directory via import.meta.url
  const fromMetaUrl = fileURLToPath(new URL("../../skills", import.meta.url));
  if (existsSync(fromMetaUrl)) return fromMetaUrl;

  // Strategy 2: from current working directory (used when npm run ui/chat)
  const fromCwd = join(process.cwd(), "skills");
  if (existsSync(fromCwd)) return fromCwd;

  // Strategy 3: check if we're in a build output; go to project root
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const fromProjectRoot = join(currentDir, "..", "..", "..", "skills");
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

export function loadSkills(): Record<string, Skill> {
  if (!existsSync(SKILLS_DIR)) return {};
  const skills: Record<string, Skill> = {};
  try {
    for (const file of readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"))) {
      const { meta, body } = parseFrontmatter(
        readFileSync(join(SKILLS_DIR, file), "utf-8")
      );
      const name = meta.name ?? file.replace(/\.md$/, "");
      skills[name] = {
        name,
        category: (meta.category as SkillCategory) ?? "engineering",
        description: meta.description ?? "",
        systemPrompt: body,
        ...(meta.suggestedModel ? { suggestedModel: meta.suggestedModel } : {}),
        ...(meta.provider ? { provider: meta.provider as ProviderName } : {}),
      };
    }
  } catch (err) {
    console.error("[skillLoader] Error loading skills:", err);
  }
  return skills;
}

export const SKILLS = loadSkills();
