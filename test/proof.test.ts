import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildProofPlan, nodeVerdicts, proofHistory, runProof } from "../src/proof.ts";
import { initializeStore } from "../src/ledger.ts";
import type { DiffEvent } from "../src/types.ts";
import type { ImpactGraph } from "../src/impact.ts";

const exec = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aperta-proof-"));
  await exec("git", ["init", "-q", root]);
  await initializeStore(root);
  return root;
}

const diff: DiffEvent = { id: "proof-diff", kind: "diff", ts: "2026-08-22T00:00:00.000Z", repo: "demo", branch: "main", authorship: "ai", files: [{ path: "src/auth.test.ts", added: 4, removed: 0, hunks: 1 }] };
const graph: ImpactGraph = {
  analyzer: "TypeScript structural analyzer v1", headline: "Auth changed", narrative: "Auth behavior changed.", risk: "high", staleNotes: [],
  nodes: [
    { id: "test:auth", label: "auth.test.ts", path: "src/auth.test.ts", kind: "test", status: "added" },
    { id: "method:login", label: "login", path: "src/auth.ts", kind: "method", status: "modified" },
    { id: "dependency:db", label: "database", kind: "dependency", status: "related" },
  ],
  edges: [{ from: "test:auth", to: "method:login", kind: "covers" }], insights: [], unproven: ["Expired session rejection"],
};

test("detects a project test command and scopes graph coverage", async () => {
  const root = await fixture();
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"console.log('proof ok')\"" } }));
  const plan = await buildProofPlan(root, diff, graph);
  assert.equal(plan.runner, "npm");
  assert.equal(plan.command, "npm test");
  assert.deepEqual(plan.coveredNodeIds.sort(), ["method:login", "test:auth"]);
  assert.equal(plan.proposedProbes[0].label, "Expired session rejection");
});

test("executes proof, stores durable output, and promotes covered nodes", async () => {
  const root = await fixture();
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"console.log('proof ok')\"" } }));
  const plan = await buildProofPlan(root, diff, graph);
  const result = await runProof(root, diff, plan);
  assert.equal(result.status, "proven");
  assert.match(result.output, /proof ok/);
  assert.equal((await proofHistory(root, diff.id))[0].id, result.id);
  const verdicts = new Map(nodeVerdicts(graph, result).map((entry) => [entry.nodeId, entry.verdict]));
  assert.equal(verdicts.get("method:login"), "proven");
  assert.equal(verdicts.get("dependency:db"), "inferred");
});
