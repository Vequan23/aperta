import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ApertaConfig, BaseEvent, DiffEvent, LedgerEvent } from "./types.ts";
import { initializePrivateStorage, privateCachePath, privateProjectDir } from "./storage.ts";

export const LEDGER_FILE = "ledger.jsonl";
const EVENT_KINDS = new Set(["intent", "diff", "confidence", "explanation", "ownership-evidence", "proof", "session-complete", "probe", "review", "queue-disposition", "bypass"]);
type StoredEvent = LedgerEvent & { _prevHash?: string; _hash?: string };

function validateEvent(value: unknown, line?: number): asserts value is StoredEvent {
  const event = value as Record<string, unknown> | null;
  const where = line ? ` at line ${line}` : "";
  if (!event || typeof event !== "object" || typeof event.id !== "string" || typeof event.ts !== "string" || !Number.isFinite(Date.parse(event.ts)) || typeof event.repo !== "string" || typeof event.branch !== "string" || typeof event.kind !== "string" || !EVENT_KINDS.has(event.kind)) throw new Error(`Invalid ledger event${where}`);
  if (event.kind === "diff" && !Array.isArray(event.files)) throw new Error(`Invalid diff event${where}`);
  if (["confidence", "explanation", "ownership-evidence", "proof", "session-complete", "probe", "review", "queue-disposition"].includes(event.kind) && typeof event.diffId !== "string") throw new Error(`Missing diff reference${where}`);
}

function digest(event: Omit<StoredEvent, "_hash">) { return createHash("sha256").update(JSON.stringify(event)).digest("hex"); }
function publicEvent(event: StoredEvent): LedgerEvent { const { _hash, _prevHash, ...value } = event; return value as LedgerEvent; }
async function withLedgerLock<T>(root: string, task: () => Promise<T>): Promise<T> {
  const lock = privateCachePath(root, "ledger.lock");
  await mkdir(privateCachePath(root), { recursive: true });
  const deadline = Date.now() + 5_000;
  while (true) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { if (Date.now() - (await stat(lock)).mtimeMs > 15_000) { await rm(lock, { recursive: true }); continue; } } catch {}
      if (Date.now() >= deadline) throw new Error("Ledger is busy; another Aperta process is writing.");
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  try { return await task(); } finally { await rm(lock, { recursive: true, force: true }); }
}

export const defaultConfig: ApertaConfig = {
  version: 1,
  adapter: "git-only",
  ratingTimeoutSeconds: 15,
  confidenceHalfLifeDays: 90,
  gate: {
    enabled: false,
    trigger: "ai",
    lineThreshold: 50,
    confidenceThreshold: 2,
  },
  review: {
    ignorePatterns: [],
  },
};

export async function initializeStore(root: string): Promise<boolean> {
  return initializePrivateStorage(root, defaultConfig);
}

export async function readConfig(root: string): Promise<ApertaConfig> {
  await initializeStore(root);
  const raw = await readFile(join(privateProjectDir(root), "config.json"), "utf8");
  const parsed = JSON.parse(raw) as Partial<ApertaConfig>;
  const review = { ...defaultConfig.review, ...parsed.review };
  return { ...defaultConfig, ...parsed, gate: { ...defaultConfig.gate, ...parsed.gate }, review: { ignorePatterns: normalizeReviewIgnorePatterns(review.ignorePatterns) } };
}

