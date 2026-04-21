// Lightweight message parser: splits content into plain text and fenced code blocks.

export type Segment =
  | { type: "text"; content: string }
  | { type: "code"; lang: string; content: string };

const CODE_BLOCK = /```(\w*)\n([\s\S]*?)```/g;

export function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CODE_BLOCK.lastIndex = 0;

  while ((match = CODE_BLOCK.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", lang: match[1] || "text", content: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments.length ? segments : [{ type: "text", content: text }];
}

// ── Per-line basic syntax coloring ────────────────────────────────────────────
// Returns a color name (for Ink <Text color="...">) or undefined for default.

const COMMENT_RE = /^\s*(\/\/|#|--|\/\*|\*)/;
const KEYWORD_RE = /\b(const|let|var|function|class|return|if|else|for|while|import|export|from|async|await|type|interface|extends|implements|new|try|catch|throw|def|fn|pub|mod|use|struct|enum|match)\b/;

export function lineColor(line: string): "gray" | "yellow" | undefined {
  if (COMMENT_RE.test(line)) return "gray";
  if (KEYWORD_RE.test(line)) return "yellow";
  return undefined;
}
