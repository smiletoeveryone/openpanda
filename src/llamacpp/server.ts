/**
 * llama.cpp server process manager.
 *
 * Starts and monitors a `llama-server` subprocess, waits for it to be healthy,
 * and exposes an OpenAI-compatible HTTP API on the configured port.
 *
 * Any project — Python, Node, Rust, etc. — can connect to the running endpoint
 * with a standard OpenAI client pointed at `http://HOST:PORT/v1`.
 *
 * Supported models: Llama 4 Scout/Maverick, Llama 3, Mistral, Phi, Qwen, and
 * any other GGUF model supported by llama.cpp.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { LlamaCppServerConfig } from "../config/store.js";

/** Locations to search for the llama-server binary (in priority order). */
const BINARY_SEARCH_PATHS = [
  // Honour PATH first — most common after `cmake --install`
  "llama-server",
  // Homebrew / system installs
  "/usr/local/bin/llama-server",
  "/usr/bin/llama-server",
  // User-compiled from source
  join(homedir(), "llama.cpp/build/bin/llama-server"),
  join(homedir(), ".local/bin/llama-server"),
  // Run from inside the llama.cpp repo directory
  "build/bin/llama-server",
  "./llama-server",
];

/**
 * Locate the llama-server binary.
 * Returns the explicit path if set in config; otherwise scans BINARY_SEARCH_PATHS.
 * Returns `null` when not found.
 */
export function findLlamaServerBinary(configuredPath?: string): string | null {
  if (configuredPath) {
    return existsSync(configuredPath) ? configuredPath : null;
  }
  for (const p of BINARY_SEARCH_PATHS) {
    if (p === "llama-server") return p; // trust PATH — existence check not reliable
    if (existsSync(p)) return p;
  }
  return null;
}

export interface LlamaCppServer {
  /** Base URL of the running server, e.g. "http://127.0.0.1:8080" */
  endpoint: string;
  /** Stop the llama-server subprocess. */
  stop(): void;
  /**
   * Poll /health until the server is ready to accept requests.
   * Rejects if the server does not become ready within `timeoutMs` (default 60s).
   */
  waitForReady(timeoutMs?: number): Promise<void>;
}

/**
 * Spawn a llama-server subprocess and return a handle to it.
 *
 * The server inherits stdout/stderr so logs appear directly in the terminal.
 * Call `waitForReady()` before sending requests.
 */
export function startLlamaServer(cfg: LlamaCppServerConfig): LlamaCppServer {
  const host = cfg.host ?? "127.0.0.1";
  const port = cfg.port ?? 8080;
  const endpoint = `http://${host}:${port}`;

  const binary = findLlamaServerBinary(cfg.serverPath);
  if (!binary) {
    throw new Error(
      "llama-server binary not found.\n" +
      "Install llama.cpp (https://github.com/ggerganov/llama.cpp) and ensure\n" +
      "`llama-server` is on your PATH, or set llamacpp.serverPath in your config."
    );
  }

  const modelPath = cfg.modelPath ?? process.env.LLAMACPP_MODEL;
  if (!modelPath) {
    throw new Error(
      "No model path configured.\n" +
      "Set llamacpp.modelPath in your config (run: openpanda setup)\n" +
      "or export LLAMACPP_MODEL=/path/to/model.gguf"
    );
  }

  const args: string[] = [
    "--model",    modelPath,
    "--host",     host,
    "--port",     String(port),
    "--ctx-size", String(cfg.ctxSize ?? 4096),
  ];

  if (cfg.nGpuLayers !== undefined && cfg.nGpuLayers !== 0) {
    args.push("--n-gpu-layers", String(cfg.nGpuLayers));
  }
  if (cfg.threads !== undefined) {
    args.push("--threads", String(cfg.threads));
  }

  const proc: ChildProcess = spawn(binary, args, {
    stdio: ["ignore", "inherit", "inherit"],
  });

  proc.on("error", (err) => {
    process.stderr.write(`[llamacpp] process error: ${err.message}\n`);
  });

  proc.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      process.stderr.write(`[llamacpp] server exited unexpectedly (code=${code} signal=${signal})\n`);
    }
  });

  return {
    endpoint,

    stop() {
      if (!proc.killed) proc.kill("SIGTERM");
    },

    async waitForReady(timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${endpoint}/health`, {
            signal: AbortSignal.timeout(2_000),
          });
          if (res.ok) return;
        } catch {
          // server not ready yet — keep polling
        }
        await new Promise<void>((r) => setTimeout(r, 1_000));
      }
      throw new Error(
        `llama-server did not become ready within ${timeoutMs / 1000}s.\n` +
        "Check the server logs above for errors."
      );
    },
  };
}