export function normalizeReviewIgnorePatterns(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("Review ignore patterns must be a list");
  const patterns = [...new Set(input.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
  if (patterns.length > 24) throw new Error("Use no more than 24 review ignore patterns");
  for (const pattern of patterns) {
    if (pattern.length > 240) throw new Error("Review ignore patterns must be 240 characters or fewer");
    try { new RegExp(pattern, "u"); }
    catch { throw new Error(`Invalid review ignore regex: ${pattern}`); }
  }
  return patterns;
}

export async function saveReviewIgnorePatterns(root: string, input: unknown): Promise<string[]> {
  const ignorePatterns = normalizeReviewIgnorePatterns(input);
  const config = await readConfig(root);
  const file = join(privateProjectDir(root), "config.json");
  const temporary = join(privateProjectDir(root), `config.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify({ ...config, review: { ignorePatterns } }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
  return ignorePatterns;
}

export async function readLedger(root: string): Promise<LedgerEvent[]> {
  try {
    await initializeStore(root);
    const raw = await readFile(join(privateProjectDir(root), LEDGER_FILE), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line, index) => {
        try {
          const event = JSON.parse(line) as StoredEvent;
          validateEvent(event, index + 1);
          if (event._hash) { const { _hash, ...unsigned } = event; if (digest(unsigned) !== _hash) throw new Error(`Ledger integrity check failed at line ${index + 1}`); }
          return publicEvent(event);
        } catch {
          throw new Error(`Invalid JSON in ledger at line ${index + 1}`);
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function appendEvent(root: string, event: LedgerEvent): Promise<void> {
  await appendEvents(root, [event]);
}

export async function appendEvents(root: string, events: LedgerEvent[]): Promise<void> {
  if (!events.length) return;
  await initializeStore(root);
  for (const event of events) validateEvent(event);
  await withLedgerLock(root, async () => {
    const file = join(privateProjectDir(root), LEDGER_FILE);
    const raw = await readFile(file, "utf8");
    const last = raw.trim().split("\n").filter(Boolean).at(-1);
    let previous = "";
    if (last) { const parsed = JSON.parse(last) as StoredEvent; validateEvent(parsed); previous = parsed._hash ?? ""; }
    const lines = events.map((event) => {
      const unsigned = { ...event, _prevHash: previous } as Omit<StoredEvent, "_hash">;
      const stored = { ...unsigned, _hash: digest(unsigned) } as StoredEvent;
      previous = stored._hash!;
      return JSON.stringify(stored);
    });
    await appendFile(file, `${lines.join("\n")}\n`, "utf8");
  });
}

export async function appendDiffEventIfNew(root: string, diff: DiffEvent): Promise<{ diff: DiffEvent; inserted: boolean }> {
  await initializeStore(root);
  validateEvent(diff);
  return withLedgerLock(root, async () => {
    const file = join(privateProjectDir(root), LEDGER_FILE);
    const raw = await readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    for (const line of lines) {
      const event = JSON.parse(line) as StoredEvent;
      validateEvent(event);
      if (event.kind === "diff" && diff.fingerprint && event.fingerprint === diff.fingerprint) {
        return { diff: publicEvent(event) as DiffEvent, inserted: false };
      }
    }
    const last = lines.at(-1);
    let previous = "";
    if (last) { const parsed = JSON.parse(last) as StoredEvent; validateEvent(parsed); previous = parsed._hash ?? ""; }
    const unsigned = { ...diff, _prevHash: previous } as Omit<StoredEvent, "_hash">;
    const stored = { ...unsigned, _hash: digest(unsigned) } as StoredEvent;
    await appendFile(file, `${JSON.stringify(stored)}\n`, "utf8");
    return { diff, inserted: true };
  });
}

export async function auditLedger(root: string) {
  try {
    await initializeStore(root);
    const raw = await readFile(join(privateProjectDir(root), LEDGER_FILE), "utf8");
    let previous = "", chained = 0, legacy = 0;
    const lines = raw.split("\n").filter(Boolean);
    for (let index = 0; index < lines.length; index++) {
      const event = JSON.parse(lines[index]) as StoredEvent; validateEvent(event, index + 1);
      if (!event._hash) { legacy++; previous = ""; continue; }
      const { _hash, ...unsigned } = event;
      if (event._prevHash !== previous || digest(unsigned) !== _hash) throw new Error(`Ledger integrity check failed at line ${index + 1}`);
      previous = _hash; chained++;
    }
    return { valid: true, events: lines.length, chained, legacy, error: null as string | null };
  } catch (error) { return { valid: false, events: 0, chained: 0, legacy: 0, error: error instanceof Error ? error.message : String(error) }; }
}

export async function repairLedger(root: string) {
  await initializeStore(root);
  return withLedgerLock(root, async () => {
    const file = join(privateProjectDir(root), LEDGER_FILE);
    const raw = await readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean), valid: string[] = [];
    let previous = "";
    for (let index = 0; index < lines.length; index++) {
      try {
        const event = JSON.parse(lines[index]) as StoredEvent; validateEvent(event, index + 1);
        if (event._hash) { const { _hash, ...unsigned } = event; if (event._prevHash !== previous || digest(unsigned) !== _hash) throw new Error("integrity mismatch"); previous = _hash; }
        else previous = "";
        valid.push(lines[index]);
      } catch { break; }
    }
    if (valid.length === lines.length) return { repaired: false, recovered: lines.length, backup: null as string | null };
    const backup = join(privateProjectDir(root), `ledger.recovery.${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
    await writeFile(backup, raw, "utf8");
    await writeFile(file, valid.length ? `${valid.join("\n")}\n` : "", "utf8");
    return { repaired: true, recovered: valid.length, backup };
  });
}

export async function writeDiffEvidence(root: string, diffId: string, patch: string): Promise<void> {
  const dir = privateCachePath(root, "diffs");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${diffId}.patch`), patch, "utf8");
}

export async function readDiffEvidence(root: string, diffId: string): Promise<string> {
  if (!/^[a-f0-9-]+$/i.test(diffId)) throw new Error("Invalid diff id");
  try {
    return await readFile(privateCachePath(root, "diffs", `${diffId}.patch`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export function eventBase(root: string, branch: string, now = new Date()): BaseEvent {
  return {
    id: randomUUID(),
    ts: now.toISOString(),
    repo: basename(root),
    branch,
  };
}
