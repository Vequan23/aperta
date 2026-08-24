import { randomUUID } from "node:crypto";

export type JobState = "queued" | "running" | "completed" | "failed" | "canceled";
export interface JobRecord { id: string; kind: "proof" | "probe" | "coach" | "agent"; state: JobState; label: string; createdAt: string; startedAt?: string; finishedAt?: string; result?: unknown; error?: string }
type InternalJob = JobRecord & { controller: AbortController };
const jobs = new Map<string, InternalJob>();

export function startJob(kind: JobRecord["kind"], label: string, task: (signal: AbortSignal) => Promise<unknown>): JobRecord {
  const job: InternalJob = { id: randomUUID(), kind, state: "queued", label, createdAt: new Date().toISOString(), controller: new AbortController() };
  jobs.set(job.id, job);
  queueMicrotask(async () => {
    if (job.controller.signal.aborted) return;
    job.state = "running"; job.startedAt = new Date().toISOString();
    try { job.result = await task(job.controller.signal); job.state = job.controller.signal.aborted ? "canceled" : "completed"; }
    catch (error) { job.state = job.controller.signal.aborted ? "canceled" : "failed"; job.error = error instanceof Error ? error.message : String(error); }
    job.finishedAt = new Date().toISOString();
  });
  return visible(job);
}

function visible(job: InternalJob): JobRecord { const { controller, ...record } = job; return record; }
export function getJob(id: string) { const job = jobs.get(id); return job ? visible(job) : undefined; }
export function cancelJob(id: string) { const job = jobs.get(id); if (!job || !["queued", "running"].includes(job.state)) return false; job.controller.abort(); job.state = "canceled"; job.finishedAt = new Date().toISOString(); return true; }
