import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleHarnessHook } from "../src/hook.ts";
import { readLedger } from "../src/ledger.ts";

const exec = promisify(execFile);

test("captures each OpenCode turn at idle without duplicating unchanged state", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-hook-"));
  await exec("git", ["init", "-q", "-b", "main", root]);
  await handleHarnessHook(root, "begin", "session-one");
  await writeFile(join(root, "turn-one.ts"), "export const one = 1;\n");
  await handleHarnessHook(root, "end", "session-one");
  await handleHarnessHook(root, "end", "session-one");
  await writeFile(join(root, "turn-two.ts"), "export const two = 2;\n");
  await handleHarnessHook(root, "end", "session-one");
  const events = await readLedger(root);
  assert.equal(events.filter((event) => event.kind === "diff").length, 2);
  assert.equal(events.filter((event) => event.kind === "confidence").length, 2);
});
