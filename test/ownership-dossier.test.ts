import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvents, initializeStore, writeDiffEvidence } from "../src/ledger.ts";
import { loadOwnershipDossier, renderChangeBrief } from "../src/ownership-dossier.ts";
import type { LedgerEvent } from "../src/types.ts";

const exec = promisify(execFile);
const diffId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aperta-dossier-"));
  await exec("git", ["init", "-q", root]);
  await initializeStore(root);
  const base = { repo: "demo", branch: "main" };
  const events: LedgerEvent[] = [
    {
      ...base,
      id: "intent-1",
      ts: "2026-08-22T09:59:00.000Z",
      kind: "intent",
      prompt: "Require signed sessions before opening the account page.",
    },
    {
      ...base,
      id: diffId,
      ts: "2026-08-22T10:00:00.000Z",
      kind: "diff",
      authorship: "ai",
      model: "test-agent",
      intentId: "intent-1",
      fingerprint: "fingerprint-1",
      files: [
        { path: "src/auth.ts", added: 12, removed: 2, hunks: 1 },
        { path: "test/auth.test.ts", added: 8, removed: 0, hunks: 1 },
      ],
    },
    {
      ...base,
      id: "proof-1",
      ts: "2026-08-22T10:05:00.000Z",
      kind: "proof",
      diffId,
      runner: "npm",
      command: "npm test",
      status: "proven",
      exitCode: 0,
      durationMs: 82,
      output: "ok",
      coveredNodeIds: [],
    },
    {
      ...base,
      id: "ownership-1",
      ts: "2026-08-22T10:10:00.000Z",
      kind: "ownership-evidence",
      diffId,
      completedCount: 3,
      requiredCount: 3,
      answers: [
        { questionId: "trace", question: "Trace it", answer: "The route checks the signed session before loading the account.", kind: "trace", path: "src/auth.ts" },
        { questionId: "challenge", question: "Break it", answer: "An invalid signature stops the request before account data is read.", kind: "challenge", path: "src/auth.ts" },
        { questionId: "evidence", question: "Prove it", answer: "The test covers a bad signature but not an expired session.", kind: "evidence", path: "test/auth.test.ts" },
      ],
    },
    {
      ...base,
      id: "explanation-1",
      ts: "2026-08-22T10:10:01.000Z",
      kind: "explanation",
      diffId,
      text: "The account route now requires a valid signed session before it reads account data.",
      durationMs: 60_000,
    },
    {
      ...base,
      id: "complete-1",
      ts: "2026-08-22T10:10:02.000Z",
      kind: "session-complete",
      diffId,
      score: 3,
      durationMs: 60_000,
      evidenceCount: 3,
      hasExplanation: true,
    },
  ];
  await appendEvents(root, events);
  await writeDiffEvidence(root, diffId, "diff --git a/src/auth.ts b/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-export const open = true\n+export const open = signed\n");
  return root;
}

test("builds one dossier from change, proof, and human defense", async () => {
  const dossier = await loadOwnershipDossier(await fixture(), diffId, "2026-08-22T11:00:00.000Z");
  assert.equal(dossier.status, "proven");
  assert.equal(dossier.defense.completed, true);
  assert.equal(dossier.defense.answers.length, 3);
  assert.ok(dossier.evidence.some((item) => item.kind === "proof"));
  assert.ok(dossier.evidence.some((item) => item.kind === "human"));
  assert.equal(dossier.revision.fingerprint, "fingerprint-1");
});

test("compiles a cited change brief from the dossier", async () => {
  const dossier = await loadOwnershipDossier(await fixture(), diffId, "2026-08-22T11:00:00.000Z");
  const markdown = renderChangeBrief(dossier);
  assert.match(markdown, /^# Require signed sessions/m);
  assert.match(markdown, /## Evidence/);
  assert.match(markdown, /`src\/auth\.ts`/);
  assert.match(markdown, /## Engineer defense/);
  assert.match(markdown, /fingerprint-1/);
  assert.equal(markdown.includes("—"), false);
});
