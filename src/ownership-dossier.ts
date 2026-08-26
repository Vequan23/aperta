import { loadOwnershipBrief, loadProofBrief } from "./dashboard-data.ts";
import { readLedger } from "./ledger.ts";
import { loadRepositoryProofGraph, type RepositoryProofClaim } from "./proof-graph.ts";
import type { ExplanationEvent, OwnershipEvidenceEvent, ProofEvent, SessionCompleteEvent } from "./types.ts";

export type OwnershipDossierStatus = "needs-defense" | "defended" | "proven" | "stale" | "regressed";

export interface DossierCitation {
  id: string;
  label: string;
  kind: "code" | "test" | "proof" | "human";
  path?: string;
  detail: string;
}

export interface OwnershipDossier {
  schemaVersion: 1;
  id: string;
  diffId: string;
  repository: string;
  branch: string;
  capturedAt: string;
  generatedAt: string;
  revision: {
    commitSha?: string;
    fingerprint?: string;
    baseTree?: string;
    resultTree?: string;
  };
  status: OwnershipDossierStatus;
  title: string;
  intent: string | null;
  risk: "low" | "medium" | "high";
  behaviors: string[];
  files: Array<{ path: string; added: number; removed: number; hunks: number }>;
  evidence: DossierCitation[];
  defense: {
    completed: boolean;
    completedAt: string | null;
    confidence: 1 | 2 | 3 | null;
    statement: string | null;
    answers: Array<{ kind: string; question: string; answer: string; path?: string }>;
  };
  uncertainty: string[];
  freshness: {
    status: "current" | "stale" | "regressed";
    checkedAt: string;
    assuredAt: string | null;
    invalidatedAt?: string;
    invalidatedBy?: string;
    invalidatedFiles: string[];
  };
}

function statusFor(claim: RepositoryProofClaim, defended: boolean): OwnershipDossierStatus {
  if (claim.status === "stale" || claim.status === "regressed") return claim.status;
  if (!defended) return "needs-defense";
  if (claim.status === "proven") return "proven";
  return "defended";
}

export async function loadOwnershipDossier(root: string, diffId: string, now = new Date().toISOString()): Promise<OwnershipDossier> {
  const [brief, proof, graph, events] = await Promise.all([
    loadOwnershipBrief(root, diffId),
    loadProofBrief(root, diffId),
    loadRepositoryProofGraph(root),
    readLedger(root),
  ]);
  const claim = graph.claims.find((item) => item.id === `diff:${diffId}`);
  if (!claim) throw new Error("Ownership claim not found");

  const explanations = events
    .filter((event): event is ExplanationEvent => event.kind === "explanation" && event.diffId === diffId)
    .sort((left, right) => right.ts.localeCompare(left.ts));
  const defenses = events
    .filter((event): event is OwnershipEvidenceEvent => event.kind === "ownership-evidence" && event.diffId === diffId)
    .sort((left, right) => right.ts.localeCompare(left.ts));
  const completions = events
    .filter((event): event is SessionCompleteEvent => event.kind === "session-complete" && event.diffId === diffId)
    .sort((left, right) => right.ts.localeCompare(left.ts));
  const proofs = events
    .filter((event): event is ProofEvent => event.kind === "proof" && event.diffId === diffId)
    .sort((left, right) => right.ts.localeCompare(left.ts));
  const latestDefense = defenses[0];
  const latestCompletion = completions[0];
  const defended = Boolean(latestDefense && latestDefense.completedCount >= latestDefense.requiredCount);

  const codeCitations: DossierCitation[] = brief.diff.files.map((file, index) => ({
    id: `code:${index}:${file.path}`,
    label: index === 0 ? "Primary change" : "Changed code",
    kind: /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[^.]+$/i.test(file.path) ? "test" : "code",
    path: file.path,
    detail: `${file.added} additions, ${file.removed} deletions, ${file.hunks} hunks`,
  }));
  const proofCitations: DossierCitation[] = proofs.map((item) => ({
    id: `proof:${item.id}`,
    label: item.command,
    kind: "proof",
    detail: `${item.status} with ${item.runner}. Exit ${item.exitCode ?? "unknown"} in ${item.durationMs}ms.`,
  }));
  const humanCitations: DossierCitation[] = latestDefense?.answers.map((answer, index) => ({
    id: `human:${latestDefense.id}:${index}`,
    label: `${answer.kind} defense`,
    kind: "human",
    path: answer.path,
    detail: answer.answer,
  })) ?? [];

  const uncertainty = [
    ...brief.signals.filter((item: string | null): item is string => Boolean(item)),
    ...brief.impact.unproven.slice(0, 8).map((item: string) => `Unproven path: ${item}`),
    ...(proof.latest ? [] : ["No executable proof has been recorded for this change."]),
    ...(defended ? [] : ["A responsible engineer has not completed the required defense."]),
  ];

  return {
    schemaVersion: 1,
    id: `ownership-record:${diffId}`,
    diffId,
    repository: brief.diff.repo,
    branch: brief.diff.branch,
    capturedAt: brief.diff.ts,
    generatedAt: now,
    revision: {
      commitSha: brief.diff.commitSha,
      fingerprint: brief.diff.fingerprint,
      baseTree: brief.diff.baseTree,
      resultTree: brief.diff.resultTree,
    },
    status: statusFor(claim, defended),
    title: brief.story.title,
    intent: brief.intent,
    risk: brief.story.risk,
    behaviors: brief.story.behaviors,
    files: brief.diff.files,
    evidence: [...codeCitations, ...proofCitations, ...humanCitations],
    defense: {
      completed: defended,
      completedAt: defended ? latestDefense.ts : null,
      confidence: latestCompletion?.score ?? null,
      statement: explanations[0]?.text ?? null,
      answers: latestDefense?.answers ?? [],
    },
    uncertainty: [...new Set(uncertainty)],
    freshness: {
      status: claim.status === "stale" ? "stale" : claim.status === "regressed" ? "regressed" : "current",
      checkedAt: graph.generatedAt,
      assuredAt: claim.assuranceAt,
      invalidatedAt: claim.invalidatedAt,
      invalidatedBy: claim.invalidatedBy,
      invalidatedFiles: claim.invalidatedFiles,
    },
  };
}

