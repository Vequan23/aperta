import { appendDiffEventIfNew, eventBase, writeDiffEvidence } from "./ledger.ts";
import { currentBranch, type SnapshotDiff } from "./git.ts";
import type { Authorship, DiffEvent } from "./types.ts";

export interface CaptureMetadata {
  authorship: Authorship;
  model?: string;
  intentId?: string;
}

export async function recordSnapshotDiff(root: string, snapshot: SnapshotDiff, metadata: CaptureMetadata): Promise<{ diff: DiffEvent; duplicate: boolean }> {
  const diff: DiffEvent = {
    ...eventBase(root, await currentBranch(root)), kind: "diff", files: snapshot.files,
    fingerprint: snapshot.fingerprint, baseTree: snapshot.baseTree, resultTree: snapshot.resultTree,
    ...metadata,
  };
  const recorded = await appendDiffEventIfNew(root, diff);
  if (!recorded.inserted) return { diff: recorded.diff, duplicate: true };
  await writeDiffEvidence(root, diff.id, snapshot.patch);
  return { diff, duplicate: false };
}
