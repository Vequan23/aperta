import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { requestProviderAction, requestProviderJson, type CoachConfig, type CoachProvider } from "./coach.ts";
import { agentVRuntime, type ApertaCodingRuntime, type ExternalAgentRuntimeKind } from "./agent-runtime.ts";

const execFileAsync = promisify(execFile);
const providers = new Set<CoachProvider>(["openai", "anthropic", "google", "deepseek", "ollama", "openrouter", "groq", "openai-compatible"]);
const defaultBaseUrls: Record<CoachProvider, string> = {
  openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com/v1", google: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com", ollama: "http://127.0.0.1:11434", openrouter: "https://openrouter.ai/api/v1", groq: "https://api.groq.com/openai/v1", "openai-compatible": "",
};

export type ModelRole = "builder" | "coach" | "verifier";
export type AgentRuntimeKind = "aperta" | ExternalAgentRuntimeKind;
export interface AgentRuntimeConfig { kind: AgentRuntimeKind; model: string; command: string }
export interface AgentRuntimeStatus extends AgentRuntimeConfig {
  available: boolean;
  ready: boolean;
  supported: boolean;
  verification: "unverified" | "ready" | "failed" | "not-applicable";
  version?: string;
  checkedAt?: string;
  detail: string;
  failureCode?: string;
  adapterStrategy: string;
  capabilities: string[];
}
export interface ModelCapabilities { status: "untested" | "connected" | "degraded"; nativeTools: boolean; modelDiscovery: boolean; testedAt?: string; latencyMs?: number; detail?: string }
export interface ProviderModel { id: string; name: string; nativeTools?: boolean; contextWindow?: number }
export const providerCatalog = [
  { id: "openai", label: "OpenAI", description: "Direct OpenAI models with native tools.", category: "Direct", baseUrl: defaultBaseUrls.openai },
  { id: "anthropic", label: "Anthropic", description: "Claude models with native tool use.", category: "Direct", baseUrl: defaultBaseUrls.anthropic },
  { id: "google", label: "Google Gemini", description: "Gemini models through the Developer API.", category: "Direct", baseUrl: defaultBaseUrls.google },
  { id: "deepseek", label: "DeepSeek", description: "DeepSeek V4 models through the native OpenAI-compatible tool API.", category: "Direct", baseUrl: defaultBaseUrls.deepseek },
  { id: "openrouter", label: "OpenRouter", description: "A broad model catalog behind one tool-capable API.", category: "Gateway", baseUrl: defaultBaseUrls.openrouter },
  { id: "groq", label: "Groq", description: "Low-latency hosted open models with tool use.", category: "Gateway", baseUrl: defaultBaseUrls.groq },
  { id: "ollama", label: "Ollama", description: "Private models running on this machine.", category: "Local", baseUrl: defaultBaseUrls.ollama },
  { id: "openai-compatible", label: "Custom endpoint", description: "LM Studio, vLLM, Together, Fireworks, xAI, or another compatible API.", category: "Advanced", baseUrl: "" },
] as const;

export interface ModelProfile {
  id: string;
  name: string;
  provider: CoachProvider;
  model: string;
  baseUrl: string;
  credentialSource: "environment" | "keychain" | "none";
  toolTransport?: "native" | "json";
  capabilities?: ModelCapabilities;
}

interface GlobalSettings { version: 2; activeProfileIds: Partial<Record<ModelRole, string>>; profiles: ModelProfile[]; agentRuntime: AgentRuntimeConfig }

const defaultAgentRuntime: AgentRuntimeConfig = { kind: "aperta", model: "", command: "" };
const runtimeCommands: Record<AgentRuntimeKind, string> = { aperta: "", codex: "codex", cursor: "cursor-agent", claude: "claude", opencode: "opencode" };
const externalRuntimeKinds: ExternalAgentRuntimeKind[] = ["codex", "opencode", "claude", "cursor"];

