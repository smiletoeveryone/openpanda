const URL_RE = /https?:\/\/[^\s)>"]+/g;

export function extractUrls(text: string): string[] {
  return [...new Set(text.match(URL_RE) ?? [])];
}

export async function fetchPageText(url: string, maxChars = 6000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; OpenPanda/0.1)" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const html = await res.text();

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text.slice(0, maxChars);
}

export async function buildAugmentedPrompt(
  userMessage: string,
  onStatus: (msg: string) => void
): Promise<string> {
  const urls = extractUrls(userMessage);
  if (!urls.length) return userMessage;

  const fetched: string[] = [];
  for (const url of urls) {
    onStatus(`Fetching ${url} …`);
    try {
      const content = await fetchPageText(url);
      fetched.push(`--- Content from ${url} ---\n${content}\n--- End ---`);
    } catch (err) {
      onStatus(`Could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!fetched.length) return userMessage;

  return `${userMessage}\n\n${fetched.join("\n\n")}`;
}
