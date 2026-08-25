import test from "node:test";
import assert from "node:assert/strict";
import { access, appendFile, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendEvent, auditLedger, defaultConfig, initializeStore, readLedger, repairLedger } from "../src/ledger.ts";
import { inspectProjectInitialization, inspectStoragePrivacy, privateProjectDir } from "../src/storage.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadDashboardState } from "../src/dashboard-data.ts";

const exec = promisify(execFile);

test("initializes an append-only JSONL store", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-"));
  assert.equal((await inspectProjectInitialization(root)).initialized, false);
  assert.equal(await initializeStore(root), true);
  assert.equal((await inspectProjectInitialization(root)).initialized, true);
  assert.equal(await initializeStore(root), false);
  const event = { id: "one", ts: new Date(0).toISOString(), repo: "demo", branch: "main", kind: "bypass" as const, reason: "unknown" as const };
  await appendEvent(root, event);
  assert.deepEqual(await readLedger(root), [event]);
  assert.deepEqual(JSON.parse(await readFile(join(privateProjectDir(root), "config.json"), "utf8")), defaultConfig);
  assert.equal((await stat(privateProjectDir(root))).mode & 0o777, 0o700);
  assert.equal((await stat(join(privateProjectDir(root), "ledger.jsonl"))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(join(root, ".comprehension/project.json"), "utf8")).version, 1);
  await assert.rejects(() => access(join(root, ".comprehension/ledger.jsonl")));
});

test("read-only dashboard loading does not initialize project memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-read-only-dashboard-"));
  await exec("git", ["init", "-q", root]);
  await writeFile(join(root, "README.md"), "# Uninitialized repository\n");
  await exec("git", ["-C", root, "add", "README.md"]);
  const state = await loadDashboardState(root, undefined, [], { initialized: false });
  assert.deepEqual(state.repositoryFiles, ["README.md"]);
  await assert.rejects(() => access(join(root, ".comprehension")));
});

test("backs up and removes a corrupt trailing ledger record", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-ledger-repair-"));
  await initializeStore(root);
  await appendEvent(root, { id: "safe", ts: new Date(0).toISOString(), repo: "demo", branch: "main", kind: "bypass", reason: "unknown" });
  await appendFile(join(privateProjectDir(root), "ledger.jsonl"), "{broken\n", "utf8");
  assert.equal((await auditLedger(root)).valid, false);
  const repair = await repairLedger(root);
  assert.equal(repair.repaired, true);
  assert.ok(repair.backup);
  assert.equal((await readLedger(root)).length, 1);
  assert.equal((await auditLedger(root)).valid, true);
});

test("serializes concurrent writes and verifies the integrity chain", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-ledger-chain-"));
  await initializeStore(root);
  await Promise.all(Array.from({ length: 12 }, (_, index) => appendEvent(root, { id: `event-${index}`, ts: new Date(index).toISOString(), repo: "demo", branch: "main", kind: "bypass", reason: "unknown" })));
  assert.equal((await readLedger(root)).length, 12);
  assert.deepEqual(await auditLedger(root), { valid: true, events: 12, chained: 12, legacy: 0, error: null });
});

test("migrates a tracked repository ledger into private user storage without losing history", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-ledger-migration-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await mkdir(join(root, ".comprehension", "cache"), { recursive: true });
  const event = { id: "legacy", ts: new Date(0).toISOString(), repo: "demo", branch: "main", kind: "bypass", reason: "unknown" };
  await writeFile(join(root, ".comprehension", "config.json"), JSON.stringify(defaultConfig));
  await writeFile(join(root, ".comprehension", "ledger.jsonl"), `${JSON.stringify(event)}\n`);
  await writeFile(join(root, ".comprehension", "cache", "private.log"), "private history\n");
  await exec("git", ["add", ".comprehension/config.json", ".comprehension/ledger.jsonl"], { cwd: root });

  assert.equal(await initializeStore(root), true);
  assert.deepEqual(await readLedger(root), [event]);
  assert.equal(await readFile(join(privateProjectDir(root), "cache", "private.log"), "utf8"), "private history\n");
  await assert.rejects(() => access(join(root, ".comprehension", "ledger.jsonl")));
  const privacy = await inspectStoragePrivacy(root);
  assert.deepEqual(privacy.legacyPaths, []);
  assert.deepEqual(privacy.trackedPrivatePaths.sort(), [".comprehension/config.json", ".comprehension/ledger.jsonl"]);
});
