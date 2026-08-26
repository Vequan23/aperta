import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { AgentVError, type RunProvenance } from "@vraxis/agent-v";
import { applyAgentRun, buildAgentTranscriptPrompt, classifyAgentError, listAgentConversations, MAX_AGENT_INPUT_CHARS, runExternalAgent, runModelAgent, saveAgentUnderstanding } from "../src/agent-harness.ts";
import type { ApertaCodingRuntime, ApertaRuntimeResult } from "../src/agent-runtime.ts";

const exec = promisify(execFile);

function fakeRuntime(handler: (input: Parameters<ApertaCodingRuntime["run"]>[0]) => Promise<string> | string): ApertaCodingRuntime {
  const provenance: RunProvenance = { engineId: "local-cli", adapterStrategy: "test-runtime-v1", runtime: "codex", runtimeVersion: "test-1.0", model: "test-model" };
  const status = async (kind: Parameters<ApertaCodingRuntime["inspect"]>[0]) => ({ runtimeId: kind, availability: "installed" as const, verification: "ready" as const, version: "test-1.0", detail: "Test runtime is ready.", adapterStrategy: "test-runtime-v1", capabilities: ["structured-output", "local-workspace", "read-only-workspace", "workspace-write"], executionSupported: true });
  return {
    inspect: status,
    probe: status,
    async run(input): Promise<ApertaRuntimeResult> {
      await input.events?.emit({ type: "run.started", runId: input.runId, timestamp: new Date().toISOString(), scope: { tenantId: "local", projectId: input.projectId, principalId: "test", roles: ["owner"], permissions: ["workspace:read"], dataClassification: "confidential" }, provenance });
      await input.events?.emit({ type: "model.started", runId: input.runId, timestamp: new Date().toISOString(), scope: { tenantId: "local", projectId: input.projectId, principalId: "test", roles: ["owner"], permissions: ["workspace:read"], dataClassification: "confidential" }, step: 1 });
      const summary = await handler(input);
      return { summary, provenance, durationMs: 5, activityCount: 2, attempts: 1 };
    },
  };
}

test("agent context is compacted under an explicit provider-neutral input budget", () => {
  const files = Array.from({ length: 3_000 }, (_, index) => `src/generated/deep/path/Component${index}.java`);
  const transcript = Array.from({ length: 14 }, (_, index) => ({ action: { action: "read", path: files[index] }, result: { path: files[index], content: `${index}:${"x".repeat(119_000)}` } }));
  const prompt = buildAgentTranscriptPrompt("Inspect the relevant implementation and make the smallest safe correction.", files, transcript, []);
  const parsed = JSON.parse(prompt);
  assert.ok(prompt.length <= MAX_AGENT_INPUT_CHARS);
  assert.equal(parsed.context.compacted, true);
  assert.ok(parsed.repositoryFiles.length < files.length);
  assert.ok(parsed.recentToolResults.length < transcript.length);
  assert.match(JSON.stringify(parsed.recentToolResults.at(-1)), /context characters compacted/);
});

test("agent-v runtime results stay isolated and retain provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-cursor-runtime-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.txt"), "before\n");
  await exec("git", ["add", "app.txt"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const runtimeEngine = fakeRuntime(async ({ workspace }) => { await writeFile(join(workspace, "app.txt"), "after\n"); return "Updated the requested file."; });
  const run = await runExternalAgent(root, "Update the fixture through the coding runtime.", { kind: "codex", model: "test-model", command: "codex" }, undefined, { runtimeEngine });
  assert.equal(await readFile(join(root, "app.txt"), "utf8"), "before\n");
  assert.equal(run.status, "ready");
  assert.equal(run.provider, "codex");
  assert.equal(run.files[0]?.path, "app.txt");
  assert.equal(run.actions.some((action) => action.action === "runtime"), true);
  assert.match(run.summary ?? "", /Updated the requested file/);
  assert.equal(run.provenance?.adapterStrategy, "test-runtime-v1");
  assert.equal(run.provenance?.runtimeVersion, "test-1.0");
});

