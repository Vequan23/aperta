import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { recordSnapshotDiff } from "./capture.ts";
import { createRepositorySnapshot, diffSnapshots } from "./git.ts";
import { appendEvent, eventBase, initializeStore } from "./ledger.ts";
import { privateCachePath } from "./storage.ts";

function statePath(root: string, sessionId: string): string {
  const safe = createHash("sha256").update(sessionId).digest("hex");
  return privateCachePath(root, "sessions", `${safe}.json`);
}

export async function handleHarnessHook(root: string, action: "begin" | "end", sessionId: string): Promise<void> {
  await initializeStore(root);
  const path = statePath(root, sessionId);
  await mkdir(privateCachePath(root, "sessions"), { recursive: true });
  if (action === "begin") {
    await writeFile(path, JSON.stringify(await createRepositorySnapshot(root)), "utf8");
    return;
  }
  let before;
  try { before = JSON.parse(await readFile(path, "utf8")); } catch {
    before = await createRepositorySnapshot(root);
  }
  const after = await createRepositorySnapshot(root);
  const snapshot = await diffSnapshots(root, before, after);
  if (snapshot.files.length) {
    const { diff, duplicate } = await recordSnapshotDiff(root, snapshot, { authorship: "ai", model: "opencode" });
    if (!duplicate) await appendEvent(root, { ...eventBase(root, diff.branch), kind: "confidence", diffId: diff.id, score: null });
  }
  // Session idle can occur after every turn. The result becomes the next turn's baseline.
  await writeFile(path, JSON.stringify(after), "utf8");
}

export async function removeHarnessHookState(root: string, sessionId: string): Promise<void> {
  await rm(statePath(root, sessionId), { force: true });
}