function cleanInline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").trim();
}

export function renderChangeBrief(dossier: OwnershipDossier): string {
  const revision = dossier.revision.commitSha ?? dossier.revision.resultTree ?? dossier.revision.fingerprint ?? dossier.diffId;
  const lines = [
    `# ${dossier.title}`,
    "",
    `> Ownership status: **${dossier.status}**. Evidence checked ${dossier.freshness.checkedAt}.`,
    "",
    "## What changed",
    "",
    dossier.intent ? cleanInline(dossier.intent) : "No original intent was recorded.",
    "",
    ...dossier.behaviors.map((behavior) => `- ${cleanInline(behavior)}`),
    "",
    "## Revision",
    "",
    `- Repository: ${cleanInline(dossier.repository)}`,
    `- Branch: ${cleanInline(dossier.branch)}`,
    `- Revision: ${cleanInline(revision)}`,
    `- Captured: ${dossier.capturedAt}`,
    `- Risk: ${dossier.risk}`,
    "",
    "## Evidence",
    "",
    "| Evidence | Source | Result |",
    "| --- | --- | --- |",
    ...dossier.evidence.map((item) => `| ${cleanInline(item.label)} | ${item.path ? `\`${cleanInline(item.path)}\`` : item.kind} | ${cleanInline(item.detail)} |`),
    "",
    "## Engineer defense",
    "",
    dossier.defense.statement ?? "No defense statement has been recorded.",
    "",
    ...dossier.defense.answers.map((answer) => `- **${cleanInline(answer.kind)}:** ${cleanInline(answer.answer)}${answer.path ? ` (\`${cleanInline(answer.path)}\`)` : ""}`),
    "",
    "## Open questions",
    "",
    ...(dossier.uncertainty.length ? dossier.uncertainty.map((item) => `- ${cleanInline(item)}`) : ["- No open questions are recorded."]),
    "",
    "## Freshness",
    "",
    dossier.freshness.status === "current"
      ? "This brief is current for the captured revision."
      : `This brief is ${dossier.freshness.status}. ${cleanInline(dossier.freshness.invalidatedBy ?? "Later code changed its supporting evidence.")}`,
    "",
    `Generated by Aperta from ownership record \`${dossier.id}\`.`,
    "",
  ];
  return lines.join("\n");
}
