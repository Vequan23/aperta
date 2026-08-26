import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalCliRuntimeEngine, MemoryRuntimeVerificationStore } from "@vraxis/agent-v/local-cli";
import { AgentVRuntimeAdapter } from "../src/agent-runtime.ts";

test("agent-v runtime adapter probes, executes, and returns versioned provenance", async () => {
  const runner = async (_command: string, args: readonly string[]) => {
    if (args.includes("--version")) return { stdout: "codex-cli test-1.0\n", stderr: "" };
    const outputPath = args[args.indexOf("-o") + 1];
    const prompt = args.at(-1) ?? "";
    const value = prompt.includes("readiness object")
      ? { status: "ready", evidenceLabel: "runtime-probe" }
      : { summary: "The package is aperta-cli." };
    await writeFile(outputPath, `${JSON.stringify(value)}\n`);
    return { stdout: JSON.stringify({ type: "result", result: JSON.stringify(value) }), stderr: "" };
  };
  const engine = new LocalCliRuntimeEngine({ runner, verificationStore: new MemoryRuntimeVerificationStore() });
  const adapter = new AgentVRuntimeAdapter(engine);
  const installed = await adapter.inspect("codex");
  assert.equal(installed.availability, "installed");
  assert.equal(installed.verification, "unverified");
  const ready = await adapter.probe("codex");
  assert.equal(ready.verification, "ready");
  const workspace = await mkdtemp(join(tmpdir(), "aperta-agent-v-adapter-"));
  const result = await adapter.run({ kind: "codex", workspace, workspaceAccess: "read-only", projectId: "aperta", runId: "run-test", prompt: "Explain the package name." });
  assert.equal(result.summary, "The package is aperta-cli.");
  assert.equal(result.provenance.adapterStrategy, "codex-exec-json-v1");
  assert.equal(result.provenance.runtimeVersion, "codex-cli test-1.0");
});

test("agent-v capability declarations fail closed for unsupported workspace access", async () => {
  const engine = new LocalCliRuntimeEngine({
    runner: async (_command, args) => args.includes("--version") ? { stdout: "1.18.23\n", stderr: "" } : { stdout: "", stderr: "" },
    verificationStore: new MemoryRuntimeVerificationStore(),
  });
  const adapter = new AgentVRuntimeAdapter(engine);
  await assert.rejects(
    adapter.run({ kind: "opencode", workspace: process.cwd(), workspaceAccess: "read-only", projectId: "aperta", runId: "run-test", prompt: "Explain the repository." }),
    /does not support read-only access/i,
  );
  const cursor = await adapter.probe("cursor");
  assert.equal(cursor.executionSupported, false);
  assert.match(cursor.detail, /cannot enforce structured execution/i);
  assert.match((await adapter.inspect("cursor")).detail, /cannot enforce structured execution/i);
});
