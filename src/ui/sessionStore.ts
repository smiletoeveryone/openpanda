import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SESSIONS_DIR = join(homedir(), ".openpanda", "sessions");
const EXPORTS_DIR = join(homedir(), ".openpanda", "exports");

export interface PersistedMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface PersistedSession {
  name: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  messages: PersistedMessage[];
  tokenUsage?: { inputTokens: number; outputTokens: number; totalCost: number };
  savedAt: string;
}

function ensureSessionsDir() {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function saveSession(session: PersistedSession): void {
  ensureSessionsDir();
  writeFileSync(
    join(SESSIONS_DIR, `${session.name}.json`),
    JSON.stringify(session, null, 2),
    "utf-8"
  );
}

export function loadSession(name: string): PersistedSession | null {
  const path = join(SESSIONS_DIR, `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PersistedSession;
  } catch {
    return null;
  }
}

export function listSavedSessions(): string[] {
  ensureSessionsDir();
  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function deleteSession(name: string): void {
  const path = join(SESSIONS_DIR, `${name}.json`);
  if (existsSync(path)) unlinkSync(path);
}

export function exportSession(session: PersistedSession, filePath?: string): string {
  mkdirSync(EXPORTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = filePath ?? join(EXPORTS_DIR, `${session.name}-${timestamp}.md`);

  const lines: string[] = [
    `# Session: ${session.name}`,
    ``,
    `**Provider:** ${session.provider}  |  **Model:** ${session.model}`,
    session.systemPrompt ? `**System:** ${session.systemPrompt}` : "",
    `**Exported:** ${new Date().toLocaleString()}`,
    ``,
    `---`,
    ``,
  ].filter((l) => l !== undefined);

  for (const msg of session.messages) {
    if (msg.role === "system") {
      lines.push(`> ${msg.content}`, ``);
    } else if (msg.role === "user") {
      lines.push(`**You:** ${msg.content}`, ``);
    } else {
      lines.push(`**${session.name}:** ${msg.content}`, ``);
    }
  }

  writeFileSync(outPath, lines.join("\n"), "utf-8");
  return outPath;
}
