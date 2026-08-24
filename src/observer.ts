import { appendEvent, eventBase, readLedger } from "./ledger.ts";
import { recordSnapshotDiff } from "./capture.ts";
import { createRepositorySnapshot, currentBranch, diffSnapshots, headSnapshot, type RepoSnapshot, type SnapshotDiff } from "./git.ts";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import type { DiffEvent } from "./types.ts";
import { privateCachePath } from "./storage.ts";

export interface ObserverStatus {
  state: "watching" | "grouping" | "captured" | "error";
  lastCheckedAt: string;
  lastCapturedAt?: string;
  error?: string;
  mode?: "embedded" | "daemon";
  branch?: string;
  pending?: { since: string; files: SnapshotDiff["files"]; changedLines: number };
}

export interface ObserverActivity {
  ts: string;
  type: "started" | "branch" | "grouping" | "captured" | "error" | "stopped";
  branch?: string;
  message: string;
  files?: SnapshotDiff["files"];
  diffId?: string;
  mode: "embedded" | "daemon";
}

const cachePath = (root: string, file: string) => privateCachePath(root, file);

export async function readObserverStatus(root: string): Promise<ObserverStatus | undefined> {
  try { return JSON.parse(await readFile(cachePath(root, "observer-status.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function readObserverActivity(root: string, limit = 80): Promise<ObserverActivity[]> {
  try {
    return (await readFile(cachePath(root, "observer-activity.jsonl"), "utf8")).split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as ObserverActivity).slice(-limit).reverse();
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export class UniversalGitObserver {
  private root: string;
  private quietMs: number;
  private pollMs: number;
  private baseline?: RepoSnapshot;
  private pending?: { snapshot: SnapshotDiff; sinceMs: number };
  private timer?: NodeJS.Timeout;
  private busy = false;
  private branch?: string;
  private mode: "embedded" | "daemon";
  private status: ObserverStatus = { state: "watching", lastCheckedAt: new Date(0).toISOString() };

  constructor(root: string, quietMs = 8_000, pollMs = 2_000, mode: "embedded" | "daemon" = "embedded") {
    this.root = root;
    this.quietMs = quietMs;
    this.pollMs = pollMs;
    this.mode = mode;
  }

  async start(): Promise<void> {
    await this.activity("started", `${this.mode === "daemon" ? "Background" : "Dashboard"} observer started.`);
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    if (this.mode === "embedded") this.timer.unref();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); void this.activity("stopped", `${this.mode === "daemon" ? "Background" : "Dashboard"} observer stopped.`); }
  getStatus(): ObserverStatus { return structuredClone(this.status); }

  private async saveStatus(status: ObserverStatus): Promise<void> {
    this.status = { ...status, mode: this.mode, branch: this.branch };
    await mkdir(cachePath(this.root, ""), { recursive: true });
    await writeFile(cachePath(this.root, "observer-status.json"), `${JSON.stringify(this.status, null, 2)}\n`, "utf8");
  }

  private async activity(type: ObserverActivity["type"], message: string, extra: Partial<ObserverActivity> = {}): Promise<void> {
    await mkdir(cachePath(this.root, ""), { recursive: true });
    const entry: ObserverActivity = { ts: new Date().toISOString(), type, branch: this.branch, message, mode: this.mode, ...extra };
    await appendFile(cachePath(this.root, "observer-activity.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
  }

  async tick(nowMs = Date.now()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const branch = await currentBranch(this.root);
      if (this.branch !== branch) {
        const previous = this.branch;
        this.branch = branch;
        this.baseline = undefined;
        this.pending = undefined;
        await this.activity("branch", previous ? `Branch changed from ${previous} to ${branch}; capture baseline reset.` : `Watching branch ${branch}.`);
      }
      const current = await createRepositorySnapshot(this.root);
      const events = await readLedger(this.root);
      const branchEvents = events.filter((event) => event.branch === branch);
      const alreadyCaptured = branchEvents.some((event) => event.kind === "diff" && event.resultTree === current.tree);
      if (alreadyCaptured) {
        this.baseline = current;
        this.pending = undefined;
        await this.saveStatus({ ...this.status, state: "watching", lastCheckedAt: new Date(nowMs).toISOString(), error: undefined, pending: undefined });
        return;
      }
      if (!this.baseline) {
        const lastObservedTree = branchEvents.filter((event): event is DiffEvent => event.kind === "diff" && Boolean(event.resultTree)).at(-1)?.resultTree;
        this.baseline = lastObservedTree ? { tree: lastObservedTree } : await headSnapshot(this.root);
      }
      const snapshot = await diffSnapshots(this.root, this.baseline, current);
      if (!snapshot.files.length) {
        this.pending = undefined;
        await this.saveStatus({ ...this.status, state: "watching", lastCheckedAt: new Date(nowMs).toISOString(), error: undefined, pending: undefined });
        return;
      }
      if (this.pending?.snapshot.fingerprint !== snapshot.fingerprint) {
        this.pending = { snapshot, sinceMs: nowMs };
        await this.activity("grouping", `Grouping ${snapshot.files.length} changed file${snapshot.files.length === 1 ? "" : "s"}.`, { files: snapshot.files });
      }
      const pending = { since: new Date(this.pending.sinceMs).toISOString(), files: snapshot.files, changedLines: snapshot.files.reduce((sum, file) => sum + file.added + file.removed, 0) };
      if (nowMs - this.pending.sinceMs < this.quietMs) {
        await this.saveStatus({ ...this.status, state: "grouping", lastCheckedAt: new Date(nowMs).toISOString(), error: undefined, pending });
        return;
      }
      const captured = await recordSnapshotDiff(this.root, snapshot, { authorship: "unknown", model: "universal-git-observer" });
      if (!captured.duplicate) {
        await appendEvent(this.root, { ...eventBase(this.root, await currentBranch(this.root)), kind: "confidence", diffId: captured.diff.id, score: null });
      }
      this.baseline = current;
      this.pending = undefined;
      await this.activity("captured", captured.duplicate ? "Change already captured by an agent adapter." : `Captured ${snapshot.files.length} stable changed file${snapshot.files.length === 1 ? "" : "s"}.`, { files: snapshot.files, diffId: captured.diff.id });
      await this.saveStatus({ state: "captured", lastCheckedAt: new Date(nowMs).toISOString(), lastCapturedAt: new Date(nowMs).toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.status.error !== message) await this.activity("error", message);
      await this.saveStatus({ ...this.status, state: "error", lastCheckedAt: new Date(nowMs).toISOString(), error: message });
    } finally {
      this.busy = false;
    }
  }
}
