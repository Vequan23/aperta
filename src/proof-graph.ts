import { listAgentRuns, type AgentRun } from "./agent-harness.ts";
import { readLedger } from "./ledger.ts";
import type { DiffEvent, LedgerEvent, OwnershipEvidenceEvent, ProofEvent, SessionCompleteEvent } from "./types.ts";

export type RepositoryProofStatus = "proven" | "understood" | "supported" | "stale" | "regressed" | "unproven";
export type RepositoryProofSource = "agent-run" | "captured-change";

export interface RepositoryProofEvidence {
  id: string;
  kind: "skill" | "verification" | "capability" | "proof" | "ownership" | "completion";
  label: string;
  status: string;
  detail: string;
  ts: string;
}

export interface RepositoryProofClaim {
  id: string;
  source: RepositoryProofSource;
  title: string;
  detail: string;
  ts: string;
  files: string[];
  status: RepositoryProofStatus;
  evidence: RepositoryProofEvidence[];
  assuranceAt: string | null;
  invalidatedAt?: string;
  invalidatedBy?: string;
  invalidatedFiles: string[];
}

export interface RepositoryProofNode {
  id: string;
  kind: "claim" | "file" | "evidence";
  label: string;
  status: string;
  detail?: string;
  path?: string;
}

export interface RepositoryProofEdge {
  from: string;
  to: string;
  relation: "affects" | "proves" | "understands" | "observes" | "invalidates";
}

export interface RepositoryProofGraph {
  generatedAt: string;
  claims: RepositoryProofClaim[];
  nodes: RepositoryProofNode[];
  edges: RepositoryProofEdge[];
  summary: {
    claims: number;
    proven: number;
    understood: number;
    supported: number;
    stale: number;
    regressed: number;
    unproven: number;
    coveredFiles: number;
  };
}

type ChangeRecord = { id: string; ts: string; title: string; files: string[] };

function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function latestTimestamp(values: Array<string | undefined>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}
function intersects(left: string[], right: string[]) {
  const paths = new Set(left);
  return right.filter((path) => paths.has(path));
}
function summaryForRun(run: AgentRun) {
  return run.summary?.trim() || run.understanding?.changedBehavior?.trim() || run.intent.trim() || "Agent repository change";
}

function runEvidence(run: AgentRun): RepositoryProofEvidence[] {
  const skill = [{ id: `run:${run.id}:skill:${run.skill.id}`, kind: "skill" as const, label: run.skill.label, status: "selected", detail: `${run.skill.description} Proof contract: ${run.skill.proof.map((item) => item.text).join(" ")}`, ts: run.createdAt }];
  const verification = run.verification.attempts.flatMap((attempt) => attempt.checks.map((check) => ({
    id: `run:${run.id}:check:${attempt.index}:${check.id}`,
    kind: "verification" as const,
    label: check.label,
    status: check.status,
    detail: `${check.command} · ${check.status}${check.exitCode == null ? "" : ` (exit ${check.exitCode})`}`,
    ts: attempt.ts,
  })));
  const capabilities = run.capabilities.map((capability) => ({
    id: `run:${run.id}:capability:${capability.id}`,
    kind: "capability" as const,
    label: capability.label,
    status: capability.status,
    detail: capability.summary,
    ts: capability.ts,
  }));
  const understanding = run.understanding?.completedAt ? [{
    id: `run:${run.id}:understanding`,
    kind: "ownership" as const,
    label: "Understanding demonstrated",
    status: "completed",
    detail: `${Object.values(run.understanding.responses).filter((answer) => answer.trim()).length} ownership responses retained locally.`,
    ts: run.understanding.completedAt,
  }] : [];
  return [...skill, ...verification, ...capabilities, ...understanding];
}

function claimForRun(run: AgentRun): RepositoryProofClaim | null {
  const evidence = runEvidence(run);
  const files = unique(run.files.map((file) => file.path));
  if (!files.length && !evidence.length) return null;
  const passed = run.verification.status === "passed";
  const failed = run.verification.status === "failed";
  const understood = Boolean(run.understanding?.completedAt);
  const supported = evidence.some((item) => item.kind === "capability" && ["passed", "reachable", "running", "success"].includes(item.status));
  const status: RepositoryProofStatus = failed ? "regressed" : passed ? "proven" : understood ? "understood" : supported ? "supported" : "unproven";
  const assuranceAt = latestTimestamp(evidence.filter((item) => ["passed", "completed", "reachable", "running", "success"].includes(item.status)).map((item) => item.ts));
  return {
    id: `run:${run.id}`, source: "agent-run", title: run.intent.trim() || "Agent task", detail: summaryForRun(run), ts: run.createdAt,
    files, status, evidence, assuranceAt, invalidatedFiles: [],
  };
}