function settingsDir(): string { return process.env.APERTA_HOME ? resolve(process.env.APERTA_HOME) : join(homedir(), ".aperta"); }
function settingsFile(): string { return join(settingsDir(), "settings.json"); }
function serviceName(id: string): string { return `dev.aperta.model.${id}`; }

function validateUrl(value: string): string {
  if (!value) throw new Error("A base URL is required for this provider");
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Remote model endpoints must use HTTPS");
  return url.toString().replace(/\/$/, "");
}

async function readRaw(): Promise<GlobalSettings> {
  try {
    const value = JSON.parse(await readFile(settingsFile(), "utf8"));
    const legacy = typeof value.activeCoachProfileId === "string" ? value.activeCoachProfileId : undefined;
    const rawRuntime = value.agentRuntime && typeof value.agentRuntime === "object" ? value.agentRuntime : {};
    const agentRuntime: AgentRuntimeConfig = {
      kind: externalRuntimeKinds.includes(rawRuntime.kind) ? rawRuntime.kind : "aperta",
      model: typeof rawRuntime.model === "string" ? rawRuntime.model.trim().slice(0, 160) : "",
      command: runtimeCommands[externalRuntimeKinds.includes(rawRuntime.kind) ? rawRuntime.kind as AgentRuntimeKind : "aperta"],
    };
    return { version: 2, activeProfileIds: value.activeProfileIds && typeof value.activeProfileIds === "object" ? value.activeProfileIds : legacy ? { builder: legacy, coach: legacy, verifier: legacy } : {}, profiles: Array.isArray(value.profiles) ? value.profiles : [], agentRuntime };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 2, activeProfileIds: {}, profiles: [], agentRuntime: { ...defaultAgentRuntime } };
    throw error;
  }
}

