import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applyAgentRun, classifyAgentError, runModelAgent } from "../src/agent-harness.ts";
import { buildHarnessHealth } from "../src/harness-intelligence.ts";

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
