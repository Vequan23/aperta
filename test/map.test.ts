import test from "node:test";
import assert from "node:assert/strict";
import { buildComprehensionMap, renderMap } from "../src/map.ts";
import type { LedgerEvent } from "../src/types.ts";

const base = { repo: "demo", branch: "main" };

test("aggregates confidence and AI-authored line ratio per file", () => {
  const events: LedgerEvent[] = [
    { ...base, id: "d1", ts: "2026-08-20T00:00:00.000Z", kind: "diff", authorship: "ai", files: [{ path: "src/a.ts", added: 80, removed: 20, hunks: 2 }] },
    { ...base, id: "c1", ts: "2026-08-20T00:01:00.000Z", kind: "confidence", diffId: "d1", score: 1 },
    { ...base, id: "d2", ts: "2026-08-21T00:00:00.000Z", kind: "diff", authorship: "human", files: [{ path: "src/a.ts", added: 100, removed: 0, hunks: 1 }] },
    { ...base, id: "c2", ts: "2026-08-21T00:01:00.000Z", kind: "confidence", diffId: "d2", score: 3 },
  ];
  const [row] = buildComprehensionMap(events, 90, new Date("2026-08-21T00:01:00.000Z"));
  assert.equal(row.path, "src/a.ts");
  assert.equal(row.aiRatio, 0.5);
  assert.ok(row.score! > 2 && row.score! < 2.01);
});

test("renders unrated files distinctly", () => {
  const events: LedgerEvent[] = [
    { ...base, id: "d1", ts: "2026-08-20T00:00:00.000Z", kind: "diff", authorship: "mixed", files: [{ path: "src/unknown.ts", added: 10, removed: 0, hunks: 1 }] },
  ];
  const output = renderMap(buildComprehensionMap(events));
  assert.match(output, /src\/unknown\.ts/);
  assert.match(output, /\?\s+50%/);
});

test("ages stale confidence toward opaque", () => {
  const events: LedgerEvent[] = [
    { ...base, id: "d1", ts: "2026-01-01T00:00:00.000Z", kind: "diff", authorship: "ai", files: [{ path: "legacy.ts", added: 10, removed: 0, hunks: 1 }] },
    { ...base, id: "c1", ts: "2026-01-01T00:00:00.000Z", kind: "confidence", diffId: "d1", score: 3 },
  ];
  const [row] = buildComprehensionMap(events, 90, new Date("2026-06-30T00:00:00.000Z"));
  assert.ok(row.score! > 1.49 && row.score! < 1.51);
});

test("uses a later ownership review as the current score", () => {
  const events: LedgerEvent[] = [
    { ...base, id: "d1", ts: "2026-08-20T00:00:00.000Z", kind: "diff", authorship: "ai", files: [{ path: "learned.ts", added: 10, removed: 0, hunks: 1 }] },
    { ...base, id: "c1", ts: "2026-08-20T00:01:00.000Z", kind: "confidence", diffId: "d1", score: 1 },
    { ...base, id: "r1", ts: "2026-08-21T00:01:00.000Z", kind: "review", diffId: "d1", newScore: 3 },
  ];
  const [row] = buildComprehensionMap(events, 90, new Date("2026-08-21T00:01:00.000Z"));
  assert.equal(row.score, 3);
});