function claimForDiff(diff: DiffEvent, events: LedgerEvent[]): RepositoryProofClaim {
  const proofs = events.filter((event): event is ProofEvent => event.kind === "proof" && event.diffId === diff.id);
  const ownership = events.filter((event): event is OwnershipEvidenceEvent => event.kind === "ownership-evidence" && event.diffId === diff.id);
  const completions = events.filter((event): event is SessionCompleteEvent => event.kind === "session-complete" && event.diffId === diff.id);
  const evidence: RepositoryProofEvidence[] = [
    ...proofs.map((proof) => ({ id: `diff:${diff.id}:proof:${proof.id}`, kind: "proof" as const, label: proof.command, status: proof.status, detail: `${proof.runner} proof ${proof.status} in ${(proof.durationMs / 1000).toFixed(1)}s.`, ts: proof.ts })),
    ...ownership.map((item) => ({ id: `diff:${diff.id}:ownership:${item.id}`, kind: "ownership" as const, label: "Ownership evidence", status: item.completedCount >= item.requiredCount ? "completed" : "partial", detail: `${item.completedCount}/${item.requiredCount} required answers completed.`, ts: item.ts })),
    ...completions.map((item) => ({ id: `diff:${diff.id}:completion:${item.id}`, kind: "completion" as const, label: "Ownership session", status: "completed", detail: `Confidence ${item.score}/3 with ${item.evidenceCount} evidence responses.`, ts: item.ts })),
  ];
  const latestProof = proofs.slice().sort((a, b) => b.ts.localeCompare(a.ts))[0];
  const understood = ownership.some((item) => item.completedCount >= item.requiredCount) || completions.length > 0;
  const status: RepositoryProofStatus = latestProof?.status === "regressed" ? "regressed" : latestProof?.status === "proven" ? "proven" : understood ? "understood" : "unproven";
  const assuranceAt = latestTimestamp(evidence.filter((item) => item.status === "proven" || item.status === "completed").map((item) => item.ts));
  const title = diff.files.map((file) => file.path.split("/").at(-1)).slice(0, 2).join(", ") || "Captured repository change";
  return { id: `diff:${diff.id}`, source: "captured-change", title, detail: `${diff.files.length} captured file${diff.files.length === 1 ? "" : "s"} · ${diff.model ?? diff.authorship}`, ts: diff.ts, files: unique(diff.files.map((file) => file.path)), status, evidence, assuranceAt, invalidatedFiles: [] };
}

function applyInvalidation(claim: RepositoryProofClaim, changes: ChangeRecord[]): RepositoryProofClaim {
  if (!claim.files.length) return claim;
  const currentAt = claim.assuranceAt ?? claim.ts;
  const invalidator = changes
    .filter((change) => change.id !== claim.id && change.ts > currentAt && intersects(claim.files, change.files).length)
    .sort((a, b) => b.ts.localeCompare(a.ts))[0];
  if (!invalidator) return claim;
  return { ...claim, status: "stale", invalidatedAt: invalidator.ts, invalidatedBy: invalidator.title, invalidatedFiles: intersects(claim.files, invalidator.files) };
}

export function buildRepositoryProofGraph(runs: AgentRun[], events: LedgerEvent[], generatedAt = new Date().toISOString()): RepositoryProofGraph {
  const diffs = events.filter((event): event is DiffEvent => event.kind === "diff");
  const initialClaims = [...runs.map(claimForRun).filter((claim): claim is RepositoryProofClaim => Boolean(claim)), ...diffs.map((diff) => claimForDiff(diff, events))];
  const changes: ChangeRecord[] = [
    ...runs.filter((run) => run.files.length).map((run) => ({ id: `run:${run.id}`, ts: run.finishedAt ?? run.createdAt, title: run.intent.trim() || "A later agent run", files: run.files.map((file) => file.path) })),
    ...diffs.map((diff) => ({ id: `diff:${diff.id}`, ts: diff.ts, title: diff.files.map((file) => file.path.split("/").at(-1)).slice(0, 2).join(", ") || "A later captured change", files: diff.files.map((file) => file.path) })),
  ];
  const claims = initialClaims.map((claim) => applyInvalidation(claim, changes)).sort((a, b) => b.ts.localeCompare(a.ts));
  const nodes: RepositoryProofNode[] = [];
  const edges: RepositoryProofEdge[] = [];
  const nodeIds = new Set<string>();
  const addNode = (node: RepositoryProofNode) => { if (!nodeIds.has(node.id)) { nodeIds.add(node.id); nodes.push(node); } };
  for (const claim of claims) {
    addNode({ id: claim.id, kind: "claim", label: claim.title, status: claim.status, detail: claim.detail });
    for (const path of claim.files) {
      const fileId = `file:${path}`;
      addNode({ id: fileId, kind: "file", label: path.split("/").at(-1) ?? path, status: claim.status, path });
      edges.push({ from: claim.id, to: fileId, relation: "affects" });
    }
    for (const evidence of claim.evidence) {
      addNode({ id: evidence.id, kind: "evidence", label: evidence.label, status: evidence.status, detail: evidence.detail });
      const relation = evidence.kind === "ownership" || evidence.kind === "completion" ? "understands" : evidence.kind === "capability" || evidence.kind === "skill" ? "observes" : "proves";
      edges.push({ from: evidence.id, to: claim.id, relation });
    }
    if (claim.invalidatedAt) for (const path of claim.invalidatedFiles) edges.push({ from: `file:${path}`, to: claim.id, relation: "invalidates" });
  }
  const count = (status: RepositoryProofStatus) => claims.filter((claim) => claim.status === status).length;
  return { generatedAt, claims, nodes, edges, summary: { claims: claims.length, proven: count("proven"), understood: count("understood"), supported: count("supported"), stale: count("stale"), regressed: count("regressed"), unproven: count("unproven"), coveredFiles: new Set(claims.flatMap((claim) => claim.files)).size } };
}

export async function loadRepositoryProofGraph(root: string): Promise<RepositoryProofGraph> {
  const [runs, events] = await Promise.all([listAgentRuns(root, Number.POSITIVE_INFINITY), readLedger(root)]);
  return buildRepositoryProofGraph(runs, events);
}
