export type { Skill, SkillCategory } from "./skillLoader.js";
export { loadSkills } from "./skillLoader.js";
import { loadSkills } from "./skillLoader.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  category: "session" | "agent" | "skill" | "util";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── Session ───────────────────────────────────────────────────────────────
  {
    name: "new",
    description: "Create a new named session",
    usage: "/new <session-name> [provider] [model]",
    category: "session",
  },
  {
    name: "switch",
    aliases: ["sw"],
    description: "Switch to an existing session",
    usage: "/switch <session-name>",
    category: "session",
  },
  {
    name: "sessions",
    aliases: ["ls"],
    description: "List all open sessions",
    usage: "/sessions",
    category: "session",
  },
  {
    name: "close",
    description: "Close and remove the current session",
    usage: "/close",
    category: "session",
  },
  {
    name: "clear",
    description: "Clear current session message history",
    usage: "/clear",
    category: "session",
  },
  // ── Agent ─────────────────────────────────────────────────────────────────
  {
    name: "model",
    aliases: ["m"],
    description: "Switch the model for the current session",
    usage: "/model <model-name>",
    category: "agent",
  },
  {
    name: "provider",
    aliases: ["p"],
    description: "Switch provider (anthropic | openai | ollama)",
    usage: "/provider <name>",
    category: "agent",
  },
  {
    name: "system",
    aliases: ["sys"],
    description: "Show or set the system prompt for current session",
    usage: "/system [prompt]",
    category: "agent",
  },
  {
    name: "info",
    description: "Show current session info (provider, model, message count)",
    usage: "/info",
    category: "agent",
  },
  // ── Skills ────────────────────────────────────────────────────────────────
  {
    name: "skill",
    aliases: ["sk"],
    description: "Apply a skill preset (resets system prompt)",
    usage: "/skill <skill-name>",
    category: "skill",
  },
  {
    name: "skills",
    description: "List available skill presets",
    usage: "/skills",
    category: "skill",
  },
  {
    name: "agent",
    aliases: ["ag"],
    description: "Apply an agent preset (provider + model + system prompt)",
    usage: "/agent <preset-name>",
    category: "skill",
  },
  {
    name: "agents",
    description: "List available agent presets",
    usage: "/agents",
    category: "skill",
  },
  // ── Util ──────────────────────────────────────────────────────────────────
  {
    name: "help",
    aliases: ["h", "?"],
    description: "Show available slash commands",
    usage: "/help",
    category: "util",
  },
  {
    name: "export",
    description: "Export current session to a markdown file",
    usage: "/export [filename]",
    category: "util",
  },
  {
    name: "search",
    aliases: ["find"],
    description: "Search message history in current session",
    usage: "/search <query>",
    category: "util",
  },
];

// Loaded once at startup from skills/*.md
export const SKILLS = loadSkills();

// ── Helpers ───────────────────────────────────────────────────────────────────

export function matchCommand(input: string): SlashCommand | undefined {
  const token = input.slice(1).split(" ")[0].toLowerCase();
  return SLASH_COMMANDS.find(
    (c) => c.name === token || c.aliases?.includes(token)
  );
}

export function suggestCommands(partial: string): SlashCommand[] {
  const token = partial.slice(1).toLowerCase();
  if (!token) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) => c.name.startsWith(token) || c.aliases?.some((a) => a.startsWith(token))
  );
}

export function parseArgs(input: string): { cmd: string; args: string[] } {
  const parts = input.trim().slice(1).split(/\s+/);
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) };
}
