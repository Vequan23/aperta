import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { appendEvent, eventBase, readLedger } from "./ledger.ts";
import { currentBranch } from "./git.ts";
import type { DiffEvent, ProofEvent } from "./types.ts";
import type { ImpactGraph } from "./impact.ts";
import { cleanExecutionOutput, safeEnvironment } from "./execution.ts";
import { privateCachePath } from "./storage.ts";

const execFileAsync = promisify(execFile);
const running = new Set<string>();

export interface ProofPlan {
  available: boolean;
  runner?: ProofEvent["runner"];
  command?: string;
  executable?: string;
  args?: string[];
  scope: string;
  tests: string[];
  coveredNodeIds: string[];
  proposedProbes: Array<{ id: string; label: string; reason: string }>;
}

async function exists(path: string) { try { await access(path); return true; } catch { return false; } }

function coveredNodes(graph: ImpactGraph) {
  const tests = new Set(graph.nodes.filter((node) => node.kind === "test").map((node) => node.id));
  return [...new Set([...tests, ...graph.edges.filter((edge) => edge.kind === "covers" && tests.has(edge.from)).map((edge) => edge.to)])];
}

export async function buildProofPlan(root: string, diff: DiffEvent, graph: ImpactGraph): Promise<ProofPlan> {
  const javaTests = diff.files.filter((file) => /(?:Test|Tests)\.java$/.test(file.path)).map((file) => basename(file.path, ".java")).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  const jsTests = diff.files.filter((file) => /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i.test(file.path)).map((file) => file.path);
  const proposedProbes = graph.unproven.map((label, index) => ({ id: `probe-${index + 1}`, label, reason: "No executed evidence currently covers this behavior." }));
  const base = { available: true, scope: "Relevant changed tests", tests: javaTests.length ? javaTests : jsTests, coveredNodeIds: coveredNodes(graph), proposedProbes };
  if (await exists(join(root, "pom.xml"))) {
    const wrapper = await exists(join(root, "mvnw"));
    const args = ["-q", ...(javaTests.length ? [`-Dtest=${javaTests.join(",")}`] : []), "test"];
    return { ...base, runner: "maven", executable: wrapper ? "./mvnw" : "mvn", args, command: `${wrapper ? "./mvnw" : "mvn"} ${args.join(" ")}`, scope: javaTests.length ? `${javaTests.length} changed Java test class${javaTests.length === 1 ? "" : "es"}` : "Full Maven test suite" };
  }
  if (await exists(join(root, "build.gradle")) || await exists(join(root, "build.gradle.kts"))) {
    const wrapper = await exists(join(root, "gradlew"));
    const args = ["test", ...javaTests.flatMap((name) => ["--tests", `*${name}`])];
    return { ...base, runner: "gradle", executable: wrapper ? "./gradlew" : "gradle", args, command: `${wrapper ? "./gradlew" : "gradle"} ${args.join(" ")}`, scope: javaTests.length ? `${javaTests.length} changed Java test class${javaTests.length === 1 ? "" : "es"}` : "Full Gradle test suite" };
  }
  if (await exists(join(root, "package.json"))) {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (!manifest.scripts?.test) return { ...base, available: false, scope: "No test script found" };
    const runner: ProofEvent["runner"] = await exists(join(root, "pnpm-lock.yaml")) ? "pnpm" : await exists(join(root, "yarn.lock")) ? "yarn" : "npm";
    const executable = runner;
    const args = runner === "npm" ? ["test"] : ["test"];
    return { ...base, runner, executable, args, command: `${runner} test`, scope: "Project test script" };
  }
  return { ...base, available: false, scope: "No supported Java or TypeScript test runner detected" };
}

export async function runProof(root: string, diff: DiffEvent, plan: ProofPlan, signal?: AbortSignal): Promise<ProofEvent> {
  if (!plan.available || !plan.runner || !plan.executable || !plan.args || !plan.command) throw new Error("No supported proof runner is available for this capture.");
  const key = `${root}:${diff.id}`;
  if (running.has(key)) throw new Error("Proof is already running for this capture.");
  running.add(key);
  const started = Date.now();
  let exitCode: number | null = 0;
  let output = "";
  try {
    const result = await execFileAsync(plan.executable, plan.args, { cwd: root, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024, env: safeEnvironment(), signal });
    output = `${result.stdout}${result.stderr}`;
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    exitCode = typeof failure.code === "number" ? failure.code : null;
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.killed ? "\nProof timed out after five minutes." : ""}`;
  } finally { running.delete(key); }
  if (signal?.aborted) throw new Error("Proof canceled");
  const event: ProofEvent = {
    ...eventBase(root, diff.branch || await currentBranch(root)), kind: "proof", diffId: diff.id, runner: plan.runner, command: plan.command,
    status: exitCode === 0 ? "proven" : exitCode === null ? "inconclusive" : "regressed", exitCode, durationMs: Date.now() - started,
    output: cleanExecutionOutput(output), coveredNodeIds: exitCode === 0 ? plan.coveredNodeIds : [],
  };
  await appendEvent(root, event);
  if (exitCode === 0 && plan.runner === "maven" && plan.executable) {
    const semanticDir = privateCachePath(root, "semantic");
    await mkdir(semanticDir, { recursive: true });
    try { await execFileAsync(plan.executable, ["-q", "dependency:build-classpath", `-Dmdep.outputFile=${join(semanticDir, "java-classpath.txt")}`], { cwd: root, timeout: 90_000, maxBuffer: 1024 * 1024, env: safeEnvironment(), signal }); } catch {}
  }
  return event;
}

export async function proofHistory(root: string, diffId: string): Promise<ProofEvent[]> {
  return (await readLedger(root)).filter((event): event is ProofEvent => event.kind === "proof" && event.diffId === diffId).sort((a, b) => b.ts.localeCompare(a.ts));
}

export function nodeVerdicts(graph: ImpactGraph, latest?: ProofEvent) {
  const covered = new Set(latest?.coveredNodeIds ?? []);
  return graph.nodes.map((node) => ({
    nodeId: node.id,
    verdict: latest?.status === "regressed" && graph.edges.some((edge) => edge.kind === "covers" && edge.to === node.id) ? "regressed"
      : covered.has(node.id) ? "proven" : node.status === "related" ? "inferred" : "unproven",
  }));
}