test("external runtime answers skip verification and store a readable headline", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-external-answer-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await writeFile(join(root, "package.json"), `${JSON.stringify({ scripts: { test: "node -e \"console.error('SHOULD_NOT_RUN');process.exit(1)\"" } }, null, 2)}\n`);
  await exec("git", ["add", "app.ts", "package.json"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const runtimeEngine = fakeRuntime(() => `### Architecture\n**Answer:** The exported value is 41. ${"Explanation ".repeat(40)}`);
  const run = await runExternalAgent(root, "Explain the exported value without changing the repository.", { kind: "claude", model: "", command: "claude" }, undefined, { runtimeEngine });
  assert.equal(run.status, "no-changes");
  assert.equal(run.verification.baseline, undefined);
  assert.equal(run.actions.some((action) => action.action === "baseline" || action.action === "verify"), false);
  assert.doesNotMatch(run.understanding?.changedBehavior ?? "", /\*\*|`|###/);
  assert.ok((run.understanding?.changedBehavior.length ?? 0) <= 221);
});

test("read-only skills discard external runtime mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-external-skill-boundary-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await exec("git", ["add", "app.ts"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const runtimeEngine = fakeRuntime(async ({ workspace }) => { await writeFile(join(workspace, "app.ts"), "export const answer = 99;\n"); return "Explained the export."; });
  await assert.rejects(() => runExternalAgent(root, "Explain how the exported answer works.", { kind: "claude", model: "", command: "claude" }, undefined, { runtimeEngine }), /read-only.*attempted to modify/i);
  assert.equal(await readFile(join(root, "app.ts"), "utf8"), "export const answer = 41;\n");
});

test("external runtimes use Aperta for requested checks without receiving raw logs", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-external-check-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await writeFile(join(root, "package.json"), `${JSON.stringify({ scripts: { test: "node -e \"console.error('PRIVATE_TEST_DIAGNOSTIC');process.exit(1)\"" } }, null, 2)}\n`);
  await exec("git", ["add", "app.ts", "package.json"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const runtimeEngine = fakeRuntime(({ prompt }) => prompt.includes('"status":"failed"') && !prompt.includes("PRIVATE_TEST_DIAGNOSTIC") ? "Aperta ran the tests and recorded a failure. Open Checks for the local output." : "Unsafe or missing verification context.");
  const run = await runExternalAgent(root, "Run the tests and tell me whether they pass.", { kind: "claude", model: "", command: "claude" }, undefined, { runtimeEngine });
  assert.equal(run.status, "no-changes");
  assert.equal(run.verification.baseline?.status, "failed");
  assert.equal(run.actions.some((action) => action.action === "verify"), true);
  assert.equal(run.capabilities[0]?.kind, "project-check");
  assert.equal(run.capabilities[0]?.privacy, "local-full-provider-status");
  assert.match(run.summary ?? "", /Aperta ran the tests/i);
  assert.match(run.verification.baseline?.checks[0]?.output ?? "", /PRIVATE_TEST_DIAGNOSTIC/);
  const followUpPrompt = buildAgentTranscriptPrompt("Explain the prior result.", ["app.ts"], [], [run]);
  assert.doesNotMatch(followUpPrompt, /PRIVATE_TEST_DIAGNOSTIC/);
  assert.match(followUpPrompt, /Complete output remains local in Aperta/);
});

test("external runtimes receive an observed localhost service status", async () => {
  const service = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  const address = service.address(); if (!address || typeof address === "string") throw new Error("Test service did not bind");
  const root = await mkdtemp(join(tmpdir(), "aperta-external-probe-"));
  try {
    await exec("git", ["init", "-q"], { cwd: root });
    await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
    await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
    await writeFile(join(root, "application.yml"), `app:\n  redis:\n    port: \${REDIS_PORT:${address.port}}\n`);
    await exec("git", ["add", "application.yml"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
    const runtimeEngine = fakeRuntime(({ prompt }) => prompt.includes('"label":"Redis status"') && prompt.includes('"status":"reachable"') ? "Redis is accepting local connections on the configured port." : "No live status was provided.");
    const run = await runExternalAgent(root, "Is Redis currently running and reachable?", { kind: "claude", model: "", command: "claude" }, undefined, { runtimeEngine });
    assert.equal(run.status, "no-changes");
    assert.equal(run.actions.some((action) => action.action === "probe" && action.evidenceStatus === "reachable"), true);
    assert.equal(run.capabilities[0]?.kind, "service-probe");
    assert.match(run.summary ?? "", /accepting local connections/i);

    const nativeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const grounded = body.messages[1].content.includes("harnessCapabilityEvidence") && body.messages[1].content.includes('"status":"reachable"');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: "finish", summary: grounded ? "Aperta Native observed Redis accepting local connections." : "No service evidence was available." }) } }] }), { status: 200 });
    };
    const native = await runModelAgent(root, "Is Redis currently running and reachable?", { provider: "openai", model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" }, undefined, nativeFetch as typeof fetch);
    assert.equal(native.capabilities[0]?.status, "reachable");
    assert.match(native.summary ?? "", /Native observed Redis/i);
  } finally {
    await new Promise<void>((resolve) => service.close(() => resolve()));
  }
});

test("agent-v failure codes map into Aperta reliability classes", () => {
  assert.equal(classifyAgentError(new AgentVError("authentication-required", "Authentication is not ready.")), "ProviderError");
  assert.equal(classifyAgentError(new AgentVError("timeout", "The runtime exceeded its bound.")), "Timeout");
  assert.equal(classifyAgentError(new AgentVError("unsupported-capability", "Read-only access cannot be enforced.")), "InvalidArguments");
});

test("failed verification evidence survives into the next conversation turn", () => {
  const previous = {
    id: "previous", conversationId: "conversation-1234567890", turnIndex: 1, intent: "Make the change", status: "verification-failed", summary: "Implemented it",
    files: [{ path: "app.ts", added: 1, removed: 1, hunks: 1 }],
    verification: { status: "failed", plan: ["npm test"], attempts: [{ index: 1, ts: new Date().toISOString(), status: "failed", checks: [{ id: "test", label: "Tests", command: "npm test", status: "failed", exitCode: 1, durationMs: 10, output: "TypeError: expected 42 but received 0" }] }] },
    contract: { criteria: [], steps: [] },
  };
  const prompt = JSON.parse(buildAgentTranscriptPrompt("Fix the failing test from the prior turn.", ["app.ts"], [], [previous as any]));
  assert.equal(prompt.conversation[0].failedVerification.source, "previous-turn");
  assert.match(prompt.conversation[0].failedVerification.checks[0].output, /expected 42/);
});

test("question-only model turns skip the repository baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-baseline-context-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await writeFile(join(root, "package.json"), `${JSON.stringify({ scripts: { test: "node -e \"console.error('BASELINE_DIAGNOSTIC');process.exit(1)\"" } }, null, 2)}\n`);
  await exec("git", ["add", "app.ts", "package.json"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  let firstPrompt = "";
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); firstPrompt ||= body.messages[1].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: "finish", summary: "No change needed." }) } }] }), { status: 200 });
  };
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  const run = await runModelAgent(root, "Explain what this repository exports without changing it.", config, undefined, fakeFetch as typeof fetch);
  assert.equal(run.status, "no-changes");
  assert.equal(run.verification.baseline, undefined);
  assert.equal(run.actions.some((action) => action.action === "baseline"), false);
  assert.doesNotMatch(firstPrompt, /BASELINE_DIAGNOSTIC/);
});

test("Aperta Native routes explicit test requests before model reasoning", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-native-check-router-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await writeFile(join(root, "package.json"), `${JSON.stringify({ scripts: { test: "node -e \"console.error('PRIVATE_NATIVE_DIAGNOSTIC');process.exit(1)\"" } }, null, 2)}\n`);
  await exec("git", ["add", "app.ts", "package.json"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  let routed = false;
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); const prompt = body.messages[1].content;
    routed = prompt.includes("harnessCapabilityEvidence") && prompt.includes('"status":"failed"') && !prompt.includes("PRIVATE_NATIVE_DIAGNOSTIC");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: "finish", summary: routed ? "Aperta ran the tests and observed a failure." : "No routed evidence." }) } }] }), { status: 200 });
  };
  const run = await runModelAgent(root, "Run the tests and report whether they pass.", { provider: "openai", model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" }, undefined, fakeFetch as typeof fetch);
  assert.equal(routed, true);
  assert.equal(run.capabilities[0]?.kind, "project-check");
  assert.equal(run.capabilities[0]?.status, "failed");
  assert.match(run.verification.baseline?.checks[0]?.output ?? "", /PRIVATE_NATIVE_DIAGNOSTIC/);
});

test("agent executes a bounded localhost curl probe and observes its output", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-curl-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.txt"), "local probe fixture\n"); await exec("git", ["add", "app.txt"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end('{"accepted":true}'); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Test server did not bind");
  const actions = [
    { action: "run", command: "curl", args: ["--request", "POST", "--header", "Content-Type: application/json", "--data", '{"email":"user@example.com"}', `http://127.0.0.1:${address.port}/api/login`], reason: "Exercise the local login endpoint." },
    { action: "finish", summary: "The live local login probe returned an accepted response." },
  ];
  const prompts: string[] = []; let call = 0;
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => { const body = JSON.parse(String(init?.body)); prompts.push(body.messages[1].content); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions[call++]) } }] }), { status: 200 }); };
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  try {
    const run = await runModelAgent(root, "Run a live curl request against the local login endpoint.", config, undefined, fakeFetch as typeof fetch);
    assert.equal(run.actions.some((action) => action.action === "run" && action.status === "success"), true);
    assert.match(prompts[1], /accepted/);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("agent curl tool refuses remote targets without making a request", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-curl-remote-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, "app.txt"), "remote probe fixture\n"); await exec("git", ["add", "app.txt"], { cwd: root });
  const actions = [{ action: "run", command: "curl", args: ["https://example.com/"], reason: "Attempt a remote request." }, { action: "finish", summary: "Remote requests are outside the bounded harness." }];
  let call = 0;
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions[call++]) } }] }), { status: 200 });
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  const run = await runModelAgent(root, "Try a curl request and respect the harness network boundary.", config, undefined, fakeFetch as typeof fetch);
  assert.equal(run.actions.find((action) => action.action === "run")?.errorClass, "InvalidArguments");
});

