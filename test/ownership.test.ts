import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendEvent, initializeStore, readConfig, readLedger, saveReviewIgnorePatterns, writeDiffEvidence } from "../src/ledger.ts";
import { loadDashboardState, loadOwnershipBrief, recordOwnershipReview, recordQueueDisposition } from "../src/dashboard-data.ts";

const exec = promisify(execFile);
const base = { repo: "demo", branch: "main", ts: "2026-08-22T00:00:00.000Z" };
const diffId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aperta-ownership-"));
  await exec("git", ["init", "-q", root]);
  await initializeStore(root);
  await appendEvent(root, { ...base, id: diffId, kind: "diff", authorship: "ai", model: "agent",
    files: [
      { path: "src/security/AuthController.java", added: 45, removed: 4, hunks: 2 },
      { path: "src/test/AuthControllerTest.java", added: 30, removed: 0, hunks: 1 },
    ] });
  await writeDiffEvidence(root, diffId, "diff --git a/src/security/AuthController.java b/src/security/AuthController.java\n+++ b/src/security/AuthController.java\n@@ -0,0 +1,2 @@\n+public class AuthController {\n+  public boolean authenticate() { return true; }\n");
  return root;
}

test("builds a risk-ranked change story from local evidence", async () => {
  const brief = await loadOwnershipBrief(await fixture(), diffId);
  assert.equal(brief.story.risk, "high");
  assert.match(brief.story.title, /sensitive path/);
  assert.equal(brief.story.testStatus, "1 test file changed");
  assert.ok(brief.story.symbols.includes("AuthController"));
  assert.equal(brief.questions.filter((question) => question.requiredForOwned).length, 3);
});

test("does not accept an unsubstantiated owned claim", async () => {
  const root = await fixture();
  await assert.rejects(() => recordOwnershipReview(root, { diffId, score: 3, explanation: "I understand this entire implementation completely." }), /Owned requires/);
  assert.equal((await readLedger(root)).some((event) => event.kind === "review"), false);
});

test("records structured evidence for demonstrated ownership", async () => {
  const root = await fixture();
  const answers = [
    { questionId: "trace", question: "Trace it", answer: "The controller validates the incoming request before calling authentication.", path: "src/security/AuthController.java", kind: "trace" as const },
    { questionId: "challenge", question: "Break it", answer: "A missing signing dependency would make token authentication fail closed.", path: "src/security/AuthController.java", kind: "challenge" as const },
    { questionId: "evidence", question: "Prove it", answer: "The test proves accepted credentials but does not cover an expired token.", path: "src/test/AuthControllerTest.java", kind: "evidence" as const },
  ];
  await recordOwnershipReview(root, { diffId, score: 3, explanation: "Authentication now validates requests through the controller and fails closed when its dependency is unavailable.", answers });
  const events = await readLedger(root);
  const evidence = events.find((event) => event.kind === "ownership-evidence");
  assert.equal(evidence?.completedCount, 3);
  assert.equal(events.find((event) => event.kind === "confidence")?.score, 3);
  assert.equal(events.find((event) => event.kind === "session-complete")?.score, 3);
});

test("a completed low-confidence session leaves the queue and enters the journal", async () => {
  const root = await fixture();
  await recordOwnershipReview(root, { diffId, score: 1, durationMs: 42_000, answers: [
    { questionId: "trace", question: "Trace it", answer: "The controller receives the request, but I cannot yet trace the downstream dependency.", path: "src/security/AuthController.java", kind: "trace" },
  ] });
  const state = await loadDashboardState(root);
  assert.equal(state.queue.some((item) => item.diffId === diffId), false);
  const session = state.sessions.find((item) => item.diffId === diffId);
  assert.equal(session?.reviewed, true);
  assert.equal(session?.notes.length, 0);
  assert.equal(session?.evidence.length, 1);
  assert.equal(session?.completions.length, 1);
  const learn = state.learnNext.find((item) => item.diffId === diffId);
  assert.ok(learn);
  assert.equal(learn.due, false);
  assert.equal(learn.label, "Strengthen this understanding");
});

test("review queue shows the newest change first", async () => {
  const root = await fixture();
  const newerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await appendEvent(root, { ...base, id: newerId, ts: "2026-08-22T14:35:00.000Z", kind: "diff", authorship: "unknown", files: [{ path: "src/Newer.java", added: 1, removed: 0, hunks: 1 }] });
  const state = await loadDashboardState(root);
  assert.deepEqual(state.queue.map((item) => item.diffId), [newerId, diffId]);
});

test("review regexes hide queue noise without deleting captured evidence", async () => {
  const root = await fixture();
  await saveReviewIgnorePatterns(root, [String.raw`(^|/)src/test/`, String.raw`(^|/)package-lock\.json$`]);
  const state = await loadDashboardState(root);
  assert.deepEqual(state.reviewSettings.ignorePatterns, [String.raw`(^|/)src/test/`, String.raw`(^|/)package-lock\.json$`]);
  assert.deepEqual(state.queue[0]?.files.map((file) => file.path), ["src/security/AuthController.java"]);
  assert.equal(state.queue[0]?.ignoredFileCount, 1);
  assert.equal(state.diffs[0]?.files.length, 2);
  assert.equal(state.sessions[0]?.files.length, 2);

  await saveReviewIgnorePatterns(root, [String.raw`^src/`]);
  assert.equal((await loadDashboardState(root)).queue.length, 0);
});

test("invalid review regexes fail without replacing the saved filters", async () => {
  const root = await fixture();
  await saveReviewIgnorePatterns(root, [String.raw`\.lock$`]);
  await assert.rejects(() => saveReviewIgnorePatterns(root, ["["]), /Invalid review ignore regex/);
  assert.deepEqual((await readConfig(root)).review.ignorePatterns, [String.raw`\.lock$`]);
});

test("consolidates older fully-overlapped captures into the latest review unit", async () => {
  const root = await fixture();
  const newerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await appendEvent(root, { ...base, id: newerId, ts: "2026-08-22T14:35:00.000Z", kind: "diff", authorship: "unknown", files: [
    { path: "src/security/AuthController.java", added: 2, removed: 1, hunks: 1 },
    { path: "src/test/AuthControllerTest.java", added: 3, removed: 0, hunks: 1 },
  ] });
  const state = await loadDashboardState(root);
  assert.deepEqual(state.queue.map((item) => item.diffId), [newerId]);
  assert.equal(state.queue[0]?.supersededCount, 1);
});

test("skip for now persists and rotates a review behind active work", async () => {
  const root = await fixture();
  const newerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await appendEvent(root, { ...base, id: newerId, ts: "2026-08-22T14:35:00.000Z", kind: "diff", authorship: "unknown", files: [{ path: "src/Newer.java", added: 1, removed: 0, hunks: 1 }] });
  await recordQueueDisposition(root, { diffId: newerId, action: "skip" });
  const state = await loadDashboardState(root);
  assert.deepEqual(state.queue.map((item) => item.diffId), [diffId, newerId]);
  assert.ok(state.queue[1]?.skippedAt);
});
