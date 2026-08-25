import { appendEvents, defaultConfig, eventBase, readConfig, readDiffEvidence, readLedger } from "./ledger.ts";
import { currentBranch } from "./git.ts";
import { buildComprehensionMap } from "./map.ts";
import type { ConfidenceEvent, ConfidenceScore, DiffEvent, ExplanationEvent, LedgerEvent, OwnershipAnswer, OwnershipEvidenceEvent, QueueDispositionEvent, ReviewEvent, SessionCompleteEvent } from "./types.ts";
import type { ObserverActivity, ObserverStatus } from "./observer.ts";
import { analyzeImpact } from "./impact.ts";
import { buildProofPlan, nodeVerdicts, proofHistory, runProof } from "./proof.ts";
import { executeProbe, generateProbes, probeHistory } from "./probes.ts";
import { listRepositoryFiles } from "./repository.ts";

type RatingEvent = ConfidenceEvent | ReviewEvent;

function ratingScore(event: RatingEvent | undefined): ConfidenceScore | null | undefined {
  return event?.kind === "review" ? event.newScore : event?.score;
}

function changeStory(diff: DiffEvent, patch: string, intent: string | null) {
  const changedLines = diff.files.reduce((sum, file) => sum + file.added + file.removed, 0);
  const tests = diff.files.filter((file) => /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[^.]+$/i.test(file.path));
  const sensitive = diff.files.filter((file) => /(^|\/)(auth|security|migration|infra|config|payment|billing|permission|secret)/i.test(file.path));
  const config = diff.files.filter((file) => /(^|\/)(config|infra)|\.(ya?ml|json|toml|properties|xml)$/i.test(file.path));
  const contracts = diff.files.filter((file) => /(controller|route|api|schema|dto|migration|interface)/i.test(file.path));
  const areas = [...new Set(diff.files.map((file) => file.path.split("/").slice(0, -1).join("/") || "repository root"))].slice(0, 4);
  const symbols = [...patch.matchAll(/^\+\s*(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(?:class|function|interface|record|enum|def|const|void|boolean|String|int|long)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((match) => match[1]).filter((value, index, all) => all.indexOf(value) === index).slice(0, 6);
  let risk: "low" | "medium" | "high" = "low";
  if (sensitive.length || changedLines >= 300 || (contracts.length && !tests.length)) risk = "high";
  else if (changedLines >= 100 || config.length || contracts.length) risk = "medium";
  const primary = [...diff.files.filter((file) => !tests.includes(file)), ...tests].sort((a, b) => {
    const aTest = tests.includes(a) ? 1 : 0;
    const bTest = tests.includes(b) ? 1 : 0;
    return aTest - bTest || (b.added + b.removed) - (a.added + a.removed);
  })[0];
  const title = intent?.trim()
    ? intent.trim().split(/(?<=[.!?])\s/)[0].slice(0, 110)
    : sensitive.length ? `${sensitive.length} sensitive path${sensitive.length === 1 ? "" : "s"} changed`
    : `${primary?.path.split("/").at(-1) ?? "Repository behavior"}${diff.files.length > 1 ? ` and ${diff.files.length - 1} related file${diff.files.length === 2 ? "" : "s"}` : ""} changed`;
  const behaviors = [
    primary ? `${primary.path} carries the largest part of the change (${primary.added}+ / ${primary.removed}−).` : null,
    contracts.length ? `${contracts.length} boundary or data-contract file${contracts.length === 1 ? "" : "s"} may change what callers can rely on.` : null,
    config.length ? `${config.length} configuration surface${config.length === 1 ? "" : "s"} changed; runtime behavior may differ without a direct call-site change.` : null,
    tests.length ? `${tests.length} test file${tests.length === 1 ? "" : "s"} changed as executable evidence.` : "No test file changed with this behavior.",
  ].filter((item): item is string => Boolean(item));
  return {
    title, risk, changedLines, areas, symbols, behaviors,
    provenance: diff.model ?? (diff.authorship === "unknown" ? "Unattributed working-tree activity" : `${diff.authorship} authored`),
    testStatus: tests.length ? `${tests.length} test file${tests.length === 1 ? "" : "s"} changed` : "No changed test evidence",
    expectedMinutes: Math.min(20, Math.max(3, Math.ceil(changedLines / 80) + (risk === "high" ? 4 : risk === "medium" ? 2 : 0))),
  };
}

export async function loadDashboardState(root: string, observer?: ObserverStatus, observerActivity: ObserverActivity[] = [], options: { initialized?: boolean } = {}) {
  const [events, config, repositoryFiles] = options.initialized === false
    ? [[], defaultConfig, await listRepositoryFiles(root)] as [LedgerEvent[], typeof defaultConfig, string[]]
    : await Promise.all([readLedger(root), readConfig(root), listRepositoryFiles(root)]);
  const files = buildComprehensionMap(events, config.confidenceHalfLifeDays);
  const diffs = events.filter((event): event is DiffEvent => event.kind === "diff");
  const ratings = events.filter((event): event is RatingEvent => event.kind === "confidence" || event.kind === "review");
  const explanations = events.filter((event): event is ExplanationEvent => event.kind === "explanation");
  const evidence = events.filter((event): event is OwnershipEvidenceEvent => event.kind === "ownership-evidence");
  const completions = events.filter((event): event is SessionCompleteEvent => event.kind === "session-complete");
  const dispositions = events.filter((event): event is QueueDispositionEvent => event.kind === "queue-disposition");
  const demonstratedDiffs = new Set(evidence.filter((event) => event.completedCount >= event.requiredCount).map((event) => event.diffId));
  const reviewedDiffs = new Set([...explanations.map((event) => event.diffId), ...evidence.map((event) => event.diffId), ...completions.map((event) => event.diffId)]);
  const latestRating = new Map<string, RatingEvent>();
  for (const rating of ratings) {
    const previous = latestRating.get(rating.diffId);
    if (!previous || previous.ts < rating.ts) latestRating.set(rating.diffId, rating);
  }
  const explained = new Set(explanations.map((event) => event.diffId));
  type QueueItem = { diffId: string; ts: string; files: DiffEvent["files"]; intentId?: string; model?: string; kind: string; priority: string; score: ConfidenceScore | null; label: string; skippedAt?: string; supersededCount?: number };
  const candidates: QueueItem[] = [];
  for (const diff of diffs) {
    const score = ratingScore(latestRating.get(diff.id));
    const base = { diffId: diff.id, ts: diff.ts, files: diff.files, intentId: diff.intentId, model: diff.model };
    if (score == null) candidates.push({ ...base, kind: "unrated", priority: "high", score: null, label: "Confidence missing" });
    else if (!reviewedDiffs.has(diff.id) && score === 1 && !explained.has(diff.id)) candidates.push({ ...base, kind: "opaque", priority: "high", score, label: "Opaque and unexplained" });
    else if (!reviewedDiffs.has(diff.id) && score === 2 && !explained.has(diff.id)) candidates.push({ ...base, kind: "followable", priority: "medium", score, label: "Followable, not owned" });
    else if (!reviewedDiffs.has(diff.id) && score === 3 && !demonstratedDiffs.has(diff.id)) candidates.push({ ...base, kind: "unverified", priority: "medium", score, label: "Owned by claim, not yet demonstrated" });
  }
  const latestDisposition = new Map<string, QueueDispositionEvent>();
  for (const disposition of dispositions) latestDisposition.set(disposition.diffId, disposition);
  const candidateById = new Map(candidates.map((item) => [item.diffId, item]));
  const queue: QueueItem[] = [];
  for (const candidate of candidates) {
    const diffIndex = diffs.findIndex((diff) => diff.id === candidate.diffId);
    const paths = new Set(candidate.files.map((file) => file.path));
    const supersedingDiff = [...diffs.slice(diffIndex + 1)].reverse().find((diff) =>
      paths.size > 0 && [...paths].every((path) => diff.files.some((file) => file.path === path)),
    );
    if (supersedingDiff) {
      const target = candidateById.get(supersedingDiff.id);
      if (target) target.supersededCount = (target.supersededCount ?? 0) + 1;
      continue;
    }
    const disposition = latestDisposition.get(candidate.diffId);
    queue.push({ ...candidate, skippedAt: disposition?.action === "skip" ? disposition.ts : undefined });
  }
  const scored = files.filter((file) => file.score !== null);
  const totalLines = files.reduce((sum, file) => sum + file.totalLines, 0);
  const aiLines = files.reduce((sum, file) => sum + file.totalLines * file.aiRatio, 0);
  const timeline = ratings.flatMap((event) => {
    const score = ratingScore(event);
    return score == null ? [] : [{ ts: event.ts, score, diffId: event.diffId }];
  }).sort((a, b) => a.ts.localeCompare(b.ts));
  const sessions = diffs.map((diff) => {
    const notes = explanations.filter((event) => event.diffId === diff.id).sort((a, b) => b.ts.localeCompare(a.ts));
    const evidenceRuns = evidence.filter((event) => event.diffId === diff.id).sort((a, b) => b.ts.localeCompare(a.ts));
    const completionRuns = completions.filter((event) => event.diffId === diff.id).sort((a, b) => b.ts.localeCompare(a.ts));
    return { diffId: diff.id, ts: diff.ts, files: diff.files, authorship: diff.authorship, model: diff.model,
      score: ratingScore(latestRating.get(diff.id)) ?? null, notes, evidence: evidenceRuns, completions: completionRuns, reviewed: reviewedDiffs.has(diff.id), demonstrated: evidenceRuns.some((event) => event.completedCount >= event.requiredCount), durationMs: completionRuns.reduce((sum, run) => sum + run.durationMs, 0) || notes.reduce((sum, note) => sum + note.durationMs, 0) };
  }).sort((a, b) => b.ts.localeCompare(a.ts));
  const now = Date.now();
  const learnNext = sessions.filter((session) => session.reviewed).map((session) => {
    const latest = session.completions[0]?.ts ?? session.evidence[0]?.ts ?? session.notes[0]?.ts ?? session.ts;
    const intervalDays = session.score === 3 ? 7 : session.score === 2 ? 3 : 1;
    const laterOverlap = diffs.filter((candidate) => candidate.ts > latest && candidate.files.some((file) => session.files.some((owned) => owned.path === file.path))).sort((a, b) => b.ts.localeCompare(a.ts))[0];
    const dueAt = laterOverlap?.ts ?? new Date(Date.parse(latest) + intervalDays * 86_400_000).toISOString();
    return { diffId: session.diffId, dueAt, due: Date.parse(dueAt) <= now, stale: Boolean(laterOverlap), score: session.score, files: session.files, label: laterOverlap ? "Code changed since you learned it" : session.score === 3 ? "Confirm this still feels owned" : "Strengthen this understanding" };
  }).sort((a, b) => Number(b.due) - Number(a.due) || a.dueAt.localeCompare(b.dueAt));
  if (observer?.pending) queue.unshift({ diffId: `pending:${observer.pending.since}`, ts: observer.pending.since, files: observer.pending.files,
    kind: "pending", priority: "medium", score: null, label: "Grouping active working-tree changes", model: "universal-git-observer", intentId: undefined });
  queue.sort((a, b) => Number(b.kind === "pending") - Number(a.kind === "pending") || Number(Boolean(a.skippedAt)) - Number(Boolean(b.skippedAt)) || b.ts.localeCompare(a.ts));

  return {
    generatedAt: new Date().toISOString(), repo: events.at(-1)?.repo ?? root.split("/").at(-1) ?? "repository",
    branch: events.at(-1)?.branch ?? "main", files, repositoryFiles, diffs, queue, learnNext, timeline, sessions, observer, observerActivity,
    summary: {
      averageScore: scored.length ? scored.reduce((sum, file) => sum + (file.score ?? 0), 0) / scored.length : null,
      aiRatio: totalLines ? aiLines / totalLines : 0, unknownFiles: files.length - scored.length,
      reviewCount: queue.length, fileCount: files.length,
      ownershipCoverage: sessions.length ? sessions.filter((session) => session.demonstrated).length / sessions.length : 0,
      learnCount: learnNext.filter((item) => item.due).length,
    },
  };
}

export async function recordQueueDisposition(root: string, input: { diffId: string; action: "skip" }) {
  const events = await readLedger(root);
  const diff = events.find((event): event is DiffEvent => event.kind === "diff" && event.id === input.diffId);
  if (!diff) throw new Error("Diff not found");
  await appendEvents(root, [{ ...eventBase(root, diff.branch || await currentBranch(root)), kind: "queue-disposition", diffId: diff.id, action: input.action }]);
  return { ok: true };
}

export async function loadOwnershipBrief(root: string, diffId: string) {
  const events = await readLedger(root);
  const diff = events.find((event): event is DiffEvent => event.kind === "diff" && event.id === diffId);
  if (!diff) throw new Error("Diff not found");
  const intent = diff.intentId ? events.find((event) => event.kind === "intent" && event.id === diff.intentId) : undefined;
  const patch = await readDiffEvidence(root, diffId);
  const changedLines = diff.files.reduce((sum, file) => sum + file.added + file.removed, 0);
  const tests = diff.files.filter((file) => /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[^.]+$/i.test(file.path));
  const risky = diff.files.filter((file) => /(^|\/)(auth|security|migration|infra|config|payment|billing)/i.test(file.path));
  const priorNotes = events.filter((event): event is ExplanationEvent => event.kind === "explanation" && event.diffId === diffId).sort((a, b) => b.ts.localeCompare(a.ts));
  const priorEvidence = events.filter((event): event is OwnershipEvidenceEvent => event.kind === "ownership-evidence" && event.diffId === diffId).sort((a, b) => b.ts.localeCompare(a.ts));
  const ratingHistory = events.filter((event): event is RatingEvent => (event.kind === "confidence" || event.kind === "review") && event.diffId === diffId)
    .map((event) => ({ ts: event.ts, score: ratingScore(event) })).filter((entry) => entry.score != null);
  const focusFiles = [...diff.files].sort((a, b) => {
    const aTest = tests.includes(a) ? 1 : 0;
    const bTest = tests.includes(b) ? 1 : 0;
    return aTest - bTest || (b.added + b.removed) - (a.added + a.removed);
  }).slice(0, 3);
  const signals = [
    changedLines >= 300 ? `${changedLines} changed lines make this difficult to review as one mental unit.` : null,
    tests.length === 0 ? "No test file changed with this implementation." : `${tests.length} test file${tests.length === 1 ? "" : "s"} changed alongside the implementation.`,
    risky.length ? `${risky.length} sensitive path${risky.length === 1 ? "" : "s"} deserve explicit failure-mode review.` : null,
    !patch ? "The original patch is unavailable; use the file history as evidence." : null,
  ].filter(Boolean);
  const intentText = intent?.kind === "intent" ? intent.prompt : null;
  const history = events.filter((event): event is DiffEvent => event.kind === "diff" && event.id !== diffId).map((priorDiff) => ({
    diff: priorDiff,
    notes: events.filter((event): event is ExplanationEvent => event.kind === "explanation" && event.diffId === priorDiff.id),
  }));
  const impact = await analyzeImpact(root, diff, patch, history);
  const primaryBehavior = impact.nodes.find((node) => node.kind === "method" || node.kind === "class" || node.kind === "config");
  const connectedTest = impact.nodes.find((node) => node.kind === "test");
  return {
    diff, intent: intentText, patch, story: changeStory(diff, patch, intentText), impact,
    changedLines, focusFiles, signals, priorNotes, priorEvidence, ratingHistory,
    questions: [
      { id: "trace", text: `Trace ${primaryBehavior?.label ?? basenameForQuestion(focusFiles[0]?.path)} from its entry point through its dependencies to the outcome.`, path: primaryBehavior?.path ?? focusFiles[0]?.path ?? null, kind: "trace", requiredForOwned: true },
      { id: "challenge", text: `Which unproven path—${impact.unproven.slice(0, 2).join(" or ")}—is most likely to fail, and where?`, path: primaryBehavior?.path ?? focusFiles[1]?.path ?? focusFiles[0]?.path ?? null, kind: "challenge", requiredForOwned: true },
      connectedTest
        ? { id: "evidence", text: `What does ${connectedTest.label} actually prove, and which connected behavior does it leave unproven?`, path: connectedTest.path ?? null, kind: "evidence", requiredForOwned: true }
        : { id: "evidence", text: "What is the smallest test that would prove the intended behavior?", path: focusFiles[0]?.path ?? null, kind: "evidence", requiredForOwned: true },
      { id: "debug", text: `If this broke in production, where would you begin debugging in ${focusFiles[0]?.path ?? "the change"}, and why?`, path: focusFiles[0]?.path ?? null, kind: "debug", requiredForOwned: false },
    ],
  };
}

function basenameForQuestion(path?: string) { return path?.split("/").at(-1) ?? "the primary behavior"; }

export async function loadImpactGraph(root: string, diffId: string) {
  const events = await readLedger(root);
  const diff = events.find((event): event is DiffEvent => event.kind === "diff" && event.id === diffId);
  if (!diff) throw new Error("Diff not found");
  const patch = await readDiffEvidence(root, diffId);
  const history = events.filter((event): event is DiffEvent => event.kind === "diff" && event.id !== diffId).map((priorDiff) => ({
    diff: priorDiff,
    notes: events.filter((event): event is ExplanationEvent => event.kind === "explanation" && event.diffId === priorDiff.id),
  }));
  return { diffId, diff, graph: await analyzeImpact(root, diff, patch, history) };
}

export async function loadProofBrief(root: string, diffId: string) {
  const { diff, graph } = await loadImpactGraph(root, diffId);
  const [plan, history] = await Promise.all([buildProofPlan(root, diff, graph), proofHistory(root, diffId)]);
  return { diffId, plan: { ...plan, executable: undefined, args: undefined }, history, latest: history[0] ?? null, verdicts: nodeVerdicts(graph, history[0]) };
}

export async function executeProof(root: string, diffId: string, signal?: AbortSignal) {
  const { diff, graph } = await loadImpactGraph(root, diffId);
  const plan = await buildProofPlan(root, diff, graph);
  const result = await runProof(root, diff, plan, signal);
  return { result, plan: { ...plan, executable: undefined, args: undefined }, verdicts: nodeVerdicts(graph, result) };
}

export async function loadProbeLab(root: string, diffId: string) {
  const { diff, graph } = await loadImpactGraph(root, diffId);
  const [probes, history] = await Promise.all([generateProbes(root, diff, graph), probeHistory(root, diffId)]);
  return { diffId, probes: probes.map((probe) => ({ ...probe, latest: history.find((run) => run.probeId === probe.id) ?? null })), history };
}

export async function runGeneratedProbe(root: string, diffId: string, probeId: string, signal?: AbortSignal) {
  const { diff, graph } = await loadImpactGraph(root, diffId);
  const probe = (await generateProbes(root, diff, graph)).find((candidate) => candidate.id === probeId);
  if (!probe) throw new Error("Probe not found for this capture.");
  return { result: await executeProbe(root, diff, probe, signal) };
}

export async function recordOwnershipReview(root: string, input: { diffId: string; score: ConfidenceScore; explanation?: string; durationMs?: number; answers?: OwnershipAnswer[] }) {
  const events = await readLedger(root);
  const diff = events.find((event): event is DiffEvent => event.kind === "diff" && event.id === input.diffId);
  if (!diff) throw new Error("Diff not found");
  const branch = diff.branch || await currentBranch(root);
  const base = () => eventBase(root, branch);
  const answers = (input.answers ?? []).map((answer) => ({ ...answer, answer: answer.answer?.trim() ?? "" })).filter((answer) => answer.answer.length >= 20);
  const requiredKinds = new Set(answers.map((answer) => answer.kind));
  const demonstrated = (["trace", "challenge", "evidence"] as const).every((kind) => requiredKinds.has(kind));
  if (input.score === 3 && (!demonstrated || (input.explanation?.trim().length ?? 0) < 40)) {
    throw new Error("Owned requires trace, failure-mode, and test evidence answers plus a 40-character explanation.");
  }
  if (input.score === 2 && !answers.length && (input.explanation?.trim().length ?? 0) < 20) {
    throw new Error("Followable requires at least one evidence answer or a short explanation.");
  }
  const recorded: LedgerEvent[] = [];
  if (answers.length) recorded.push({ ...base(), kind: "ownership-evidence", diffId: input.diffId, answers, completedCount: answers.filter((answer) => answer.kind !== "debug").length, requiredCount: 3 });
  if (input.explanation?.trim()) recorded.push({ ...base(), kind: "explanation", diffId: input.diffId, text: input.explanation.trim(), durationMs: Math.max(0, input.durationMs ?? 0) });
  const prior = events.some((event) => (event.kind === "confidence" || event.kind === "review") && event.diffId === input.diffId && ratingScore(event) != null);
  if (prior) recorded.push({ ...base(), kind: "review", diffId: input.diffId, newScore: input.score });
  else recorded.push({ ...base(), kind: "confidence", diffId: input.diffId, score: input.score });
  recorded.push({ ...base(), kind: "session-complete", diffId: input.diffId, score: input.score, durationMs: Math.max(0, input.durationMs ?? 0), evidenceCount: answers.length, hasExplanation: Boolean(input.explanation?.trim()) });
  await appendEvents(root, recorded);
  return { ok: true };
}
