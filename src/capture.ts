import { appendEvent, eventBase, readLedger, writeDiffEvidence } from "./ledger.ts";
import { currentBranch, type SnapshotDiff } from "./git.ts";
import type { Authorship, DiffEvent } from "./types.ts";

export interface CaptureMetadata {
  authorship: Authorship;
  model?: string;
  intentId?: string;
}

export async function recordSnapshotDiff(root: string, snapshot: SnapshotDiff, metadata: CaptureMetadata): Promise<{ diff: DiffEvent; duplicate: boolean }> {
  const events = await readLedger(root);
  const existing = events.find((event): event is DiffEvent => event.kind === "diff" && event.fingerprint === snapshot.fingerprint);
  if (existing) return { diff: existing, duplicate: true };
  const diff: DiffEvent = {
    ...eventBase(root, await currentBranch(root)), kind: "diff", files: snapshot.files,
    fingerprint: snapshot.fingerprint, baseTree: snapshot.baseTree, resultTree: snapshot.resultTree,
    ...metadata,
  };
  await appendEvent(root, diff);
  await writeDiffEvidence(root, diff.id, snapshot.patch);
  return { diff, duplicate: false };
}
