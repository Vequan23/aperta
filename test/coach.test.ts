import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeActionRequest, buildProviderRequest, generateCoachDebrief, normalizeDebrief, requestProviderAction, requestProviderJson, resolveCoachConfig } from "../src/coach.ts";

const rawDebrief = {
  orientation: "The request boundary now delegates authentication decisions to a changed service and leaves runtime behavior unproven.",
  focus: { title: "Follow the authentication boundary", why: "It connects the changed entry point to the highest-risk dependency.", path: "src/auth.ts" },
  questions: [
    { kind: "trace", text: "Trace a request from the route through the changed authentication service.", path: "src/auth.ts", rationale: "Tests control-flow understanding." },
    { kind: "challenge", text: "Which rejection path could silently accept an expired credential?", path: "src/auth.ts", rationale: "Tests failure-mode reasoning." },
    { kind: "evidence", text: "What does the changed test prove, and what remains unproven?", path: "test/auth.test.ts", rationale: "Tests evidence boundaries." },
    { kind: "debug", text: "Where would you inspect first if valid requests begin returning 401?", path: "src/auth.ts", rationale: "Tests operational recall." },
  ],
  uncertainties: ["No runtime proof has been executed."],
};

test("coach configuration detects major providers without persisting credentials", () => {
  assert.equal(resolveCoachConfig({ OPENAI_API_KEY: "secret" })?.provider, "openai");
  assert.equal(resolveCoachConfig({ ANTHROPIC_API_KEY: "secret" })?.provider, "anthropic");
  assert.equal(resolveCoachConfig({ GOOGLE_API_KEY: "secret" })?.provider, "google");
  assert.equal(resolveCoachConfig({ DEEPSEEK_API_KEY: "secret" })?.model, "deepseek-v4-flash");
  assert.equal(resolveCoachConfig({ APERTA_AI_PROVIDER: "ollama", APERTA_AI_MODEL: "qwen2.5-coder" })?.baseUrl, "http://127.0.0.1:11434");
  assert.equal(resolveCoachConfig({}), null);
});

test("openai-compatible adapter supports local and hosted model gateways", () => {
  const config = resolveCoachConfig({ APERTA_AI_PROVIDER: "openai-compatible", APERTA_AI_BASE_URL: "https://models.example/v1", APERTA_AI_MODEL: "provider/model", APERTA_AI_API_KEY: "key" });
  assert.ok(config);
  const request = buildProviderRequest(config, { diff: { files: [] }, patch: "" }, null);
  assert.equal(request.url, "https://models.example/v1/chat/completions");
  assert.equal((request.headers as Record<string, string>).authorization, "Bearer key");
});

test("local OpenAI-compatible servers do not require a fake API key", () => {
  const config = resolveCoachConfig({ APERTA_AI_PROVIDER: "openai-compatible", APERTA_AI_BASE_URL: "http://localhost:1234/v1", APERTA_AI_MODEL: "local-model" });
  assert.ok(config);
  const request = buildProviderRequest(config, { diff: { files: [] }, patch: "" }, null);
  assert.equal(request.headers.authorization, undefined);
});

test("coach rejects invented citations and enforces one question per ownership skill", () => {
  const debrief = normalizeDebrief({ ...rawDebrief, focus: { ...rawDebrief.focus, path: "invented.ts" }, questions: rawDebrief.questions.map((question) => ({ ...question, path: "invented.ts" })) }, ["src/auth.ts", "test/auth.test.ts"], { provider: "openai", model: "test-model" });
  assert.equal(debrief.focus.path, null);
  assert.ok(debrief.questions.every((question) => question.path === null));
  assert.deepEqual(debrief.questions.map((question) => question.kind), ["trace", "challenge", "evidence", "debug"]);
  assert.deepEqual(debrief.questions.map((question) => question.requiredForOwned), [true, true, true, false]);
});

test("provider output becomes questions but never an ownership verdict", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(rawDebrief) } }] }), { status: 200 });
  const result = await generateCoachDebrief({ diff: { files: [{ path: "src/auth.ts" }, { path: "test/auth.test.ts" }] }, patch: "+ changed" }, null, undefined, fakeFetch as typeof fetch, { OPENAI_API_KEY: "secret", APERTA_AI_MODEL: "test-model" });
  assert.equal(result.provider, "openai");
  assert.equal(result.questions.length, 4);
  assert.equal("score" in result, false);
  assert.equal("verdict" in result, false);
});