test("agent starts a detected application, probes it, and stops it at run end", async () => {
  const portServer = createServer(); await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const portAddress = portServer.address(); if (!portAddress || typeof portAddress === "string") throw new Error("Could not reserve test port"); const port = portAddress.port;
  await new Promise<void>((resolve) => portServer.close(() => resolve()));
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-service-"));
  await exec("git", ["init", "-q"], { cwd: root }); await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root }); await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "server.js"), `import { createServer } from "node:http"; createServer((_req,res)=>{res.end("SERVICE_READY")}).listen(${port},"127.0.0.1");\n`);
  await writeFile(join(root, "package.json"), `${JSON.stringify({ scripts: { start: "node server.js" } }, null, 2)}\n`);
  await exec("git", ["add", "server.js", "package.json"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const actions = [
    { action: "service", operation: "start", service: "application", port, reason: "Start the detected application for a live probe." },
    { action: "run", command: "curl", args: [`http://127.0.0.1:${port}/health`], reason: "Verify the running application." },
    { action: "finish", summary: "Started the application and verified its live health response." },
  ];
  const prompts: string[] = []; let call = 0;
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => { const body = JSON.parse(String(init?.body)); prompts.push(body.messages[1].content); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions[call++]) } }] }), { status: 200 }); };
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  const run = await runModelAgent(root, "Start the detected application and verify its health endpoint live.", config, undefined, fakeFetch as typeof fetch);
  const serviceAction = run.actions.find((action) => action.action === "service");
  assert.equal(serviceAction?.status, "success");
  assert.equal(serviceAction?.evidenceStatus, "healthy");
  assert.equal(serviceAction?.command, "npm run start");
  const curlAction = run.actions.find((action) => action.action === "run");
  assert.equal(curlAction?.evidenceStatus, "passed");
  assert.match(curlAction?.output ?? "", /SERVICE_READY/);
  assert.match(prompts[2], /SERVICE_READY/);
  await assert.rejects(() => exec("curl", ["--max-time", "1", `http://127.0.0.1:${port}/health`]));
});

