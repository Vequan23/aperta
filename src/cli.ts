#!/usr/bin/env node
import { appendEvent, auditLedger, eventBase, initializeStore, readConfig, readLedger, repairLedger } from "./ledger.ts";
import { captureWorkingDiff, currentBranch, findRepoRoot } from "./git.ts";
import { buildComprehensionMap, renderMap } from "./map.ts";
import { promptAuthorship, promptConfidence } from "./prompt.ts";
import { startDashboard } from "./dashboard-server.ts";
import { recordSnapshotDiff } from "./capture.ts";
import { runAgentSession } from "./session.ts";
import { handleHarnessHook } from "./hook.ts";
import { OpenCodeAdapter } from "./adapters/opencode.ts";
import { fileURLToPath } from "node:url";
import { readObserverStatus } from "./observer.ts";
import { readEngineInfo, runObserverDaemon, startEngine, stopEngine } from "./engine.ts";
import { registerProject } from "./registry.ts";
import { installLoginService, loginServiceInstalled, uninstallLoginService } from "./service.ts";
import type { Authorship, ConfidenceScore, DiffEvent } from "./types.ts";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { inspectStoragePrivacy, storageMigration } from "./storage.ts";

const HELP = `aperta — see which parts of your codebase you can actually explain

Usage:
  aperta init                         Set up private project memory outside Git
  aperta start                        Start the background repository observer
  aperta stop                         Stop the background repository observer
  aperta status                       Show observer health and pending activity
  aperta doctor [--repair]            Diagnose setup; back up and repair a damaged ledger
  aperta capture [--ai|--human|--mixed] [--score 1|2|3]
                                      Capture the current Git diff and rate it
  aperta run [--intent TEXT] -- COMMAND
                                      Observe an agent session automatically
  aperta rate [--score 1|2|3]         Rate the newest unrated diff
  aperta map                          Print the repository comprehension map
  aperta dashboard [--port 4173]     Open dashboard + universal Git observer
  aperta export                       Emit the ledger as a JSON array

Confidence: 1 opaque · 2 followable · 3 owned`;

const CLI_ENTRY = fileURLToPath(import.meta.url);

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function scoreFlag(args: string[]): ConfidenceScore | undefined {
  const raw = flagValue(args, "--score");
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (value !== 1 && value !== 2 && value !== 3) throw new Error("--score must be 1, 2, or 3");
  return value;
}

function authorshipFlag(args: string[]): Authorship | undefined {
  const selected = (["ai", "human", "mixed"] as const).filter((value) => args.includes(`--${value}`));
  if (selected.length > 1) throw new Error("Choose only one authorship flag");
  return selected[0];
}

async function context(): Promise<{ root: string; branch: string }> {
  const root = await findRepoRoot(process.cwd());
  return { root, branch: await currentBranch(root) };
}

async function init(): Promise<void> {
  const { root } = await context();
  const created = await initializeStore(root);
  await registerProject(root);
  const privacy = await inspectStoragePrivacy(root);
  console.log(created ? `Initialized Aperta project identity at ${privacy.repositoryIdentity}` : "Aperta is already initialized.");
  console.log(`Private memory: ${privacy.privateDirectory}`);
  const migration = storageMigration(root);
  if (migration?.migrated.length) console.log(`Privacy migration: moved ${migration.migrated.join(", ")} out of the repository without discarding history.`);
  if (privacy.trackedPrivatePaths.length) console.warn(`Privacy warning: ${privacy.trackedPrivatePaths.join(", ")} ${privacy.trackedPrivatePaths.length === 1 ? "is" : "are"} still present in Git history/index. Commit the deletion and review prior history before sharing this repository.`);
  const config = await readConfig(root);
  const adapter = new OpenCodeAdapter(root, CLI_ENTRY, process.execPath);
  if (await adapter.detect()) {
    await adapter.install(config.gate);
    console.log("Observer: OpenCode installed · automatic capture on session idle");
  } else {
    console.log("Observer: session wrapper ready · use `aperta run -- YOUR_AGENT`");
  }
  if (process.platform === "darwin") {
    await stopEngine(root);
    await installLoginService(root, CLI_ENTRY);
    console.log("Universal observer: running · restarts automatically after login");
  } else {
    const engine = await startEngine(root, CLI_ENTRY);
    console.log(`Universal observer: ${engine.alreadyRunning ? "already running" : "started in background"} · PID ${engine.pid}`);
  }
  console.log("Git fallback: ready · Explanation gate: off");
}

