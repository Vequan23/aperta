import type { ConfidenceEvent, DiffEvent, ExplanationEvent, LedgerEvent, ReviewEvent } from "./types.ts";

export interface FileComprehension {
  path: string;
  score: number | null;
  aiRatio: number;
  totalLines: number;
  explainedLowConfidence: number;
  lowConfidenceCount: number;
}

export function buildComprehensionMap(
  events: LedgerEvent[],
  halfLifeDays = 90,
  now = new Date(),
): FileComprehension[] {
  const diffs = events.filter((event): event is DiffEvent => event.kind === "diff");
  const confidence = new Map<string, Array<ConfidenceEvent | ReviewEvent>>();
  const explained = new Set(
    events.filter((event): event is ExplanationEvent => event.kind === "explanation").map((event) => event.diffId),
  );
  for (const event of events) {
    if ((event.kind !== "confidence" && event.kind !== "review") || (event.kind === "confidence" && event.score === null)) continue;
    const list = confidence.get(event.diffId) ?? [];
    list.push(event);
    confidence.set(event.diffId, list);
  }

  const files = new Map<string, {
    weightedScore: number;
    weight: number;
    aiLines: number;
    totalLines: number;
    low: number;
    explainedLow: number;
  }>();

  for (const diff of diffs) {
    const ratings = confidence.get(diff.id) ?? [];
    const latest = ratings.sort((a, b) => b.ts.localeCompare(a.ts))[0];
    const latestScore = latest?.kind === "review" ? latest.newScore : latest?.score;
    const ageDays = latest ? Math.max(0, (now.getTime() - new Date(latest.ts).getTime()) / 86_400_000) : 0;
    const decay = latest ? Math.pow(0.5, ageDays / halfLifeDays) : 0;
    for (const file of diff.files) {
      const row = files.get(file.path) ?? { weightedScore: 0, weight: 0, aiLines: 0, totalLines: 0, low: 0, explainedLow: 0 };
      const lines = file.added + file.removed;
      row.totalLines += lines;
      if (diff.authorship === "ai") row.aiLines += lines;
      else if (diff.authorship === "mixed") row.aiLines += lines / 2;
      if (latestScore) {
        // Confidence decays toward opaque, so an isolated old "3" cannot stay
        // permanently owned just because no newer rating exists.
        const agedScore = 1 + (latestScore - 1) * decay;
        row.weightedScore += agedScore * decay;
        row.weight += decay;
        if (latestScore <= 2) {
          row.low += 1;
          if (explained.has(diff.id)) row.explainedLow += 1;
        }
      }
      files.set(file.path, row);
    }
  }

  return [...files.entries()].map(([path, row]) => ({
    path,
    score: row.weight === 0 ? null : row.weightedScore / row.weight,
    aiRatio: row.totalLines === 0 ? 0 : row.aiLines / row.totalLines,
    totalLines: row.totalLines,
    explainedLowConfidence: row.explainedLow,
    lowConfidenceCount: row.low,
  })).sort((a, b) => (a.score ?? -1) - (b.score ?? -1) || b.aiRatio - a.aiRatio || a.path.localeCompare(b.path));
}

function bar(score: number | null): string {
  if (score === null) return "··········";
  const filled = Math.max(0, Math.min(10, Math.round(((score - 1) / 2) * 10)));
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

export function renderMap(rows: FileComprehension[]): string {
  if (rows.length === 0) return "No captured diffs yet. Run `aperta capture`.";
  const width = Math.min(56, Math.max(18, ...rows.map((row) => row.path.length)));
  const lines = [
    `${"FILE".padEnd(width)}  COMPREHENSION  AI LINES`,
    `${"─".repeat(width)}  ─────────────  ────────`,
  ];
  for (const row of rows) {
    const path = row.path.length > width ? `…${row.path.slice(-(width - 1))}` : row.path;
    const score = row.score === null ? "  ?" : row.score.toFixed(1).padStart(3);
    lines.push(`${path.padEnd(width)}  ${bar(row.score)} ${score}    ${Math.round(row.aiRatio * 100).toString().padStart(3)}%`);
  }
  lines.push("", "1 opaque · 2 followable · 3 owned · ? unrated");
  return lines.join("\n");
}
