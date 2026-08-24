import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyAgentError, listAgentRuns, type AgentErrorClass, type AgentRun } from "./agent-harness.ts";

export interface HarnessHealthReport {
  generatedAt: string;
  privacy: string;
  summary: { runs: number; completed: number; firstPassRate: number | null; repairRate: number | null; promotionRate: number | null; keepRate: number | null; keptLines: number; sampledLines: number; toolReliability: number | null; averageProviderLatencyMs: number | null };
  models: Array<{ key: string; provider: string; model: string; runs: number; completionRate: number; firstPassRate: number | null; repairRate: number | null; toolReliability: number | null; averageProviderLatencyMs: number | null }>;
  tools: Array<{ action: string; calls: number; errors: number; reliability: number; averageLatencyMs: number | null }>;
  errors: Array<{ class: AgentErrorClass; count: number; share: number }>;
  signals: Array<{ level: "healthy" | "warning" | "critical"; title: string; detail: string }>;
  recent: Array<{ id: string; ts: string; provider: string; model: string; intent: string; status: string; firstPass: boolean; repaired: boolean; promoted: boolean; errors: AgentErrorClass[] }>;
}

function rate(numerator: number, denominator: number): number | null { return denominator ? numerator / denominator : null; }
function average(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function completed(run: AgentRun) { return ["ready", "verification-failed", "no-changes", "applied"].includes(run.status); }
function firstPass(run: AgentRun) { return run.verification.status === "passed" && run.verification.attempts.length === 1; }
function repaired(run: AgentRun) { return run.verification.status === "passed" && run.verification.attempts.length > 1 && run.verification.attempts[0]?.status === "failed"; }

function addedLinesByPath(patch: string): Map<string, string[]> {
  const result = new Map<string, string[]>(); let path = "";
  for (const line of patch.split("\n")) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/); if (header) { path = header[2]; if (!result.has(path)) result.set(path, []); continue; }
    if (path && line.startsWith("+") && !line.startsWith("+++")) { const value = line.slice(1).trim(); if (value && value.length >= 3) result.get(path)!.push(value); }
  }
  return result;
}

async function approximateKeepRate(root: string, runs: AgentRun[]) {
  let keptLines = 0, sampledLines = 0;
  for (const run of runs.filter((candidate) => candidate.status === "applied" && candidate.patch)) {
    for (const [path, additions] of addedLinesByPath(run.patch)) {
      let content = ""; try { content = await readFile(join(root, path), "utf8"); } catch {}
      for (const line of additions) { sampledLines++; if (content.includes(line)) keptLines++; }
    }
  }
  return { keptLines, sampledLines, keepRate: rate(keptLines, sampledLines) };
}

function toolRows(runs: AgentRun[]) {
  const groups = new Map<string, { calls: number; errors: number; durations: number[] }>();
  for (const run of runs) for (const action of run.actions.filter((item) => item.action !== "finish")) {
    const group = groups.get(action.action) ?? { calls: 0, errors: 0, durations: [] }; group.calls++;
    if (action.status === "error") group.errors++; if (typeof action.durationMs === "number") group.durations.push(action.durationMs); groups.set(action.action, group);
  }
  return [...groups.entries()].map(([action, group]) => ({ action, calls: group.calls, errors: group.errors, reliability: group.calls ? (group.calls - group.errors) / group.calls : 1, averageLatencyMs: average(group.durations) })).sort((a, b) => b.calls - a.calls || a.action.localeCompare(b.action));
}