async function startObserver(): Promise<void> {
  const { root } = await context();
  await initializeStore(root);
  await registerProject(root);
  if (process.platform === "darwin") {
    await stopEngine(root);
    await installLoginService(root, CLI_ENTRY);
    console.log("Aperta observer started · automatic after login enabled");
  } else {
    const info = await startEngine(root, CLI_ENTRY);
    console.log(info.alreadyRunning ? `Aperta observer is already running · PID ${info.pid}` : `Aperta observer started · PID ${info.pid}`);
  }
}

async function stopObserver(): Promise<void> {
  const { root } = await context();
  const loginRemoved = await uninstallLoginService(root);
  const result = await stopEngine(root);
  if (!result.wasRunning && !loginRemoved) console.log("Aperta observer is not running.");
  else if (!result.wasRunning && loginRemoved) console.log("Aperta observer stopped · automatic login disabled.");
  else if (result.stopped) console.log("Aperta observer stopped.");
  else throw new Error("Observer did not stop cleanly; run `aperta doctor` to inspect private observer state");
}

async function observerStatus(): Promise<void> {
  const { root } = await context();
  const [engine, status, login] = await Promise.all([readEngineInfo(root), readObserverStatus(root), loginServiceInstalled(root)]);
  if (!engine.running) { console.log(`Aperta observer: stopped${login ? " · automatic login configured" : ""}`); return; }
  console.log(`Aperta observer: running · PID ${engine.pid} · ${status?.state ?? "starting"} · ${status?.branch ?? "branch pending"}${login ? " · starts at login" : ""}`);
  if (status?.pending) console.log(`Grouping: ${status.pending.files.length} files · ${status.pending.changedLines} changed lines`);
  if (status?.error) console.log(`Attention: ${status.error}`);
}

async function doctor(args: string[]): Promise<void> {
  const { root } = await context();
  const checks: Array<{ label: string; ok: boolean; detail: string }> = [];
  const has = async (path: string) => { try { await access(path); return true; } catch { return false; } };
  let ledger = await auditLedger(root);
  if (!ledger.valid && args.includes("--repair")) {
    const repaired = await repairLedger(root);
    console.log(`[ok] Recovery: preserved the original at ${repaired.backup} · recovered ${repaired.recovered} events`);
    ledger = await auditLedger(root);
  }
  checks.push({ label: "Repository", ok: true, detail: root });
  const privacy = await inspectStoragePrivacy(root);
  checks.push({ label: "Private memory", ok: !privacy.legacyPaths.length && !privacy.trackedPrivatePaths.length, detail: privacy.trackedPrivatePaths.length ? `${privacy.trackedPrivatePaths.join(", ")} remains Git-tracked; commit its deletion and audit repository history` : privacy.legacyPaths.length ? `${privacy.legacyPaths.join(", ")} remains inside the repository` : privacy.privateDirectory });
  checks.push({ label: "Ledger", ok: ledger.valid, detail: ledger.valid ? `${ledger.events} events · ${ledger.chained} integrity-chained · ${ledger.legacy} legacy` : ledger.error ?? "invalid" });
  const observer = await readObserverStatus(root);
  const engine = await readEngineInfo(root);
  checks.push({ label: "Observer", ok: engine.running || observer?.state === "watching", detail: engine.running ? `background PID ${engine.pid}` : observer?.state ?? "stopped" });
  const java = await has(join(root, "pom.xml")) || await has(join(root, "build.gradle")) || await has(join(root, "build.gradle.kts"));
  const node = await has(join(root, "package.json"));
  checks.push({ label: "Semantic adapter", ok: java || node, detail: java ? "JDK compiler · dependency resolution becomes complete after a successful project proof" : node ? "TypeScript compiler · JS/TS/JSX/TSX/Vue scripts" : "Universal Git analysis only" });
  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) console.log(`${check.ok ? "[ok]" : "[!]"} ${check.label}: ${check.detail}`);
  console.log(failed.length ? `\n${failed.length} issue${failed.length === 1 ? "" : "s"} need attention before release use.` : "\nAperta is ready for the ownership loop.");
  if (failed.length) process.exitCode = 1;
}

