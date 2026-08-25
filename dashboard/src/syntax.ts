export type SyntaxKind = "plain" | "keyword" | "string" | "number" | "comment" | "annotation" | "type" | "property" | "operator" | "tag" | "attribute" | "literal";
export type SyntaxToken = { text: string; kind: SyntaxKind };

const javaKeywords = new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public record return sealed short static strictfp super switch synchronized this throw throws transient try var void volatile while yield".split(" "));
const tsKeywords = new Set("as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let namespace new null of package private protected public readonly return satisfies set static super switch this throw true try type typeof undefined unknown var void while with yield".split(" "));
const literals = new Set(["true", "false", "null", "undefined"]);
const cssLiterals = new Set(["auto", "currentcolor", "inherit", "initial", "none", "revert", "transparent", "unset", "important"]);

function language(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".java")) return "java";
  if (/\.[cm]?[jt]sx?$/.test(lower)) return "typescript";
  if (/\.(json|jsonl)$/.test(lower)) return "json";
  if (/\.(css|scss|sass|less)$/.test(lower)) return "css";
  if (/\.(xml|html|vue|pom)$/.test(lower) || lower.endsWith("pom.xml")) return "markup";
  if (/\.(ya?ml|properties|toml)$/.test(lower)) return "config";
  if (/\.(sh|bash|zsh)$/.test(lower)) return "shell";
  return "plain";
}