function errorRows(runs: AgentRun[]) {
  const counts = new Map<AgentErrorClass, number>();
  for (const run of runs) {
    const errors = run.telemetry?.errors?.length ? run.telemetry.errors : run.error ? [{ class: classifyAgentError(run.error) }] : [];
    for (const error of errors) counts.set(error.class, (counts.get(error.class) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [...counts.entries()].map(([errorClass, count]) => ({ class: errorClass, count, share: total ? count / total : 0 })).sort((a, b) => b.count - a.count);
}

function modelRows(runs: AgentRun[]) {
  const groups = new Map<string, AgentRun[]>(); for (const run of runs) { const key = `${run.provider} · ${run.model}`; groups.set(key, [...(groups.get(key) ?? []), run]); }
  return [...groups.entries()].map(([key, records]) => {
    const verified = records.filter((run) => run.verification.attempts.length), repairable = records.filter((run) => run.verification.attempts[0]?.status === "failed");
    const calls = records.flatMap((run) => run.actions.filter((action) => action.action !== "finish"));
    const providerLatencies = records.filter((run) => run.telemetry?.providerCalls).map((run) => run.telemetry.providerLatencyMs / run.telemetry.providerCalls);
    return { key, provider: records[0].provider, model: records[0].model, runs: records.length, completionRate: rate(records.filter(completed).length, records.length) ?? 0, firstPassRate: rate(verified.filter(firstPass).length, verified.length), repairRate: rate(repairable.filter(repaired).length, repairable.length), toolReliability: rate(calls.filter((action) => action.status !== "error").length, calls.length), averageProviderLatencyMs: average(providerLatencies) };
  }).sort((a, b) => b.runs - a.runs);
}

export async function buildHarnessHealth(root: string): Promise<HarnessHealthReport> {
  const runs = await listAgentRuns(root), verified = runs.filter((run) => run.verification.attempts.length), repairable = runs.filter((run) => run.verification.attempts[0]?.status === "failed"), promotable = runs.filter((run) => run.files.length && completed(run));
  const tools = toolRows(runs), errors = errorRows(runs), keep = await approximateKeepRate(root, runs);
  const providerLatencies = runs.filter((run) => run.telemetry?.providerCalls).map((run) => run.telemetry.providerLatencyMs / run.telemetry.providerCalls);
  const totalToolCalls = tools.reduce((sum, tool) => sum + tool.calls, 0), totalToolErrors = tools.reduce((sum, tool) => sum + tool.errors, 0);
  const unknownErrors = errors.find((error) => error.class === "HarnessBug")?.count ?? 0;
  const stateConflicts = errors.find((error) => error.class === "StateConflict")?.count ?? 0;
  const signals: HarnessHealthReport["signals"] = [];
  if (unknownErrors) signals.push({ level: "critical", title: "Unknown harness errors detected", detail: `${unknownErrors} error${unknownErrors === 1 ? "" : "s"} could not be assigned to an expected failure class and should be treated as a harness defect.` });
  if (stateConflicts) signals.push({ level: "warning", title: "Conversation state conflicts", detail: `${stateConflicts} run${stateConflicts === 1 ? "" : "s"} encountered repository changes while carrying work across turns. New runs now carry prior patches forward when they still apply cleanly.` });
  const reliability = rate(totalToolCalls - totalToolErrors, totalToolCalls);
  if (reliability !== null && reliability < .99) signals.push({ level: "warning", title: "Tool reliability below target", detail: `${(reliability * 100).toFixed(1)}% successful across ${totalToolCalls} recorded tool actions; the initial target is 99%.` });
  const firstPassRate = rate(verified.filter(firstPass).length, verified.length);
  if (firstPassRate !== null && firstPassRate < .6) signals.push({ level: "warning", title: "Low first-pass verification", detail: `${(firstPassRate * 100).toFixed(0)}% of verified runs passed without a repair cycle.` });
  if (!signals.length) signals.push({ level: "healthy", title: "No active harness regressions", detail: runs.length ? "Recorded reliability and verification signals are within their current local thresholds." : "Run the agent to begin building a local reliability baseline." });
  return {
    generatedAt: new Date().toISOString(), privacy: "Computed locally from private per-user run memory and current repository files. Raw prompts, source code, and credentials are not exported or stored in Git.",
    summary: { runs: runs.length, completed: runs.filter(completed).length, firstPassRate, repairRate: rate(repairable.filter(repaired).length, repairable.length), promotionRate: rate(runs.filter((run) => run.status === "applied").length, promotable.length), keepRate: keep.keepRate, keptLines: keep.keptLines, sampledLines: keep.sampledLines, toolReliability: reliability, averageProviderLatencyMs: average(providerLatencies) },
    models: modelRows(runs), tools, errors, signals,
    recent: runs.slice(0, 12).map((run) => ({ id: run.id, ts: run.createdAt, provider: run.provider, model: run.model, intent: run.intent, status: run.status, firstPass: firstPass(run), repaired: repaired(run), promoted: run.status === "applied", errors: [...new Set((run.telemetry?.errors ?? []).map((error) => error.class))] })),
  };
}
