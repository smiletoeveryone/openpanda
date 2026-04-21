/**
 * Per-agent checkpoint files.
 * Saves agent message history to ~/.openpanda/checkpoints/<agentId>.json after each tool round-trip.
 * Allows resumption of interrupted multi-tool conversations after a crash.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "../core/types.js";

export interface Checkpointer {
  save(agentId: string, messages: AgentMessage[]): void;
  load(agentId: string): AgentMessage[] | null;
  clear(agentId: string): void;
}

export class FileCheckpointer implements Checkpointer {
  private readonly dir: string;

  constructor(checkpointDir: string) {
    this.dir = checkpointDir;
    mkdirSync(checkpointDir, { recursive: true });
  }

  save(agentId: string, messages: AgentMessage[]): void {
    const path = this.pathFor(agentId);
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(messages, null, 2), "utf8");
    renameSync(tmp, path);
  }

  load(agentId: string): AgentMessage[] | null {
    try {
      const raw = readFileSync(this.pathFor(agentId), "utf8");
      return JSON.parse(raw) as AgentMessage[];
    } catch {
      return null;
    }
  }

  clear(agentId: string): void {
    try {
      unlinkSync(this.pathFor(agentId));
    } catch {
      // file may not exist
    }
  }

  private pathFor(agentId: string): string {
    // Sanitize agentId to prevent path traversal
    const safe = agentId.replace(/[^a-zA-Z0-9_\-]/g, "_");
    return join(this.dir, `${safe}.json`);
  }
}