function cssTokens(line: string): SyntaxToken[] {
  if (/^\s*\*/.test(line) || (!line.includes("/*") && line.includes("*/"))) return [{ text: line, kind: "comment" }];
  const tokens: SyntaxToken[] = [];
  let index = 0;
  while (index < line.length) {
    const rest = line.slice(index);
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/", 2);
      const value = end < 0 ? rest : rest.slice(0, end + 2);
      push(tokens, value, "comment"); index += value.length; continue;
    }
    const whitespace = rest.match(/^\s+/)?.[0];
    if (whitespace) { push(tokens, whitespace); index += whitespace.length; continue; }
    const quoted = rest.match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/)?.[0];
    if (quoted) { push(tokens, quoted, "string"); index += quoted.length; continue; }
    const atRule = rest.match(/^@[A-Za-z-]+/)?.[0];
    if (atRule) { push(tokens, atRule, "keyword"); index += atRule.length; continue; }
    const color = rest.match(/^#[\da-f]{3,8}\b/i)?.[0];
    if (color) { push(tokens, color, "literal"); index += color.length; continue; }
    const customProperty = rest.match(/^--[A-Za-z_][\w-]*/)?.[0];
    if (customProperty) { push(tokens, customProperty, "literal"); index += customProperty.length; continue; }
    const number = rest.match(/^-?(?:\d*\.)?\d+(?:e[+-]?\d+)?(?:%|[a-z]+)?/i)?.[0];
    if (number) { push(tokens, number, "number"); index += number.length; continue; }
    const identifier = rest.match(/^-?[A-Za-z_][\w-]*/)?.[0];
    if (identifier) {
      const prefix = line.slice(0, index);
      const declaration = Math.max(prefix.lastIndexOf("{"), prefix.lastIndexOf(";")) >= prefix.lastIndexOf("}")
        || /^\s*$/.test(prefix);
      const followedByColon = /^\s*:/.test(line.slice(index + identifier.length));
      const beforeRule = !line.slice(0, index).includes("{") && line.slice(index).includes("{");
      const kind: SyntaxKind = declaration && followedByColon ? "property"
        : cssLiterals.has(identifier.toLowerCase()) ? "literal"
        : beforeRule ? "tag" : "plain";
      push(tokens, identifier, kind); index += identifier.length; continue;
    }
    const selector = rest.match(/^[.#][A-Za-z_][\w-]*/)?.[0];
    if (selector) { push(tokens, selector, "tag"); index += selector.length; continue; }
    const operator = rest.match(/^(?:[{}[\]():;,>+~=*!/]|\|=|\^=|\$=)+/)?.[0];
    if (operator) { push(tokens, operator, "operator"); index += operator.length; continue; }
    push(tokens, line[index]); index++;
  }
  return tokens;
}

function push(tokens: SyntaxToken[], text: string, kind: SyntaxKind = "plain") {
  if (!text) return;
  const previous = tokens.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else tokens.push({ text, kind });
}

function markupTokens(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let index = 0;
  while (index < line.length) {
    if (line.startsWith("<!--", index)) { push(tokens, line.slice(index), "comment"); break; }
    const tag = line.slice(index).match(/^<\/?[A-Za-z_:][\w:.-]*/)?.[0];
    if (tag) { push(tokens, tag, "tag"); index += tag.length; continue; }
    const close = line.slice(index).match(/^\/?>/)?.[0];
    if (close) { push(tokens, close, "tag"); index += close.length; continue; }
    const quoted = line.slice(index).match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/)?.[0];
    if (quoted) { push(tokens, quoted, "string"); index += quoted.length; continue; }
    const attribute = line.slice(index).match(/^[A-Za-z_:][\w:.-]*(?=\s*=)/)?.[0];
    if (attribute) { push(tokens, attribute, "attribute"); index += attribute.length; continue; }
    const entity = line.slice(index).match(/^&(?:[A-Za-z]+|#\d+);/)?.[0];
    if (entity) { push(tokens, entity, "literal"); index += entity.length; continue; }
    push(tokens, line[index]); index++;
  }
  return tokens;
}

export function tokenizeLine(line: string, path = ""): SyntaxToken[] {
  const mode = language(path);
  if (!line) return [{ text: " ", kind: "plain" }];
  if (mode === "markup") return markupTokens(line);
  if (mode === "css") return cssTokens(line);
  if (mode === "plain") return [{ text: line, kind: "plain" }];
  const keywords = mode === "java" ? javaKeywords : tsKeywords;
  const tokens: SyntaxToken[] = [];
  let index = 0;
  while (index < line.length) {
    const rest = line.slice(index);
    if (rest.startsWith("//") || ((mode === "config" || mode === "shell") && rest.startsWith("#"))) { push(tokens, rest, "comment"); break; }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/", 2); const value = end < 0 ? rest : rest.slice(0, end + 2);
      push(tokens, value, "comment"); index += value.length; continue;
    }
    const whitespace = rest.match(/^\s+/)?.[0];
    if (whitespace) { push(tokens, whitespace); index += whitespace.length; continue; }
    const quoted = rest.match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/)?.[0];
    if (quoted) { push(tokens, quoted, "string"); index += quoted.length; continue; }
    const annotation = rest.match(/^@[A-Za-z_$][\w$]*/)?.[0];
    if (annotation) { push(tokens, annotation, "annotation"); index += annotation.length; continue; }
    const number = rest.match(/^(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)[lLdDfF]?/i)?.[0];
    if (number) { push(tokens, number, "number"); index += number.length; continue; }
    const identifier = rest.match(/^[A-Za-z_$][\w$-]*/)?.[0];
    if (identifier) {
      const after = line.slice(index + identifier.length);
      const kind: SyntaxKind = literals.has(identifier) ? "literal" : keywords.has(identifier) ? "keyword"
        : mode === "json" && /^\s*:/.test(after) ? "property"
        : mode === "config" && /^\s*[:=]/.test(after) ? "property"
        : /^[A-Z]/.test(identifier) && (mode === "java" || mode === "typescript") ? "type" : "plain";
      push(tokens, identifier, kind); index += identifier.length; continue;
    }
    const operator = rest.match(/^(?:===|!==|=>|::|->|==|!=|<=|>=|&&|\|\||\?\?|\+\+|--|[+\-*/%=<>!&|?:]+)/)?.[0];
    if (operator) { push(tokens, operator, "operator"); index += operator.length; continue; }
    push(tokens, line[index]); index++;
  }
  return tokens;
}