test("model agent edits only a disposable worktree until explicit promotion", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-root-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await exec("git", ["add", "app.ts"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const actions = [
    { action: "read", path: "app.ts", reason: "Inspect the requested implementation." },
    { action: "write", path: "app.ts", content: "export const answer = 42;\n", reason: "Implement the requested correction." },
    { action: "finish", summary: "Corrected the exported answer." },
  ];
  let call = 0;
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions[call++]) } }] }), { status: 200 });
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  const run = await runModelAgent(root, "Change the exported answer from 41 to 42.", config, undefined, fakeFetch as typeof fetch);
  assert.equal(run.status, "ready");
  assert.equal(await readFile(join(root, "app.ts"), "utf8"), "export const answer = 41;\n");
  assert.match(run.patch, /answer = 42/);
  assert.ok(run.evidenceGraph?.nodes.some((node) => node.kind === "file" && node.path === "app.ts"));
  assert.ok(run.evidenceGraph?.nodes.some((node) => node.kind === "action"));
  assert.equal(run.understanding?.questions.length, 4);
  const responses = {
    trace: "The exported value flows directly from app.ts to its module consumer.",
    evidence: "The patch proves the constant changed, while runtime consumers remain outside this fixture.",
    debug: "I would inspect app.ts and the first failing consumer assertion before changing behavior.",
    modify: "I can safely revise the constant and then rerun the repository verification plan.",
  };
  const understood = await saveAgentUnderstanding(root, run.id, responses);
  assert.ok(understood.understanding?.completedAt);
  assert.deepEqual(understood.understanding?.responses, responses);
  await assert.rejects(() => applyAgentRun(root, run.id), /explicit human review/i);
  await applyAgentRun(root, run.id, { acceptUnverified: true });
  assert.equal(await readFile(join(root, "app.ts"), "utf8"), "export const answer = 42;\n");
});

