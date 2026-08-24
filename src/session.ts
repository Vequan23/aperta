import { spawn } from "node:child_process";
import { appendEvent, eventBase, initializeStore, readConfig } from "./ledger.ts";
import { createRepositorySnapshot, diffSnapshots, currentBranch } from "./git.ts";
import { promptConfidence } from "./prompt.ts";
import { recordSnapshotDiff } from "./capture.ts";
import type { ConfidenceScore, IntentEvent } from "./types.ts";

export interface AgentRunOptions {
  command: string;
  args: string[];
  intent?: string;
  model?: string;
  score?: ConfidenceScore;
}

function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

export async function runAgentSession(root: string, options: AgentRunOptions): Promise<number> {
  await initializeStore(root);
  const before = await createRepositorySnapshot(root);
  let intent: IntentEvent | undefined;
  if (options.intent) {
    intent = { ...eventBase(root, await currentBranch(root)), kind: "intent", prompt: options.intent };
    await appendEvent(root, intent);
  }
  console.log(`Aperta is observing ${options.command}. Work normally.`);
  const exitCode = await run(options.command, options.args, root);
  const after = await createRepositorySnapshot(root);
  const snapshot = await diffSnapshots(root, before, after);
  if (snapshot.files.length === 0) {
    console.log("Aperta: session ended with no code changes.");
    return exitCode;
  }
  const { diff, duplicate } = await recordSnapshotDiff(root, snapshot, { authorship: "ai", model: options.model, intentId: intent?.id });
  if (duplicate) {
    console.log("Aperta: this exact change was already captured.");
    return exitCode;
  }
  console.log(`Aperta captured ${snapshot.files.length} file${snapshot.files.length === 1 ? "" : "s"} from this session.`);
  const config = await readConfig(root);
  const score = options.score ?? await promptConfidence(config.ratingTimeoutSeconds);
  await appendEvent(root, { ...eventBase(root, await currentBranch(root)), kind: "confidence", diffId: diff.id, score });
  console.log(score ? `Ownership signal recorded: ${score}/3.` : "Saved to the dashboard review queue.");
  return exitCode;
}
