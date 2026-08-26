import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applyAgentRun, classifyAgentError, runExternalAgent, runModelAgent } from "../src/agent-harness.ts";
import { buildHarnessHealth } from "../src/harness-intelligence.ts";
import type { ApertaCodingRuntime } from "../src/agent-runtime.ts";

const exec = promisify(execFile);

test("classifies expected harness failures without hiding unknown defects", () => {
  assert.equal(classifyAgentError(new Error("Model returned malformed JSON after an automatic retry")), "InvalidModelOutput");
  assert.equal(classifyAgentError(new Error("This conversation is based on an older repository state")), "StateConflict");
  assert.equal(classifyAgentError(new Error("Agent requested an invalid path")), "InvalidArguments");
  assert.equal(classifyAgentError(new Error("Verification timed out after three minutes")), "Timeout");
  assert.equal(classifyAgentError(new Error("OpenCode exited with code 1: no diagnostic output")), "ProviderError");
  assert.equal(classifyAgentError(new Error("Something unprecedented happened")), "HarnessBug");
});

test("builds private local harness health and approximate code keep rate", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-harness-health-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await exec("git", ["add", "app.ts"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const actions = [
    { action: "read", path: "app.ts", reason: "Inspect the implementation." },
    { action: "plan", goal: "Correct the exported answer.", steps: ["Update the existing export."], acceptanceCriteria: [{ text: "The answer export is 42.", method: "diff" }] },
    { action: "write", path: "app.ts", content: "export const answer = 42;\n", reason: "Implement the requested correction." },
    { action: "finish", summary: "Corrected the answer." },
  ];
  let call = 0;
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions[call++]) } }] }), { status: 200 });
  const config = { provider: "openai" as const, model: "health-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  const run = await runModelAgent(root, "Change the exported answer from 41 to 42.", config, undefined, fakeFetch as typeof fetch);
  await applyAgentRun(root, run.id, { acceptUnverified: true });
  assert.match(await readFile(join(root, "app.ts"), "utf8"), /42/);
  const report = await buildHarnessHealth(root);
  assert.equal(report.summary.runs, 1);
  assert.equal(report.summary.promotionRate, 1);
  assert.equal(report.summary.keepRate, 1);
  assert.ok((report.summary.averageProviderLatencyMs ?? -1) >= 0);
  assert.equal(report.models[0].model, "health-model");
  assert.ok(report.tools.some((tool) => tool.action === "read" && tool.reliability === 1));
  assert.match(report.privacy, /locally/i);
});

test("reliability reports retain the runtime version and adapter strategy", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-harness-provenance-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 42;\n");
  await exec("git", ["add", "app.ts"], { cwd: root });
  await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const provenance = { engineId: "local-cli", adapterStrategy: "codex-exec-json-v1", runtime: "codex", runtimeVersion: "codex-cli 1.2.3", model: "test-model" };
  const status = async () => ({ runtimeId: "codex", availability: "installed" as const, verification: "ready" as const, version: provenance.runtimeVersion, detail: "ready", adapterStrategy: provenance.adapterStrategy, capabilities: ["structured-output", "read-only-workspace"], executionSupported: true });
  const runtimeEngine: ApertaCodingRuntime = {
    inspect: status,
    probe: status,
    async run(input) {
      await input.events?.emit({ type: "run.started", runId: input.runId, timestamp: new Date().toISOString(), scope: { tenantId: "local", projectId: input.projectId, principalId: "test", roles: ["owner"], permissions: ["workspace:read"], dataClassification: "confidential" }, provenance });
      return { summary: "The export is 42.", provenance, durationMs: 4, activityCount: 1, attempts: 1 };
    },
  };
  await runExternalAgent(root, "Explain the exported answer without changing files.", { kind: "codex", model: "test-model", command: "codex" }, undefined, { runtimeEngine });
  const report = await buildHarnessHealth(root);
  assert.equal(report.models[0]?.runtimeVersion, "codex-cli 1.2.3");
  assert.equal(report.models[0]?.adapterStrategy, "codex-exec-json-v1");
  assert.equal(report.recent[0]?.runtime, "codex");
  assert.equal(report.recent[0]?.runtimeVersion, "codex-cli 1.2.3");
});
