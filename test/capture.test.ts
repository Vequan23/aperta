import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureWorkingDiff } from "../src/git.ts";
import { recordSnapshotDiff } from "../src/capture.ts";
import { initializeStore, readDiffEvidence, readLedger } from "../src/ledger.ts";

const exec = promisify(execFile);

test("stores patch evidence and rejects duplicate snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-capture-"));
  await exec("git", ["init", "-q", root]);
  await initializeStore(root);
  await writeFile(join(root, "feature.ts"), "export const feature = true;\n");
  const snapshot = await captureWorkingDiff(root);
  const first = await recordSnapshotDiff(root, snapshot, { authorship: "ai", model: "test-model" });
  const second = await recordSnapshotDiff(root, snapshot, { authorship: "ai" });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.match(await readDiffEvidence(root, first.diff.id), /feature = true/);
  assert.equal((await readLedger(root)).filter((event) => event.kind === "diff").length, 1);
});

test("serializes concurrent captures of the same fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-capture-race-"));
  await exec("git", ["init", "-q", root]);
  await initializeStore(root);
  await writeFile(join(root, "feature.ts"), "export const feature = true;\n");
  const snapshot = await captureWorkingDiff(root);
  const results = await Promise.all(Array.from({ length: 8 }, () => recordSnapshotDiff(root, snapshot, { authorship: "ai", model: "test-model" })));
  assert.equal(results.filter((result) => !result.duplicate).length, 1);
  assert.equal(new Set(results.map((result) => result.diff.id)).size, 1);
  assert.equal((await readLedger(root)).filter((event) => event.kind === "diff").length, 1);
});