async function capture(args: string[]): Promise<void> {
  const { root, branch } = await context();
  await initializeStore(root);
  const snapshot = await captureWorkingDiff(root);
  if (snapshot.files.length === 0) {
    console.log("No staged, unstaged, or untracked changes to capture.");
    return;
  }
  console.log(`${snapshot.files.length} file${snapshot.files.length === 1 ? "" : "s"} · ${snapshot.files.reduce((n, f) => n + f.added, 0)}+ ${snapshot.files.reduce((n, f) => n + f.removed, 0)}−`);
  let authorship = authorshipFlag(args);
  if (!authorship) authorship = await promptAuthorship() ?? undefined;
  if (!authorship) throw new Error("Authorship is required. Pass --ai, --human, or --mixed in non-interactive use.");
  const { diff, duplicate } = await recordSnapshotDiff(root, snapshot, { authorship });
  if (duplicate) {
    console.log("This exact diff is already in the ledger; nothing duplicated.");
    return;
  }
  const config = await readConfig(root);
  const score = scoreFlag(args) ?? await promptConfidence(config.ratingTimeoutSeconds);
  await appendEvent(root, { ...eventBase(root, branch), kind: "confidence", diffId: diff.id, score });
  console.log(score ? `Captured and rated ${score}.` : "Captured; confidence left unrated.");
}

async function runAgent(args: string[]): Promise<void> {
  const separator = args.indexOf("--");
  if (separator < 0 || separator === args.length - 1) throw new Error("Usage: aperta run [--intent TEXT] [--model NAME] -- COMMAND [ARGS...]");
  const options = args.slice(0, separator);
  const command = args[separator + 1];
  const commandArgs = args.slice(separator + 2);
  const { root } = await context();
  const exitCode = await runAgentSession(root, { command, args: commandArgs, intent: flagValue(options, "--intent"), model: flagValue(options, "--model"), score: scoreFlag(options) });
  if (exitCode !== 0) process.exitCode = exitCode;
}

async function rate(args: string[]): Promise<void> {
  const { root, branch } = await context();
  const events = await readLedger(root);
  const rated = new Set(events.filter((e): e is import("./types.ts").ConfidenceEvent => e.kind === "confidence" && e.score !== null).map((e) => e.diffId));
  const diff = events.filter((e): e is DiffEvent => e.kind === "diff" && !rated.has(e.id)).at(-1);
  if (!diff) {
    console.log("No unrated diffs.");
    return;
  }
  console.log(`${diff.files.length} file${diff.files.length === 1 ? "" : "s"} from ${new Date(diff.ts).toLocaleString()}`);
  const config = await readConfig(root);
  const score = scoreFlag(args) ?? await promptConfidence(config.ratingTimeoutSeconds);
  await appendEvent(root, { ...eventBase(root, branch), kind: "confidence", diffId: diff.id, score });
  console.log(score ? `Rated ${score}.` : "Left unrated.");
}

async function map(): Promise<void> {
  const { root } = await context();
  const [events, config] = await Promise.all([readLedger(root), readConfig(root)]);
  console.log(renderMap(buildComprehensionMap(events, config.confidenceHalfLifeDays)));
}

async function dashboard(args: string[]): Promise<void> {
  const { root } = await context();
  await initializeStore(root);
  await registerProject(root);
  const rawPort = flagValue(args, "--port") ?? "4173";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be between 1 and 65535");
  await startDashboard(root, port, !args.includes("--no-open"));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command === "init") return init();
  if (command === "start") return startObserver();
  if (command === "stop") return stopObserver();
  if (command === "status") return observerStatus();
  if (command === "doctor") return doctor(args);
  if (command === "observe") {
    if (!args.includes("--daemon")) throw new Error("The observe command is reserved for the background engine");
    const { root } = await context();
    await initializeStore(root);
    return runObserverDaemon(root);
  }
  if (command === "capture") return capture(args);
  if (command === "run") return runAgent(args);
  if (command === "hook") {
    const [action, sessionId] = args;
    if ((action !== "begin" && action !== "end") || !sessionId) throw new Error("Invalid harness hook invocation");
    const { root } = await context();
    return handleHarnessHook(root, action, sessionId);
  }
  if (command === "rate") return rate(args);
  if (command === "map") return map();
  if (command === "dashboard") return dashboard(args);
  if (command === "export") {
    const { root } = await context();
    console.log(JSON.stringify(await readLedger(root), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main().catch((error: Error) => {
  console.error(`aperta: ${error.message}`);
  process.exitCode = 1;
});