test("follow-up turns stay in one conversation and build on its isolated patch", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-conversation-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await exec("git", ["add", "app.ts"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  const firstActions = [
    { action: "read", path: "app.ts", reason: "Inspect the value." },
    { action: "write", path: "app.ts", content: "export const answer = 42;\n", reason: "Make the first change." },
    { action: "finish", summary: "Changed the answer to 42." },
  ];
  let firstCall = 0;
  const firstFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(firstActions[firstCall++]) } }] }), { status: 200 });
  const first = await runModelAgent(root, "Change the exported answer to 42.", config, undefined, firstFetch as typeof fetch);
  let malformedCalls = 0;
  const malformedFetch = async () => { malformedCalls++; return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"read"' } }] }), { status: 200 }); };
  await assert.rejects(() => runModelAgent(root, "Continue this task but simulate a truncated provider response.", config, undefined, malformedFetch as typeof fetch, { conversationId: first.conversationId, previousRuns: [first] }), /after an automatic retry/);
  assert.equal(malformedCalls, 2);
  const history = (await listAgentConversations(root))[0].runs;
  await writeFile(join(root, "note.txt"), "unrelated newer repository work\n");
  const secondActions = [
    { action: "read", path: "app.ts", reason: "Inspect the prior turn." },
    { action: "write", path: "app.ts", content: "export const answer = 43;\n", reason: "Apply the follow-up." },
    { action: "finish", summary: "Changed the answer to 43." },
  ];
  let secondCall = 0;
  const secondFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(secondActions[secondCall++]) } }] }), { status: 200 });
  const second = await runModelAgent(root, "Now increase that same answer once more.", config, undefined, secondFetch as typeof fetch, { conversationId: first.conversationId, previousRuns: history });
  assert.equal(second.conversationId, first.conversationId);
  assert.equal(second.turnIndex, 3);
  assert.match(second.patch, /answer = 43/);
  assert.doesNotMatch(second.patch, /answer = 42/);
  assert.equal(await readFile(join(root, "app.ts"), "utf8"), "export const answer = 41;\n");
  assert.equal(await readFile(join(root, "note.txt"), "utf8"), "unrelated newer repository work\n");
  const conversations = await listAgentConversations(root);
  assert.equal(conversations.length, 1);
  assert.deepEqual(conversations[0].runs.map((run) => run.turnIndex), [1, 2, 3]);
});

