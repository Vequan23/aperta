import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureWorkingDiff, createRepositorySnapshot, currentBranch, diffSnapshots, findRepoRoot, readGitWorkingStatus } from "../src/git.ts";

const exec = promisify(execFile);

test("captures staged, unstaged, and untracked changes while ignoring aperta data", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-git-"));
  await exec("git", ["init", "-q", root]);
  await exec("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", root, "config", "user.name", "Aperta Test"]);
  await writeFile(join(root, "tracked.ts"), "const value = 1;\n");
  await exec("git", ["-C", root, "add", "tracked.ts"]);
  await exec("git", ["-C", root, "commit", "-qm", "initial"]);

  await writeFile(join(root, "tracked.ts"), "const value = 2;\nconst next = 3;\n");
  await writeFile(join(root, "untracked.txt"), "one line\n");
  await mkdir(join(root, ".comprehension"));
  await writeFile(join(root, ".comprehension/ledger.jsonl"), "private runtime data\n");

  assert.equal(await findRepoRoot(join(root, ".comprehension")), await realpath(root));
  assert.equal(await currentBranch(root), "main");
  const captured = await captureWorkingDiff(root);
  assert.deepEqual(captured.files, [
    { path: "tracked.ts", added: 2, removed: 1, hunks: 1 },
    { path: "untracked.txt", added: 1, removed: 0, hunks: 1 },
  ]);
  assert.match(captured.patch, /\+const next = 3;/);
  assert.equal(captured.fingerprint.length, 64);
});

test("snapshot comparison isolates only changes made during an agent session", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-session-"));
  await exec("git", ["init", "-q", root]);
  await writeFile(join(root, "existing.txt"), "dirty before\n");
  const before = await createRepositorySnapshot(root);
  await writeFile(join(root, "agent.txt"), "made by agent\n");
  const after = await createRepositorySnapshot(root);
  const captured = await diffSnapshots(root, before, after);
  assert.deepEqual(captured.files, [{ path: "agent.txt", added: 1, removed: 0, hunks: 1 }]);
});

test("working status separates staged, unstaged, and untracked files", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-status-"));
  await exec("git", ["init", "-q", root]);
  await exec("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", root, "config", "user.name", "Aperta Test"]);
  await writeFile(join(root, "both.txt"), "base\n");
  await writeFile(join(root, "unstaged.txt"), "base\n");
  await exec("git", ["-C", root, "add", "."]); await exec("git", ["-C", root, "commit", "-qm", "initial"]);
  await writeFile(join(root, "both.txt"), "staged\n"); await exec("git", ["-C", root, "add", "both.txt"]);
  await writeFile(join(root, "both.txt"), "staged and unstaged\n");
  await writeFile(join(root, "unstaged.txt"), "changed\n");
  await writeFile(join(root, "new.txt"), "new\n");
  const status = await readGitWorkingStatus(root);
  assert.deepEqual(status.staged.map((file) => file.path), ["both.txt"]);
  assert.deepEqual(status.unstaged.map((file) => file.path), ["both.txt", "unstaged.txt"]);
  assert.deepEqual(status.untracked.map((file) => file.path), ["new.txt"]);
});
