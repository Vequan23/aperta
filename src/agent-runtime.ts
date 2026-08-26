import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  defineOutput,
  type AgentEvent,
  type EventSink,
  type RunProvenance,
  type RuntimeReadiness,
} from "@vraxis/agent-v";
import {
  LocalCliRuntimeEngine,
  builtInRuntimes,
  type RuntimeVerificationStore,
} from "@vraxis/agent-v/local-cli";

export type ExternalAgentRuntimeKind = "codex" | "cursor" | "claude" | "opencode";

const runtimeIds: Record<ExternalAgentRuntimeKind, string> = {
  codex: "codex",
  cursor: "cursor",
  claude: "claude-code",
  opencode: "opencode",
};

const definitions = new Map(builtInRuntimes.map((runtime) => [runtime.id, runtime]));

function runtimeHome(): string {
  return process.env.APERTA_HOME ? resolve(process.env.APERTA_HOME) : join(homedir(), ".aperta");
}

function readinessFile(): string {
  return join(runtimeHome(), "runtime-readiness.json");
}

class FileRuntimeVerificationStore implements RuntimeVerificationStore {
  private writeQueue = Promise.resolve();

  private async read(): Promise<Record<string, RuntimeReadiness>> {
    try {
      const value = JSON.parse(await readFile(readinessFile(), "utf8"));
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async get(runtimeId: string): Promise<RuntimeReadiness | undefined> {
    return (await this.read())[runtimeId];
  }

  async set(runtimeId: string, readiness: RuntimeReadiness): Promise<void> {
    const write = async () => {
      const values = await this.read();
      values[runtimeId] = readiness;
      await mkdir(runtimeHome(), { recursive: true });
      const temporary = join(runtimeHome(), `runtime-readiness.${process.pid}.tmp`);
      await writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, readinessFile());
    };
    this.writeQueue = this.writeQueue.then(write, write);
    await this.writeQueue;
  }
}

export interface ApertaRuntimeStatus {
  runtimeId: string;
  availability: RuntimeReadiness["availability"];
  verification: RuntimeReadiness["verification"];
  version?: string;
  checkedAt?: string;
  durationMs?: number;
  detail: string;
  failureCode?: string;
  retryable?: boolean;
  adapterStrategy: string;
  capabilities: string[];
  executionSupported: boolean;
}

export interface ApertaRuntimeResult {
  summary: string;
  provenance: RunProvenance;
  durationMs: number;
  activityCount: number;
  attempts: number;
}

export interface ApertaCodingRuntime {
  inspect(kind: ExternalAgentRuntimeKind): Promise<ApertaRuntimeStatus>;
  probe(kind: ExternalAgentRuntimeKind, model?: string): Promise<ApertaRuntimeStatus>;
  run(input: {
    kind: ExternalAgentRuntimeKind;
    model?: string;
    workspace: string;
    workspaceAccess: "read-only" | "workspace-write";
    projectId: string;
    runId: string;
    prompt: string;
    abortSignal?: AbortSignal;
    events?: EventSink;
  }): Promise<ApertaRuntimeResult>;
}

function publicStatus(kind: ExternalAgentRuntimeKind, readiness: RuntimeReadiness): ApertaRuntimeStatus {
  const runtimeId = runtimeIds[kind];
  const definition = definitions.get(runtimeId);
  if (!definition) throw new Error(`agent-v runtime ${runtimeId} is not registered`);
  return {
    runtimeId,
    availability: readiness.availability,
    verification: readiness.verification,
    version: readiness.version,
    checkedAt: readiness.checkedAt,
    durationMs: readiness.durationMs,
    detail: readiness.detail,
    failureCode: readiness.failure?.code,
    retryable: readiness.failure?.retryable,
    adapterStrategy: definition.strategyId,
    capabilities: [...definition.capabilities],
    executionSupported: definition.capabilities.includes("structured-output"),
  };
}

function explainUnsupported(kind: ExternalAgentRuntimeKind, status: ApertaRuntimeStatus): ApertaRuntimeStatus {
  if (status.executionSupported) return status;
  const name = kind === "cursor" ? "Cursor Agent" : kind;
  return { ...status, detail: `${name} is ${status.availability === "installed" ? "installed" : "not ready"}, but its agent-v adapter cannot enforce structured execution.` };
}

export class AgentVRuntimeAdapter implements ApertaCodingRuntime {
  private readonly engine: LocalCliRuntimeEngine;

  constructor(engine = new LocalCliRuntimeEngine({
    verificationStore: new FileRuntimeVerificationStore(),
    timeoutMs: 75_000,
  })) {
    this.engine = engine;
  }

  async inspect(kind: ExternalAgentRuntimeKind): Promise<ApertaRuntimeStatus> {
    return explainUnsupported(kind, publicStatus(kind, await this.engine.inspect(runtimeIds[kind])));
  }

  async probe(kind: ExternalAgentRuntimeKind, model?: string): Promise<ApertaRuntimeStatus> {
    const installed = await this.inspect(kind);
    if (!installed.executionSupported) return installed;
    return publicStatus(kind, await this.engine.probe(runtimeIds[kind], model));
  }

  async run(input: Parameters<ApertaCodingRuntime["run"]>[0]): Promise<ApertaRuntimeResult> {
    const output = defineOutput({
      name: "aperta-runtime-result",
      jsonSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
        additionalProperties: false,
      },
      parse(value) {
        const summary = (value as { summary?: unknown })?.summary;
        if (typeof summary !== "string" || !summary.trim()) throw new Error("A non-empty summary is required");
        return { summary: summary.trim() };
      },
    });
    const result = await this.engine.run({
      runtimeId: runtimeIds[input.kind],
      runtimeModel: input.model,
      workspacePath: input.workspace,
      workspaceAccess: input.workspaceAccess,
      scope: {
        tenantId: "local",
        projectId: input.projectId,
        principalId: "local-founder",
        roles: ["owner"],
        permissions: input.workspaceAccess === "workspace-write" ? ["workspace:read", "workspace:write"] : ["workspace:read"],
        dataClassification: "confidential",
      },
      runId: input.runId,
      abortSignal: input.abortSignal,
      input: { prompt: input.prompt },
      output,
      maxAttempts: 2,
    }, input.events);
    return {
      summary: result.output.summary,
      provenance: result.provenance,
      durationMs: result.durationMs,
      activityCount: result.activityCount,
      attempts: result.attempts,
    };
  }
}

export function eventAction(event: AgentEvent): { action: string; detail: string; status?: "success" | "error" } | null {
  if (event.type === "model.started") return { action: "runtime", detail: `Runtime attempt ${event.step} started.` };
  if (event.type === "model.completed") return { action: "runtime", detail: `Runtime attempt ${event.step} completed.`, status: "success" };
  if (event.type === "run.failed") return { action: "runtime", detail: event.message, status: "error" };
  if (event.type === "status") return { action: "runtime", detail: event.message };
  return null;
}

export const agentVRuntime = new AgentVRuntimeAdapter();
