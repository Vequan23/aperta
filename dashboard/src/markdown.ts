export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; language: string; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "rule" };

export function parseMarkdown(source = ""): MarkdownBlock[] {
  const lines = source.replace(/\r/g, "").trim().split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = line.match(/^\s*```([^\s`]*)\s*$/);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index++;
      }
      blocks.push({ type: "code", language: fence[1].toLowerCase(), lines: code });
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      const quoted = [quote[1]];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].match(/^\s*>\s?(.*)$/);
        if (!next) break;
        quoted.push(next[1]);
        index++;
      }
      blocks.push({ type: "quote", text: quoted.join(" ") });
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const items = [(ordered ?? unordered)![1]];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].match(
          isOrdered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/,
        );
        if (!next) break;
        items.push(next[1]);
        index++;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderInlineMarkdown(value: string) {
  const code: string[] = [];
  let html = escapeHtml(value).replace(/`([^`]+)`/g, (_match, contents: string) => {
    const marker = `\u0000CODE${code.length}\u0000`;
    code.push(`<code>${contents}</code>`);
    return marker;
  });
  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
  return html.replace(/\u0000CODE(\d+)\u0000/g, (_match, index: string) => code[Number(index)]);
}

export function languagePath(language: string) {
  const aliases: Record<string, string> = {
    bash: "snippet.sh",
    shell: "snippet.sh",
    sh: "snippet.sh",
    zsh: "snippet.sh",
    js: "snippet.js",
    javascript: "snippet.js",
    jsx: "snippet.jsx",
    ts: "snippet.ts",
    typescript: "snippet.ts",
    tsx: "snippet.tsx",
    java: "Snippet.java",
    json: "snippet.json",
    html: "snippet.html",
    xml: "snippet.xml",
    vue: "snippet.vue",
    yaml: "snippet.yml",
    yml: "snippet.yml",
    toml: "snippet.toml",
    properties: "snippet.properties",
  };
  return aliases[language] ?? `snippet.${language || "txt"}`;
}