test("provider JSON parser tolerates surrounding model commentary", async () => {
  const action = { action: "write", path: "app.ts", content: "export const value = \"{safe}\";\n", reason: "Apply the requested edit." };
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: `Here is the action:\n\`\`\`json\n${JSON.stringify(action)}\n\`\`\`\nI will wait for the result.` } }] }), { status: 200 });
  const config = { provider: "openai-compatible" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  assert.deepEqual(await requestProviderJson(config, "system", "user", undefined, fakeFetch as typeof fetch), action);
});

test("provider JSON parser retries one truncated action with a larger output budget", async () => {
  const action = { action: "read", path: "app.ts", reason: "Inspect the implementation." };
  const requestedTokens: number[] = []; let calls = 0;
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); requestedTokens.push(body.max_tokens);
    const content = calls++ === 0 ? '{"action":"read"' : JSON.stringify(action);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  const config = { provider: "openai-compatible" as const, model: "test-model", baseUrl: "https://models.example/v1", apiKey: "test" };
  assert.deepEqual(await requestProviderJson(config, "system", "user", undefined, fakeFetch as typeof fetch, 2_000), action);
  assert.deepEqual(requestedTokens, [2_000, 4_000]);
});

test("remote plaintext model endpoints are refused", () => {
  assert.throws(() => resolveCoachConfig({ APERTA_AI_PROVIDER: "openai-compatible", APERTA_AI_BASE_URL: "http://models.example/v1", APERTA_AI_MODEL: "model", APERTA_AI_API_KEY: "key" }), /HTTPS/);
});

test("OpenAI actions use forced native function calling", async () => {
  const config = { provider: "openai" as const, model: "test-model", baseUrl: "https://api.openai.com/v1", apiKey: "test" };
  const request = buildNativeActionRequest(config, "system", "user");
  assert.ok(request);
  const body = request.body as any;
  assert.equal(body.tools[0].function.name, "aperta_action");
  assert.equal(body.tool_choice.function.name, "aperta_action");
  const action = { action: "read", path: "app.ts", reason: "Inspect it." };
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "aperta_action", arguments: JSON.stringify(action) } }] } }] }), { status: 200 });
  assert.deepEqual(await requestProviderAction(config, "system", "user", undefined, fakeFetch as typeof fetch), action);
});

test("Anthropic actions use forced native tool use", async () => {
  const config = { provider: "anthropic" as const, model: "test-model", baseUrl: "https://api.anthropic.com/v1", apiKey: "test" };
  const request = buildNativeActionRequest(config, "system", "user");
  assert.ok(request);
  const body = request.body as any;
  assert.equal(body.tools[0].name, "aperta_action");
  assert.deepEqual(body.tool_choice, { type: "tool", name: "aperta_action", disable_parallel_tool_use: true });
  const action = { action: "search", query: "answer", reason: "Locate it." };
  const fakeFetch = async () => new Response(JSON.stringify({ content: [{ type: "tool_use", name: "aperta_action", input: action }] }), { status: 200 });
  assert.deepEqual(await requestProviderAction(config, "system", "user", undefined, fakeFetch as typeof fetch), action);
});

test("Gemini actions use forced native function calling", async () => {
  const config = { provider: "google" as const, model: "test-model", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "test" };
  const request = buildNativeActionRequest(config, "system", "user");
  assert.ok(request);
  const body = request.body as any;
  assert.equal(body.tools[0].functionDeclarations[0].name, "aperta_action");
  assert.equal(body.toolConfig.functionCallingConfig.mode, "ANY");
  const action = { action: "finish", summary: "Inspection complete." };
  const fakeFetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "aperta_action", args: action } }] } }] }), { status: 200 });
  assert.deepEqual(await requestProviderAction(config, "system", "user", undefined, fakeFetch as typeof fetch), action);
});

test("OpenAI-compatible and Ollama providers retain the JSON fallback", () => {
  assert.equal(buildNativeActionRequest({ provider: "openai-compatible", model: "test", baseUrl: "http://localhost:1234/v1" }, "system", "user"), null);
  assert.ok(buildNativeActionRequest({ provider: "openai-compatible", model: "test", baseUrl: "http://localhost:1234/v1", toolTransport: "native" }, "system", "user"));
  assert.equal(buildNativeActionRequest({ provider: "ollama", model: "test", baseUrl: "http://localhost:11434" }, "system", "user"), null);
});

test("DeepSeek, OpenRouter, and Groq share the native OpenAI tool protocol", () => {
  for (const provider of ["deepseek", "openrouter", "groq"] as const) {
    const request = buildNativeActionRequest({ provider, model: "tool-model", baseUrl: "https://models.example/v1", apiKey: "test" }, "system", "user");
    assert.equal((request?.body as any).tools[0].function.name, "aperta_action");
    assert.equal((request?.body as any).tool_choice.function.name, "aperta_action");
  }
});
