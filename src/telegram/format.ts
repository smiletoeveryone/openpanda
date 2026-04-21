/**
 * Converts LLM markdown output to Telegram HTML.
 *
 * Telegram's HTML mode supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a>.
 * Everything else must be plain text with HTML entities escaped.
 *
 * Strategy:
 *  1. Split the text on fenced code blocks — protect their content verbatim.
 *  2. For each non-code segment, escape HTML entities then apply inline rules.
 *  3. Handle an unclosed ``` at the end of a streaming buffer gracefully.
 */

/** Escape characters that have special meaning in Telegram HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Apply inline markdown rules to an already-HTML-escaped segment. */
function applyInline(text: string): string {
  return (
    text
      // Bold+italic: ***text***
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, "<b><i>$1</i></b>")
      // Bold: **text**
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      // Italic: *text* — only when surrounded by non-space chars
      .replace(/\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*/g, "<i>$1</i>")
      // Inline code: `code`
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      // Strikethrough: ~~text~~
      .replace(/~~([^~\n]+)~~/g, "<s>$1</s>")
      // Headers: # / ## / ### → bold
      .replace(/^#{1,3} (.+)$/gm, "<b>$1</b>")
      // Unordered bullets: - item / * item / • item
      .replace(/^[-*•] (.+)$/gm, "• $1")
      // Horizontal rules → thin separator line
      .replace(/^---+$/gm, "──────────")
  );
}

/**
 * Convert a full markdown string to Telegram-safe HTML.
 * Safe to call on a partial (mid-stream) buffer — unclosed code blocks
 * are rendered as <pre> without a closing fence.
 */
export function mdToTelegramHtml(md: string): string {
  const segments: string[] = [];
  const codeBlockRe = /```(\w*)\r?\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRe.exec(md)) !== null) {
    // Text before this code block
    if (match.index > lastIdx) {
      segments.push(applyInline(escapeHtml(md.slice(lastIdx, match.index))));
    }

    const code = escapeHtml(match[2].replace(/\n$/, ""));
    const lang = match[1] ? `<code>${escapeHtml(match[1])}</code>\n` : "";
    segments.push(`${lang}<pre>${code}</pre>`);

    lastIdx = match.index + match[0].length;
  }

  // Remaining text — may contain an unclosed ``` (normal during streaming)
  const tail = md.slice(lastIdx);
  if (tail) {
    const openFence = tail.indexOf("```");
    if (openFence !== -1) {
      // Text before the opening fence
      const before = tail.slice(0, openFence);
      if (before) segments.push(applyInline(escapeHtml(before)));

      // Partial code block: strip the language hint line if present
      const partial = tail
        .slice(openFence + 3)
        .replace(/^\w*\r?\n/, ""); // remove optional "python\n" etc.
      if (partial) segments.push(`<pre>${escapeHtml(partial)}</pre>`);
    } else {
      segments.push(applyInline(escapeHtml(tail)));
    }
  }

  return segments.join("").trim();
}