async function writeRaw(settings: GlobalSettings): Promise<void> {
  await mkdir(settingsDir(), { recursive: true });
  const temporary = join(settingsDir(), `settings.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, settingsFile());
}

async function keychainRead(id: string): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try { return (await execFileAsync("security", ["find-generic-password", "-w", "-s", serviceName(id), "-a", "api-key"], { maxBuffer: 64 * 1024 })).stdout.trim(); }
  catch { return null; }
}

async function keychainWrite(id: string, secret: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Secure credential storage is not available on this platform; use environment variables.");
  await execFileAsync("security", ["add-generic-password", "-U", "-s", serviceName(id), "-a", "api-key", "-w", secret], { maxBuffer: 64 * 1024 });
}

async function keychainDelete(id: string): Promise<void> {
  if (process.platform !== "darwin") return;
  try { await execFileAsync("security", ["delete-generic-password", "-s", serviceName(id), "-a", "api-key"], { maxBuffer: 64 * 1024 }); } catch {}
}

function environmentKey(provider: CoachProvider): string | undefined {
  if (process.env.APERTA_AI_API_KEY) return process.env.APERTA_AI_API_KEY;
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  if (provider === "google") return process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (provider === "deepseek") return process.env.DEEPSEEK_API_KEY;
  if (provider === "openrouter") return process.env.OPENROUTER_API_KEY;
  if (provider === "groq") return process.env.GROQ_API_KEY;
  return undefined;
}

export async function publicModelSettings() {
  const settings = await readRaw();
  const profiles = await Promise.all(settings.profiles.map(async (profile) => ({ ...profile, credentialConfigured: profile.provider === "ollama" || Boolean(environmentKey(profile.provider)) || Boolean(await keychainRead(profile.id)) })));
  const [agentRuntime, apertaRuntime, codexRuntime, opencodeRuntime, claudeRuntime, cursorRuntime] = await Promise.all([
    inspectAgentRuntime(settings.agentRuntime),
    inspectAgentRuntime({ kind: "aperta", model: "", command: "" }),
    inspectAgentRuntime({ kind: "codex", model: settings.agentRuntime.kind === "codex" ? settings.agentRuntime.model : "", command: "codex" }),
    inspectAgentRuntime({ kind: "opencode", model: settings.agentRuntime.kind === "opencode" ? settings.agentRuntime.model : "", command: "opencode" }),
    inspectAgentRuntime({ kind: "claude", model: settings.agentRuntime.kind === "claude" ? settings.agentRuntime.model : "", command: "claude" }),
    inspectAgentRuntime({ kind: "cursor", model: settings.agentRuntime.kind === "cursor" ? settings.agentRuntime.model : "", command: "cursor-agent" }),
  ]);
  return { activeCoachProfileId: settings.activeProfileIds.coach ?? null, activeProfileIds: settings.activeProfileIds, profiles, providers: providerCatalog, agentRuntime, agentRuntimes: [apertaRuntime, codexRuntime, opencodeRuntime, claudeRuntime, cursorRuntime], secureStorage: process.platform === "darwin" ? "macOS Keychain" : "environment only" };
}

export async function inspectAgentRuntime(config?: AgentRuntimeConfig, runtimeEngine: ApertaCodingRuntime = agentVRuntime): Promise<AgentRuntimeStatus> {
  const runtime = config ?? (await readRaw()).agentRuntime;
  if (runtime.kind === "aperta") return { ...runtime, available: true, ready: true, supported: true, verification: "ready", detail: "Aperta's bounded native tool loop is available.", adapterStrategy: "aperta-native-v1", capabilities: ["structured-output", "local-workspace", "read-only-workspace", "workspace-write"] };
  const shared = await runtimeEngine.inspect(runtime.kind);
  return { ...runtime, available: shared.availability === "installed", ready: shared.verification === "ready", supported: shared.executionSupported, verification: shared.verification, version: shared.version, checkedAt: shared.checkedAt, detail: shared.detail, failureCode: shared.failureCode, adapterStrategy: shared.adapterStrategy, capabilities: shared.capabilities };
}

export async function saveAgentRuntime(input: Partial<AgentRuntimeConfig>, runtimeEngine: ApertaCodingRuntime = agentVRuntime): Promise<AgentRuntimeStatus> {
  if (!input.kind || !["aperta", ...externalRuntimeKinds].includes(input.kind)) throw new Error("Choose a supported agent runtime");
  const settings = await readRaw();
  const runtime: AgentRuntimeConfig = { kind: input.kind, model: typeof input.model === "string" ? input.model.trim().slice(0, 160) : "", command: runtimeCommands[input.kind] };
  let status = await inspectAgentRuntime(runtime, runtimeEngine);
  if (runtime.kind !== "aperta") {
    if (!status.available) throw new Error(status.detail);
    if (!status.supported) throw new Error(status.detail);
    const probed = await runtimeEngine.probe(runtime.kind, runtime.model || undefined);
    status = { ...runtime, available: probed.availability === "installed", ready: probed.verification === "ready", supported: probed.executionSupported, verification: probed.verification, version: probed.version, checkedAt: probed.checkedAt, detail: probed.detail, failureCode: probed.failureCode, adapterStrategy: probed.adapterStrategy, capabilities: probed.capabilities };
    if (!status.ready) throw new Error(status.detail);
  }
  settings.agentRuntime = runtime; await writeRaw(settings); return status;
}

export async function activeAgentRuntime(): Promise<AgentRuntimeStatus> {
  return inspectAgentRuntime((await readRaw()).agentRuntime);
}

export async function saveModelProfile(input: Partial<ModelProfile> & { apiKey?: string; activate?: boolean }): Promise<ModelProfile> {
  if (!input.provider || !providers.has(input.provider)) throw new Error("Choose a supported model provider");
  if (!input.model?.trim()) throw new Error("Model ID is required");
  const settings = await readRaw();
  const id = input.id && /^[a-zA-Z0-9-]{8,80}$/.test(input.id) ? input.id : randomUUID();
  const existing = settings.profiles.find((profile) => profile.id === id);
  const baseUrl = validateUrl(input.baseUrl?.trim() || defaultBaseUrls[input.provider]);
  let credentialSource: ModelProfile["credentialSource"] = input.provider === "ollama" ? "none" : existing?.credentialSource ?? "environment";
  if (input.apiKey?.trim()) { await keychainWrite(id, input.apiKey.trim()); credentialSource = "keychain"; }
  const profile: ModelProfile = { id, name: input.name?.trim().slice(0, 80) || `${input.provider} · ${input.model.trim()}`, provider: input.provider, model: input.model.trim(), baseUrl, credentialSource, toolTransport: input.toolTransport ?? existing?.toolTransport ?? (input.provider === "openai-compatible" ? "json" : "native"), capabilities: input.capabilities ?? existing?.capabilities };
  settings.profiles = [profile, ...settings.profiles.filter((item) => item.id !== id)];
  if (input.activate || !settings.activeProfileIds.builder) settings.activeProfileIds.builder = id;
  if (input.activate || !settings.activeProfileIds.coach) settings.activeProfileIds.coach = id;
  if (!settings.activeProfileIds.verifier) settings.activeProfileIds.verifier = id;
  await writeRaw(settings);
  return profile;
}

export async function activateModelProfile(id: string): Promise<void> {
  const settings = await readRaw();
  if (!settings.profiles.some((profile) => profile.id === id)) throw new Error("Model profile not found");
  settings.activeProfileIds.coach = id; settings.activeProfileIds.builder = id; await writeRaw(settings);
}

export async function assignModelRole(id: string, role: ModelRole): Promise<void> {
  const settings = await readRaw();
  if (!settings.profiles.some((profile) => profile.id === id)) throw new Error("Model profile not found");
  if (!["builder", "coach", "verifier"].includes(role)) throw new Error("Unknown model role");
  settings.activeProfileIds[role] = id; await writeRaw(settings);
}

export async function deleteModelProfile(id: string): Promise<void> {
  const settings = await readRaw();
  if (!settings.profiles.some((profile) => profile.id === id)) throw new Error("Model profile not found");
  settings.profiles = settings.profiles.filter((profile) => profile.id !== id);
  for (const role of ["builder", "coach", "verifier"] as const) if (settings.activeProfileIds[role] === id) { const replacement = settings.profiles[0]?.id; if (replacement) settings.activeProfileIds[role] = replacement; else delete settings.activeProfileIds[role]; }
  await writeRaw(settings); await keychainDelete(id);
}

function providerHeaders(provider: CoachProvider, apiKey?: string): Record<string, string> {
  if (provider === "anthropic") return { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" };
  if (provider === "google") return { "x-goog-api-key": apiKey ?? "" };
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

async function inspectionKey(input: Partial<ModelProfile> & { apiKey?: string }): Promise<string | undefined> {
  if (input.apiKey?.trim()) return input.apiKey.trim();
  if (input.id) { const stored = await keychainRead(input.id); if (stored) return stored; }
  return input.provider ? environmentKey(input.provider) : undefined;
}

export async function inspectModelProvider(input: Partial<ModelProfile> & { apiKey?: string }, fetcher: typeof fetch = fetch): Promise<{ models: ProviderModel[]; capabilities: ModelCapabilities; baseUrl: string; testedModel: string }> {
  if (!input.provider || !providers.has(input.provider)) throw new Error("Choose a supported model provider");
  const baseUrl = validateUrl(input.baseUrl?.trim() || defaultBaseUrls[input.provider]);
  const apiKey = await inspectionKey(input);
  const local = ["127.0.0.1", "localhost", "::1"].includes(new URL(baseUrl).hostname);
  if (input.provider !== "ollama" && !(input.provider === "openai-compatible" && local) && !apiKey) throw new Error("Add an API key before testing this provider");
  const started = Date.now(); let discoveryError = ""; let models: ProviderModel[] = [];
  try {
    const url = input.provider === "ollama" ? `${baseUrl}/api/tags` : input.provider === "google" ? `${baseUrl}/models?pageSize=1000` : input.provider === "anthropic" ? `${baseUrl}/models?limit=1000` : `${baseUrl}/models`;
    const response = await fetcher(url, { headers: providerHeaders(input.provider, apiKey), signal: AbortSignal.timeout(12_000) });
    const text = await response.text(); if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 180)}`);
    const body = JSON.parse(text);
    const rows = input.provider === "ollama" ? body.models : input.provider === "google" ? body.models : body.data;
    models = (Array.isArray(rows) ? rows : []).map((row: any) => {
      const id = String(row.id ?? row.name ?? "").replace(/^models\//, "");
      const parameters = Array.isArray(row.supported_parameters) ? row.supported_parameters : [];
      return { id, name: String(row.display_name ?? row.displayName ?? row.name ?? row.id ?? id).replace(/^models\//, ""), nativeTools: parameters.length ? parameters.includes("tools") : undefined, contextWindow: Number(row.context_length ?? row.contextWindow ?? 0) || undefined };
    }).filter((model: ProviderModel) => model.id).sort((a: ProviderModel, b: ProviderModel) => a.name.localeCompare(b.name));
  } catch (error) { discoveryError = error instanceof Error ? error.message : String(error); }

  let nativeTools = false, toolError = "";
  if (input.model?.trim()) {
    const config: CoachConfig = { provider: input.provider, model: input.model.trim(), baseUrl, apiKey, toolTransport: "native" };
    try {
      const action = await requestProviderAction(config, "You are testing a model connection. Use the required tool.", "Return a finish action whose summary is connection ready.", undefined, fetcher, 300);
      nativeTools = action?.action === "finish";
      if (!nativeTools) toolError = "The model connected but did not honor the native action schema.";
    } catch (error) {
      toolError = error instanceof Error ? error.message : String(error);
      try {
        await requestProviderJson({ ...config, toolTransport: "json" }, "Return JSON only.", 'Return {"action":"finish","summary":"connection ready"}.', undefined, fetcher, 300);
      } catch (fallbackError) {
        throw new Error(`Connection failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
      }
    }
  } else if (discoveryError) throw new Error(`Model discovery failed: ${discoveryError}`);

  const detail = [nativeTools ? "Native tool calling verified." : input.model ? "Connected using structured JSON fallback." : "Choose a model to verify tool calling.", discoveryError ? `Model discovery unavailable: ${discoveryError}` : ""].filter(Boolean).join(" ");
  return { baseUrl, models, testedModel: input.model?.trim() ?? "", capabilities: { status: nativeTools || !toolError ? "connected" : "degraded", nativeTools, modelDiscovery: !discoveryError, testedAt: new Date().toISOString(), latencyMs: Date.now() - started, detail } };
}

export async function retestModelProfile(id: string, fetcher: typeof fetch = fetch): Promise<ModelProfile> {
  const settings = await readRaw();
  const profile = settings.profiles.find((item) => item.id === id);
  if (!profile) throw new Error("Model profile not found");
  const inspection = await inspectModelProvider(profile, fetcher);
  profile.baseUrl = inspection.baseUrl;
  profile.capabilities = inspection.capabilities;
  profile.toolTransport = inspection.capabilities.nativeTools ? "native" : "json";
  await writeRaw(settings);
  return profile;
}

export async function activeModelConfig(role: ModelRole = "builder"): Promise<CoachConfig | null> {
  const settings = await readRaw();
  const profile = settings.profiles.find((item) => item.id === (settings.activeProfileIds[role] ?? settings.activeProfileIds.builder ?? settings.activeProfileIds.coach));
  if (!profile) return null;
  const apiKey = await keychainRead(profile.id) ?? environmentKey(profile.provider);
  if (profile.provider !== "ollama" && !(profile.provider === "openai-compatible" && ["127.0.0.1", "localhost", "::1"].includes(new URL(profile.baseUrl).hostname)) && !apiKey) return null;
  return { provider: profile.provider, model: profile.model, baseUrl: profile.baseUrl, apiKey, toolTransport: profile.toolTransport };
}
