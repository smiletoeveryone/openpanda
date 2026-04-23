import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { readFileSync, readdirSync, statSync, lstatSync } from "fs";
import { extname, join, resolve } from "path";
import { homedir } from "os";

const UA = "Mozilla/5.0 (compatible; OpenPanda/0.1; +https://github.com/openpanda)";

// Silent virtual console — suppresses jsdom CSS parse warnings that appear
// whenever a fetched page has stylesheets jsdom cannot handle.
const silentConsole = new VirtualConsole();

async function readableExtract(url: string, maxChars = 10_000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);

  const html = await res.text();
  const dom = new JSDOM(html, { url, virtualConsole: silentConsole });
  const reader = new Readability(dom.window.document as unknown as Document);
  const article = reader.parse();

  if (!article?.textContent) {
    // Fallback: strip tags manually
    const raw = dom.window.document.body?.textContent ?? "";
    return raw.replace(/\s+/g, " ").trim().slice(0, maxChars);
  }

  const body = article.textContent.replace(/\s+/g, " ").trim();
  return [
    `# ${article.title}`,
    article.byline ? `By ${article.byline}` : "",
    article.excerpt ? `\n> ${article.excerpt}\n` : "",
    body,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, maxChars);
}

async function ddgSearch(query: string, maxResults = 8): Promise<string> {
  // DuckDuckGo HTML search (no API key required)
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`DDG HTTP ${res.status}`);

  const html = await res.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const results: string[] = [];
  const links = doc.querySelectorAll(".result");

  for (const el of Array.from(links).slice(0, maxResults)) {
    const title = el.querySelector(".result__title")?.textContent?.trim() ?? "";
    const snippet = el.querySelector(".result__snippet")?.textContent?.trim() ?? "";
    const href = el.querySelector(".result__url")?.textContent?.trim() ?? "";
    if (title) results.push(`**${title}**\n${href}\n${snippet}`);
  }

  return results.length ? results.join("\n\n") : "No results found.";
}

// ── Filesystem access (read-only) ───────────────────────────────────────────

const BLOCKED_PATHS = [
  "/etc", "/sys", "/proc", "/dev", "/root", "/boot", "/var/log",
  "/var/spool", "/run", "/tmp/.X11", "/tmp/snap",
];

const BLOCKED_EXTENSIONS = [".so", ".dylib", ".dll", ".exe", ".bin", ".o"];

function isSafeToRead(path: string): boolean {
  const resolved = resolve(path);
  // Block system directories
  if (BLOCKED_PATHS.some((bp) => resolved.startsWith(bp))) return false;
  // Block binary files
  if (BLOCKED_EXTENSIONS.includes(extname(resolved).toLowerCase())) return false;
  return true;
}

async function readLocalFile(filePath: string, maxBytes = 100_000): Promise<string> {
  if (!isSafeToRead(filePath)) throw new Error(`Access denied: ${filePath}`);
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
  if (stat.size > maxBytes) {
    return readFileSync(filePath, "utf-8").slice(0, maxBytes) + `\n\n[... file truncated, showing first ${maxBytes} bytes]`;
  }
  return readFileSync(filePath, "utf-8");
}

async function listLocalDirectory(dirPath: string): Promise<string> {
  if (!isSafeToRead(dirPath)) throw new Error(`Access denied: ${dirPath}`);
  const stat = statSync(dirPath);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${dirPath}`);
  const entries = readdirSync(dirPath, { withFileTypes: true }).slice(0, 100); // limit to 100 entries
  const lines = [`📁 ${dirPath}\n`];
  for (const entry of entries) {
    const type = entry.isDirectory() ? "📂" : "📄";
    const size = entry.isFile() ? ` (${statSync(join(dirPath, entry.name)).size} bytes)` : "";
    lines.push(`${type} ${entry.name}${size}`);
  }
  return lines.join("\n");
}

async function findLocalFiles(pattern: string, searchDir: string = process.cwd(), maxResults = 50): Promise<string> {
  if (!isSafeToRead(searchDir)) throw new Error(`Access denied: ${searchDir}`);
  const results: string[] = [];
  const regex = new RegExp(pattern, "i");

  function traverse(dir: string, depth = 0) {
    if (results.length >= maxResults || depth > 5) return; // limit depth and results
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".")) traverse(fullPath, depth + 1);
        } else if (regex.test(entry.name)) {
          results.push(fullPath);
        }
      }
    } catch {
      // silently skip unreadable directories
    }
  }

  traverse(searchDir);
  return results.length ? results.join("\n") : "No files found matching the pattern.";
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "openpanda-web",
    version: "0.1.0",
  });

  // ── fetch_page ─────────────────────────────────────────────────────────────
  server.tool(
    "fetch_page",
    "Fetch a web page and extract its full main content as clean, structured text using Mozilla Readability (the same engine Firefox uses for Reader Mode). Use this to read articles, blog posts, docs, and any URL the user shares.",
    { url: z.string().url().describe("Full URL to fetch (http or https)") },
    async ({ url }) => {
      try {
        const text = await readableExtract(url);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── search_web ─────────────────────────────────────────────────────────────
  server.tool(
    "search_web",
    "Search the web using DuckDuckGo and return titles, URLs, and snippets for the top results. Use this to find relevant pages before fetching their full content.",
    {
      query: z.string().describe("Search query"),
      max_results: z.number().int().min(1).max(20).default(8).describe("Number of results"),
    },
    async ({ query, max_results }) => {
      try {
        const text = await ddgSearch(query, max_results);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── fetch_multiple ─────────────────────────────────────────────────────────
  server.tool(
    "fetch_multiple",
    "Fetch and extract content from multiple URLs in parallel. Use when you need to compare or synthesise information from several sources.",
    {
      urls: z.array(z.string().url()).max(5).describe("List of URLs to fetch (max 5)"),
    },
    async ({ urls }) => {
      const results = await Promise.allSettled(urls.map((u) => readableExtract(u, 4_000)));
      const parts = urls.map((url, i) => {
        const r = results[i];
        return r.status === "fulfilled"
          ? `=== ${url} ===\n${r.value}`
          : `=== ${url} === [ERROR: ${(r.reason as Error).message}]`;
      });
      return { content: [{ type: "text", text: parts.join("\n\n") }] };
    }
  );

  // ── read_file (local filesystem, read-only) ────────────────────────────────
  server.tool(
    "read_file",
    "Read the contents of a local file on the filesystem (read-only). Supports code files, config files, docs, etc. Limited to 100KB per file.",
    {
      path: z.string().describe("Absolute or relative file path to read"),
    },
    async ({ path }) => {
      try {
        const text = await readLocalFile(path);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── list_directory (local filesystem, read-only) ────────────────────────────
  server.tool(
    "list_directory",
    "List files and subdirectories in a local directory (read-only). Shows first 100 entries with file sizes.",
    {
      path: z.string().describe("Absolute or relative directory path"),
    },
    async ({ path }) => {
      try {
        const text = await listLocalDirectory(path);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── find_files (local filesystem, read-only) ──────────────────────────────
  server.tool(
    "find_files",
    "Find local files matching a pattern (by filename). Searches recursively from a directory, case-insensitive. Limited to 50 results and 5 directory levels.",
    {
      pattern: z.string().describe("Filename pattern to match (regex, e.g., '\\.json$' for JSON files)"),
      search_dir: z.string().optional().describe("Directory to search from (defaults to current working directory)"),
    },
    async ({ pattern, search_dir }) => {
      try {
        const text = await findLocalFiles(pattern, search_dir ?? process.cwd());
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