test("agent verifies its patch and repairs a failing check before review", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-verify-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await writeFile(join(root, "package.json"), `${JSON.stringify({ scripts: { test: "node -e \"const fs=require('fs');process.exit(fs.readFileSync('app.ts','utf8').includes('42')?0:1)\"" } }, null, 2)}\n`);
  await exec("git", ["add", "app.ts", "package.json"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const actions = [
    { action: "read", path: "app.ts", reason: "Inspect the implementation." },
    { action: "write", path: "app.ts", content: "export const answer = 0;\n", reason: "Try the initial correction." },
    { action: "finish", summary: "Updated the exported answer." },
    { action: "write", path: "app.ts", content: "export const answer = 42;\n", reason: "Repair the value identified by verification." },
    { action: "run", check: "test", reason: "Confirm the focused repair before finishing." },
    { action: "finish", summary: "Corrected the answer and verified the project." },
  ];
  let call = 0;
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions[call++]) } }] }), { status: 200 });
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  const run = await runModelAgent(root, "Change the exported answer to the expected value.", config, undefined, fakeFetch as typeof fetch);
  assert.equal(run.status, "ready");
  assert.equal(run.verification.status, "passed");
  assert.equal(run.verification.baseline?.status, "failed");
  assert.deepEqual(run.verification.attempts.map((attempt) => attempt.status), ["failed", "passed"]);
  assert.equal(run.actions.some((action) => action.action === "run" && action.status === "success"), true);
  assert.equal(run.contract.status, "ready-for-review");
  assert.equal(run.contract.criteria.find((criterion) => criterion.method === "checks")?.status, "proven");
  assert.equal(run.promotion.status, "review-required");
  assert.equal(run.critique?.status, "warning");
  assert.equal(await readFile(join(root, "app.ts"), "utf8"), "export const answer = 41;\n");
});

