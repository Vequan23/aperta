import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeStore, readLedger } from "../src/ledger.ts";
import { UniversalGitObserver, readObserverActivity } from "../src/observer.ts";
import { readEngineInfo, startEngine, stopEngine } from "../src/engine.ts";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

test("captures any stable working-tree change as unattributed", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-observer-"));
  await exec("git", ["init", "-q", root]);
  await exec("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", root, "config", "user.name", "Test"]);
  await writeFile(join(root, "base.ts"), "export const base = true;\n");
  await exec("git", ["-C", root, "add", "base.ts"]);
  await exec("git", ["-C", root, "commit", "-qm", "base"]);
  await initializeStore(root);
  const observer = new UniversalGitObserver(root, 0);
  await writeFile(join(root, "from-any-agent.ts"), "export const value = 1;\n");
  await observer.tick(1_000);
  await observer.tick(1_001);
  const events = await readLedger(root);
  const diff = events.find((event) => event.kind === "diff");
  assert.equal(diff?.authorship, "unknown");
  assert.equal(diff?.model, "universal-git-observer");
  assert.deepEqual(diff?.files.map((file) => file.path), ["from-any-agent.ts"]);
  assert.equal(events.find((event) => event.kind === "confidence")?.score, null);
});

test("exposes changing files while it groups a burst", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-observer-pending-"));
  await exec("git", ["init", "-q", root]);
  await initializeStore(root);
  const observer = new UniversalGitObserver(root, 10_000);
  await writeFile(join(root, "live.ts"), "working\n");
  await observer.tick(2_000);
  assert.equal(observer.getStatus().state, "grouping");
  assert.equal(observer.getStatus().pending?.files[0].path, "live.ts");
  assert.equal((await readLedger(root)).filter((event) => event.kind === "diff").length, 0);
});

test("resets its baseline on a branch switch instead of capturing the branch delta", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-observer-branch-"));
  await exec("git", ["init", "-q", root]);
  await exec("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", root, "config", "user.name", "Test"]);
  await writeFile(join(root, "base.ts"), "main\n");
  await exec("git", ["-C", root, "add", "base.ts"]);
  await exec("git", ["-C", root, "commit", "-qm", "main"]);
  await initializeStore(root);
  const observer = new UniversalGitObserver(root, 0);
  await observer.tick(1_000);
  await exec("git", ["-C", root, "switch", "-qc", "feature"]);
  await writeFile(join(root, "branch-only.ts"), "committed on branch\n");
  await exec("git", ["-C", root, "add", "branch-only.ts"]);
  await exec("git", ["-C", root, "commit", "-qm", "feature"]);
  await observer.tick(2_000);
  assert.equal((await readLedger(root)).filter((event) => event.kind === "diff").length, 0);
  await writeFile(join(root, "working.ts"), "new working change\n");
  await observer.tick(3_000);
  await observer.tick(3_001);
  const diff = (await readLedger(root)).find((event) => event.kind === "diff");
  assert.deepEqual(diff?.files.map((file) => file.path), ["working.ts"]);
  assert.ok((await readObserverActivity(root)).some((entry) => entry.type === "branch" && entry.branch === "feature"));
});

test("starts and stops a detached background engine with durable status", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-engine-"));
  await exec("git", ["init", "-q", root]);
  await initializeStore(root);
  const entry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const started = await startEngine(root, entry);
  try {
    assert.equal(started.running, true);
    assert.ok(started.pid);
    assert.equal((await readEngineInfo(root)).running, true);
  } finally {
    const stopped = await stopEngine(root);
    assert.equal(stopped.wasRunning, true);
    assert.equal(stopped.stopped, true);
  }
});
