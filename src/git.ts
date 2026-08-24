import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { DiffFile } from "./types.ts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 20 * 1024 * 1024 });
    return stdout.trimEnd();
  } catch (error) {
    const message = (error as { stderr?: string; message: string }).stderr?.trim() || (error as Error).message;
    throw new Error(`Git error: ${message}`);
  }
}

export interface RepoSnapshot { tree: string }
export interface SnapshotDiff { files: DiffFile[]; patch: string; fingerprint: string; baseTree: string; resultTree: string }
export interface GitWorkingFile { path: string; status: string; code: string }
export interface GitWorkingStatus { branch: string; staged: GitWorkingFile[]; unstaged: GitWorkingFile[]; untracked: GitWorkingFile[] }

export async function findRepoRoot(cwd: string): Promise<string> {
  return resolve(await git(cwd, ["rev-parse", "--show-toplevel"]));
}

export async function currentBranch(root: string): Promise<string> {
  const branch = await git(root, ["branch", "--show-current"]);
  return branch || "HEAD";
}

export async function listTrackedFiles(root: string): Promise<string[]> {
  const output = await git(root, ["ls-files", "-co", "--exclude-standard", "--", ".", ":(exclude).comprehension"]);
  return [...new Set(output.split("\n").filter(Boolean))].sort();
}

function gitStatusLabel(code: string): string {
  return ({ M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", U: "Unmerged", T: "Type changed", "?": "Untracked" } as Record<string, string>)[code] ?? "Changed";
}

export async function readGitWorkingStatus(root: string): Promise<GitWorkingStatus> {
  const output = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".", ":(exclude).comprehension"]);
  const staged: GitWorkingFile[] = [], unstaged: GitWorkingFile[] = [], untracked: GitWorkingFile[] = [];
  const records = output.split("\0").filter(Boolean);
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const x = record[0] ?? " ", y = record[1] ?? " ";
    let path = record.slice(3);
    if (x === "R" || x === "C" || y === "R" || y === "C") path = records[++index] ?? path;
    if (x === "?" && y === "?") { untracked.push({ path, status: "Untracked", code: "?" }); continue; }
    if (x !== " " && x !== "?") staged.push({ path, status: gitStatusLabel(x), code: x });
    if (y !== " " && y !== "?") unstaged.push({ path, status: gitStatusLabel(y), code: y });
  }
  const byPath = (a: GitWorkingFile, b: GitWorkingFile) => a.path.localeCompare(b.path);
  return { branch: await currentBranch(root), staged: staged.sort(byPath), unstaged: unstaged.sort(byPath), untracked: untracked.sort(byPath) };
}

async function hasHead(root: string): Promise<boolean> {
  try { await git(root, ["rev-parse", "--verify", "HEAD"]); return true; } catch { return false; }
}

export async function createRepositorySnapshot(root: string): Promise<RepoSnapshot> {
  const temp = await mkdtemp(join(tmpdir(), "aperta-index-"));
  const index = join(temp, "index");
  const env = { GIT_INDEX_FILE: index };
  try {
    await git(root, (await hasHead(root)) ? ["read-tree", "HEAD"] : ["read-tree", "--empty"], env);
    await git(root, ["add", "-A", "--", ".", ":(exclude).comprehension", ":(exclude).git"], env);
    return { tree: await git(root, ["write-tree"], env) };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function headSnapshot(root: string): Promise<RepoSnapshot> {
  if (!(await hasHead(root))) return emptySnapshot(root);
  return { tree: await git(root, ["rev-parse", "HEAD^{tree}"]) };
}

async function emptySnapshot(root: string): Promise<RepoSnapshot> {
  const temp = await mkdtemp(join(tmpdir(), "aperta-empty-index-"));
  const env = { GIT_INDEX_FILE: join(temp, "index") };
  try {
    await git(root, ["read-tree", "--empty"], env);
    return { tree: await git(root, ["write-tree"], env) };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function parseNumstat(output: string): DiffFile[] {
  return output.split("\n").filter(Boolean).map((line) => {
    const [addedRaw, removedRaw, ...pathParts] = line.split("\t");
    return { path: pathParts.join("\t"), added: addedRaw === "-" ? 0 : Number(addedRaw), removed: removedRaw === "-" ? 0 : Number(removedRaw), hunks: 0 };
  }).filter((file) => file.path);
}

function countHunks(patch: string): Map<string, number> {
  const counts = new Map<string, number>();
  let current: string | undefined;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git a/")) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      current = match?.[2];
      if (current && !counts.has(current)) counts.set(current, 0);
    } else if (current && line.startsWith("@@")) counts.set(current, (counts.get(current) ?? 0) + 1);
  }
  return counts;
}

export async function diffSnapshots(root: string, before: RepoSnapshot, after: RepoSnapshot): Promise<SnapshotDiff> {
  const [numstat, patch] = await Promise.all([
    git(root, ["diff-tree", "--no-commit-id", "--numstat", "-r", before.tree, after.tree]),
    git(root, ["diff-tree", "--no-commit-id", "--no-ext-diff", "--unified=3", "-r", before.tree, after.tree]),
  ]);
  const files = parseNumstat(numstat);
  const hunks = countHunks(patch);
  for (const file of files) file.hunks = hunks.get(file.path) ?? (file.added + file.removed > 0 ? 1 : 0);
  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)), patch,
    fingerprint: createHash("sha256").update(`${before.tree}:${after.tree}`).digest("hex"),
    baseTree: before.tree, resultTree: after.tree,
  };
}

export async function captureWorkingDiff(root: string): Promise<SnapshotDiff> {
  return diffSnapshots(root, await headSnapshot(root), await createRepositorySnapshot(root));
}