test("agent retains a bounded repair budget after a long implementation", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-repair-budget-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await writeFile(join(root, "package.json"), `${JSON.stringify({ scripts: { test: "node -e \"const fs=require('fs');process.exit(fs.readFileSync('app.ts','utf8').includes('42')?0:1)\"" } }, null, 2)}\n`);
  await exec("git", ["add", "app.ts", "package.json"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const investigation = Array.from({ length: 46 }, (_, index) => ({ action: "read", path: "app.ts", reason: `Investigation step ${index + 1}.` }));
  const actions = [
    ...investigation,
    { action: "write", path: "app.ts", content: "export const answer = 0;\n", reason: "Try the initial implementation." },
    { action: "finish", summary: "Implemented the first attempt." },
    { action: "read", path: "app.ts", reason: "Inspect the compiler-guided repair target." },
    { action: "write", path: "app.ts", content: "export const answer = 42;\n", reason: "Repair the failing verification." },
    { action: "finish", summary: "Repaired and verified the implementation." },
  ];
  let call = 0;
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions[call++]) } }] }), { status: 200 });
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  const run = await runModelAgent(root, "Implement the expected answer after careful investigation.", config, undefined, fakeFetch as typeof fetch);
  assert.equal(run.status, "ready");
  assert.deepEqual(run.verification.attempts.map((attempt) => attempt.status), ["failed", "passed"]);
});

test("agent refuses to read or write harness internals", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-blocked-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export {};\n"); await exec("git", ["add", "app.ts"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: "write", path: ".comprehension/config.json", content: "{}", reason: "tamper" }) } }] }), { status: 200 });
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  await assert.rejects(() => runModelAgent(root, "Make a legitimate repository change safely.", config, undefined, fakeFetch as typeof fetch), /cannot modify harness/);
});

test("promotion refuses a patch when the repository changed after the run", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-stale-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const answer = 41;\n");
  await exec("git", ["add", "app.ts"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const actions = [
    { action: "read", path: "app.ts", reason: "Inspect the requested implementation." },
    { action: "write", path: "app.ts", content: "export const answer = 42;\n", reason: "Implement the requested correction." },
    { action: "finish", summary: "Corrected the exported answer." },
  ];
  let call = 0;
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions[call++]) } }] }), { status: 200 });
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  const run = await runModelAgent(root, "Change the exported answer from 41 to 42.", config, undefined, fakeFetch as typeof fetch);

  await writeFile(join(root, "app.ts"), "export const answer = 99;\n");
  await assert.rejects(() => applyAgentRun(root, run.id, { acceptUnverified: true }), /repository changed/i);
  assert.equal(await readFile(join(root, "app.ts"), "utf8"), "export const answer = 99;\n");
});

test("agent persists a model-authored execution contract and criterion evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-agent-contract-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@aperta.local"], { cwd: root });
  await exec("git", ["config", "user.name", "Aperta Test"], { cwd: root });
  await writeFile(join(root, "app.ts"), "export const enabled = false;\n");
  await exec("git", ["add", "app.ts"], { cwd: root }); await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  const actions = [
    { action: "read", path: "app.ts", reason: "Ground the plan in the implementation." },
    { action: "plan", goal: "Enable the exported feature flag.", steps: ["Update the exported flag without changing the module API."], acceptanceCriteria: [{ text: "The enabled export is true.", method: "diff" }], constraints: ["Preserve the export name."], risks: ["No automated checks are configured."] },
    { action: "write", path: "app.ts", content: "export const enabled = true;\n", reason: "Implement the planned behavior." },
    { action: "finish", summary: "Enabled the existing feature flag export." },
  ];
  let call = 0;
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions[call++]) } }] }), { status: 200 });
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  const run = await runModelAgent(root, "Enable the existing exported feature flag.", config, undefined, fakeFetch as typeof fetch);
  assert.equal(run.skill.id, "implement-proven-change");
  assert.equal(run.contract.source, "model");
  assert.equal(run.contract.goal, "Enable the exported feature flag.");
  assert.ok(run.contract.steps.some((step) => step.id === "skill-phase:verify"));
  assert.ok(run.contract.criteria.some((criterion) => criterion.id === "skill-proof:requested-outcome"));
  assert.equal(run.contract.criteria.find((criterion) => criterion.method === "diff")?.status, "supported");
  assert.equal(run.promotion.status, "review-required");
  assert.match(run.promotion.reason, /incomplete/i);
});
