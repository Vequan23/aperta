import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { activeModelConfig, activateModelProfile, assignModelRole, inspectAgentRuntime, inspectModelProvider, publicModelSettings, saveModelProfile } from "../src/settings.ts";

test("model profiles remain global and contain no credential material", async () => {
  const home = await mkdtemp(join(tmpdir(), "aperta-settings-"));
  const previous = process.env.APERTA_HOME;
  process.env.APERTA_HOME = home;
  try {
    const profile = await saveModelProfile({ provider: "ollama", model: "qwen2.5-coder", name: "Local Qwen", activate: true });
    await activateModelProfile(profile.id);
    const settings = await publicModelSettings();
    assert.equal(settings.activeCoachProfileId, profile.id);
    assert.equal(settings.activeProfileIds.builder, profile.id);
    await assignModelRole(profile.id, "verifier");
    assert.equal((await publicModelSettings()).activeProfileIds.verifier, profile.id);
    assert.equal(settings.profiles[0].credentialConfigured, true);
    assert.equal((await activeModelConfig())?.baseUrl, "http://127.0.0.1:11434");
    assert.equal(settings.providers.some((provider) => provider.id === "deepseek"), true);
    const raw = await readFile(join(home, "settings.json"), "utf8");
    assert.equal(raw.includes("apiKey"), false);
    assert.equal(raw.includes("SECRET"), false);
  } finally {
    if (previous === undefined) delete process.env.APERTA_HOME; else process.env.APERTA_HOME = previous;
  }
});

test("agent runtimes distinguish Aperta from an unavailable Cursor CLI", async () => {
  const aperta = await inspectAgentRuntime({ kind: "aperta", model: "", command: "cursor-agent" });
  const cursor = await inspectAgentRuntime({ kind: "cursor", model: "", command: "cursor-agent-that-does-not-exist" });
  assert.equal(aperta.available, true);
  assert.equal(cursor.available, false);
  assert.match(cursor.detail, /not installed|not on PATH/i);
});

test("provider inspection discovers models and verifies native tools", async () => {
  let calls = 0;
  const fakeFetch = async (url: string | URL | Request) => {
    calls++;
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "example/tool-model", name: "Tool Model", supported_parameters: ["tools", "tool_choice"], context_length: 128_000 }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "aperta_action", arguments: JSON.stringify({ action: "finish", summary: "connection ready" }) } }] } }] }), { status: 200 });
  };
  const result = await inspectModelProvider({ provider: "openrouter", model: "example/tool-model", apiKey: "temporary", baseUrl: "https://openrouter.ai/api/v1" }, fakeFetch as typeof fetch);
  assert.equal(calls, 2);
  assert.equal(result.models[0].nativeTools, true);
  assert.equal(result.models[0].contextWindow, 128_000);
  assert.equal(result.capabilities.nativeTools, true);
  assert.equal(result.capabilities.modelDiscovery, true);
});
