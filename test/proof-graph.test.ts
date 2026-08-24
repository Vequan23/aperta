import assert from "node:assert/strict";
import test from "node:test";
import { buildRepositoryProofGraph } from "../src/proof-graph.ts";
import type { AgentRun } from "../src/agent-harness.ts";
import type { DiffEvent, LedgerEvent, OwnershipEvidenceEvent, ProofEvent } from "../src/types.ts";
import { selectAgentSkill } from "../src/skills.ts";

function run(id: string, ts: string, path: string, verification: "passed" | "unavailable" = "passed"): AgentRun {
  return {
    id, conversationId: id, turnIndex: 1, repo: "repo", intent: `Change ${path}`, status: "ready", provider: "test", model: "test", createdAt: ts, finishedAt: ts,
    files: [{ path, added: 1, removed: 0, hunks: 1 }], patch: "", actions: [], capabilities: [], skill: selectAgentSkill(`Change ${path}`),
    verification: { status: verification, plan: verification === "passed" ? ["npm test"] : [], attempts: verification === "passed" ? [{ index: 1, ts, status: "passed", checks: [{ id: "test", label: "Tests", command: "npm test", status: "passed", exitCode: 0, durationMs: 10, output: "ok" }] }] : [] },
    contract: { goal: "test", constraints: [], steps: [], criteria: [], risks: [], source: "harness", status: "ready-for-review", updatedAt: ts },
    promotion: { status: "review-required", allowed: true, requiresHumanReview: true, reason: "review" }, telemetry: { providerCalls: 0, providerLatencyMs: 0, toolCalls: 0, toolLatencyMs: 0, errors: [] }, context: { maxInputChars: 1, estimatedMaxInputTokens: 1, lastInputChars: 1, estimatedLastInputTokens: 1, maxOutputTokens: 1, retryMaxOutputTokens: 1 },
  };
}

function diff(id: string, ts: string, path: string): DiffEvent {
  return { id, ts, repo: "repo", branch: "main", kind: "diff", files: [{ path, added: 1, removed: 0, hunks: 1 }], authorship: "human" };
}

test("a later change invalidates only proof claims connected to the changed file", () => {
  const first = run("11111111-1111-1111-1111-111111111111", "2026-01-01T10:00:00.000Z", "src/auth.ts");
  const independent = run("22222222-2222-2222-2222-222222222222", "2026-01-01T11:00:00.000Z", "src/billing.ts");
  const later = diff("diff-later", "2026-01-02T10:00:00.000Z", "src/auth.ts");
  const graph = buildRepositoryProofGraph([first, independent], [later], "2026-01-03T00:00:00.000Z");

  const auth = graph.claims.find((claim) => claim.id === `run:${first.id}`)!;
  const billing = graph.claims.find((claim) => claim.id === `run:${independent.id}`)!;
  assert.equal(auth.status, "stale");
  assert.deepEqual(auth.invalidatedFiles, ["src/auth.ts"]);
  assert.equal(auth.invalidatedAt, later.ts);
  assert.equal(billing.status, "proven");
  assert.equal(graph.summary.stale, 1);
  assert.equal(graph.summary.proven, 1);
});

test("captured proof and human ownership become one claim with traceable evidence", () => {
  const change = diff("diff-owned", "2026-01-01T10:00:00.000Z", "src/config.ts");
  const proof: ProofEvent = { id: "proof-1", ts: "2026-01-01T10:05:00.000Z", repo: "repo", branch: "main", kind: "proof", diffId: change.id, runner: "npm", command: "npm test", status: "proven", exitCode: 0, durationMs: 50, output: "ok", coveredNodeIds: [] };
  const ownership: OwnershipEvidenceEvent = { id: "ownership-1", ts: "2026-01-01T10:10:00.000Z", repo: "repo", branch: "main", kind: "ownership-evidence", diffId: change.id, answers: [], completedCount: 3, requiredCount: 3 };
  const graph = buildRepositoryProofGraph([], [change, proof, ownership] as LedgerEvent[], "2026-01-03T00:00:00.000Z");

  const claim = graph.claims[0];
  assert.equal(claim.status, "proven");
  assert.deepEqual(claim.evidence.map((item) => item.kind), ["proof", "ownership"]);
  assert.ok(graph.edges.some((edge) => edge.relation === "proves" && edge.to === claim.id));
  assert.ok(graph.edges.some((edge) => edge.relation === "understands" && edge.to === claim.id));
});

test("ownership without executable proof remains explicitly understood, not proven", () => {
  const change = diff("diff-understood", "2026-01-01T10:00:00.000Z", "README.md");
  const ownership: OwnershipEvidenceEvent = { id: "ownership-2", ts: "2026-01-01T10:10:00.000Z", repo: "repo", branch: "main", kind: "ownership-evidence", diffId: change.id, answers: [], completedCount: 3, requiredCount: 3 };
  const graph = buildRepositoryProofGraph([], [change, ownership], "2026-01-03T00:00:00.000Z");
  assert.equal(graph.claims[0].status, "understood");
  assert.equal(graph.summary.understood, 1);
  assert.equal(graph.summary.proven, 0);
});
