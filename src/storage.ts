import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const APERTA_DIR = ".comprehension";
export const PROJECT_FILE = "project.json";

export interface ProjectIdentity {
  version: 1;
  id: string;
  createdAt: string;
}

export interface StorageMigration {
  migrated: string[];
  previouslyTracked: string[];
  privateDirectory: string;
}

const migrations = new Map<string, StorageMigration>();
const initialized = new Set<string>();

export function apertaHome(): string {
  if (process.env.APERTA_HOME) return resolve(process.env.APERTA_HOME);
  if (process.env.NODE_TEST_CONTEXT) return join(tmpdir(), "aperta-test-home");
  return join(homedir(), ".aperta");
}

function fallbackId(root: string) {
  return createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24);
}

export function projectIdentity(root: string): ProjectIdentity {
  try {
    const parsed = JSON.parse(readFileSync(join(root, APERTA_DIR, PROJECT_FILE), "utf8"));
    if (parsed?.version === 1 && typeof parsed.id === "string" && /^[a-f0-9-]{16,64}$/i.test(parsed.id)) return parsed;
  } catch {}
  return { version: 1, id: fallbackId(root), createdAt: new Date(0).toISOString() };
}

export function privateProjectDir(root: string): string {
  return join(apertaHome(), "repositories", projectIdentity(root).id);
}

export function privateCachePath(root: string, ...parts: string[]): string {
  return join(privateProjectDir(root), "cache", ...parts);
}

async function exists(path: string) {
  try { await stat(path); return true; } catch { return false; }
}

async function hardenPrivatePath(path: string): Promise<void> {
  const details = await lstat(path);
  if (details.isSymbolicLink()) return;
  if (details.isDirectory()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path)) await hardenPrivatePath(join(path, entry));
    return;
  }
  if (details.isFile()) await chmod(path, 0o600);
}

async function trackedLegacyFiles(root: string) {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "--", `${APERTA_DIR}/config.json`, `${APERTA_DIR}/ledger.jsonl`, `${APERTA_DIR}/cache`], { cwd: root, maxBuffer: 64_000 });
    return stdout.split("\n").filter(Boolean);
  } catch { return []; }
}

async function movePrivate(source: string, destination: string, backupDir: string) {
  if (!(await exists(source))) return false;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  if (await exists(destination)) {
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backup = join(backupDir, source.split("/").at(-1) ?? "legacy-data");
    try { await rename(source, backup); }
    catch { await cp(source, backup, { recursive: true }); await rm(source, { recursive: true, force: true }); }
    return true;
  }
  try { await rename(source, destination); }
  catch { await cp(source, destination, { recursive: true }); await rm(source, { recursive: true, force: true }); }
  return true;
}

export async function initializePrivateStorage(root: string, defaultConfig: unknown): Promise<boolean> {
  const canonical = resolve(root);
  if (initialized.has(canonical)) return false;
  const publicDir = join(root, APERTA_DIR);
  const identityPath = join(publicDir, PROJECT_FILE);
  let created = false;
  await mkdir(publicDir, { recursive: true });
  let identity: ProjectIdentity;
  try {
    identity = JSON.parse(await readFile(identityPath, "utf8"));
    if (identity.version !== 1 || !/^[a-f0-9-]{16,64}$/i.test(identity.id)) throw new Error("invalid project identity");
  } catch {
    const candidate: ProjectIdentity = { version: 1, id: randomUUID(), createdAt: new Date().toISOString() };
    try {
      await writeFile(identityPath, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" });
      identity = candidate;
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      identity = JSON.parse(await readFile(identityPath, "utf8"));
    }
  }

  const privateDir = join(apertaHome(), "repositories", identity.id);
  const cacheDir = join(privateDir, "cache");
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const previouslyTracked = await trackedLegacyFiles(root);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(privateDir, "migration", stamp);
  const migrated: string[] = [];
  for (const [name, destination] of [
    ["config.json", join(privateDir, "config.json")],
    ["ledger.jsonl", join(privateDir, "ledger.jsonl")],
    ["cache", cacheDir],
  ] as const) {
    if (await movePrivate(join(publicDir, name), destination, backupDir)) migrated.push(name);
  }
  if (!(await exists(join(privateDir, "config.json")))) await writeFile(join(privateDir, "config.json"), `${JSON.stringify(defaultConfig, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (!(await exists(join(privateDir, "ledger.jsonl")))) await writeFile(join(privateDir, "ledger.jsonl"), "", { encoding: "utf8", mode: 0o600 });
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await writeFile(join(publicDir, ".gitignore"), "*\n!.gitignore\n!project.json\n", "utf8");
  if (migrated.length || previouslyTracked.length) {
    const migration = { migrated, previouslyTracked, privateDirectory: privateDir };
    migrations.set(resolve(root), migration);
    await writeFile(join(privateDir, "migration.json"), `${JSON.stringify({ ...migration, migratedAt: new Date().toISOString(), source: resolve(root) }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  await hardenPrivatePath(privateDir);
  initialized.add(canonical);
  return created;
}

export function storageMigration(root: string): StorageMigration | null {
  return migrations.get(resolve(root)) ?? null;
}

export async function inspectStoragePrivacy(root: string) {
  const legacy = await Promise.all(["config.json", "ledger.jsonl", "cache"].map(async (name) => (await exists(join(root, APERTA_DIR, name))) ? `${APERTA_DIR}/${name}` : null));
  return {
    privateDirectory: privateProjectDir(root),
    repositoryIdentity: join(root, APERTA_DIR, PROJECT_FILE),
    legacyPaths: legacy.filter((path): path is string => Boolean(path)),
    trackedPrivatePaths: await trackedLegacyFiles(root),
  };
}
