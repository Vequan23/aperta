import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, sep } from "node:path";
import { listTrackedFiles } from "./git.ts";

export interface RepositoryFile {
  path: string;
  content: string;
  language: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}

const languageByExtension: Record<string, string> = {
  ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
  ".vue": "vue", ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust", ".cs": "csharp", ".cpp": "cpp", ".cc": "cpp", ".c": "c",
  ".h": "c", ".hpp": "cpp", ".json": "json", ".xml": "xml", ".html": "html", ".css": "css", ".scss": "scss", ".md": "markdown",
  ".yml": "yaml", ".yaml": "yaml", ".toml": "toml", ".properties": "properties", ".sh": "shell", ".zsh": "shell", ".sql": "sql",
};

function safeRelativePath(path: string): string {
  if (!path || path.includes("\0") || isAbsolute(path)) throw new Error("Invalid repository path");
  const cleaned = normalize(path).split(sep).join("/");
  if (cleaned === ".." || cleaned.startsWith("../") || cleaned.includes("/../")) throw new Error("Invalid repository path");
  return cleaned.replace(/^\.\//, "");
}

export async function listRepositoryFiles(root: string): Promise<string[]> {
  return (await listTrackedFiles(root)).slice(0, 20_000);
}

export async function readRepositoryFile(root: string, requestedPath: string): Promise<RepositoryFile> {
  const path = safeRelativePath(requestedPath);
  const allowed = new Set(await listRepositoryFiles(root));
  if (!allowed.has(path)) throw new Error("File is not part of the visible Git repository");
  const fullPath = join(root, path);
  const details = await stat(fullPath);
  if (!details.isFile()) throw new Error("Repository path is not a file");
  const limit = 1_000_000;
  const bytes = await readFile(fullPath);
  const binary = bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0);
  return {
    path, size: details.size, binary, truncated: details.size > limit,
    language: languageByExtension[extname(path).toLowerCase()] ?? "text",
    content: binary ? "" : bytes.subarray(0, limit).toString("utf8"),
  };
}
