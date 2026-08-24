import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";

export interface RegisteredProject {
  id: string;
  name: string;
  root: string;
  addedAt: string;
  lastOpenedAt: string;
  available?: boolean;
}

function registryDir(): string { return process.env.APERTA_HOME ? resolve(process.env.APERTA_HOME) : join(homedir(), ".aperta"); }
function registryFile(): string { return join(registryDir(), "projects.json"); }
export function projectId(root: string): string { return createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16); }

async function readRaw(): Promise<RegisteredProject[]> {
  try {
    const parsed = JSON.parse(await readFile(registryFile(), "utf8"));
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeRegistry(projects: RegisteredProject[]): Promise<void> {
  await mkdir(registryDir(), { recursive: true });
  const temporary = join(registryDir(), `projects.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`, "utf8");
  await rename(temporary, registryFile());
}

export async function registerProject(root: string, now = new Date()): Promise<RegisteredProject> {
  const canonical = resolve(root);
  const projects = await readRaw();
  const id = projectId(canonical);
  const existing = projects.find((project) => project.id === id);
  const entry: RegisteredProject = {
    id, name: basename(canonical), root: canonical,
    addedAt: existing?.addedAt ?? now.toISOString(), lastOpenedAt: now.toISOString(),
  };
  await writeRegistry([entry, ...projects.filter((project) => project.id !== id)]);
  return entry;
}

export async function listProjects(): Promise<RegisteredProject[]> {
  const projects = await readRaw();
  return Promise.all(projects.map(async (project) => {
    try { const git = await stat(join(project.root, ".git")); return { ...project, available: git.isDirectory() || git.isFile() }; }
    catch { return { ...project, available: false }; }
  }));
}

export async function resolveProject(id: string | undefined, fallbackRoot: string): Promise<RegisteredProject> {
  const fallbackId = projectId(fallbackRoot);
  const projects = await listProjects();
  const fallback = projects.find((entry) => entry.id === fallbackId) ?? await registerProject(fallbackRoot);
  if (!id || id === fallback.id) return fallback;
  const project = projects.find((entry) => entry.id === id && entry.available);
  if (!project) throw new Error("Project is not registered or is unavailable");
  return project;
}
