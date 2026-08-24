import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listRepositoryFiles, readRepositoryFile } from "../src/repository.ts";

const exec = promisify(execFile);

test("repository explorer exposes Git-visible files but not ignored secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-repository-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, ".gitignore"), ".env\n");
  await writeFile(join(root, "app.ts"), "export const answer = 42;\n");
  await writeFile(join(root, ".env"), "SECRET=never\n");
  const files = await listRepositoryFiles(root);
  assert.ok(files.includes("app.ts"));
  assert.ok(!files.includes(".env"));
  assert.equal((await readRepositoryFile(root, "app.ts")).language, "typescript");
  await assert.rejects(() => readRepositoryFile(root, ".env"), /visible Git repository/);
  await assert.rejects(() => readRepositoryFile(root, "../outside"), /Invalid repository path/);
});
