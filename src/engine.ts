import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { UniversalGitObserver } from "./observer.ts";
import { privateCachePath } from "./storage.ts";

const cacheDir = (root: string) => privateCachePath(root);
const pidPath = (root: string) => privateCachePath(root, "engine.json");

export interface EngineInfo {
  running: boolean;
  pid?: number;
  root: string;
  startedAt?: string;
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export async function readEngineInfo(root: string): Promise<EngineInfo> {
  try {
    const saved = JSON.parse(await readFile(pidPath(root), "utf8")) as { pid: number; root: string; startedAt: string };
    return { ...saved, root, running: saved.root === root && Number.isInteger(saved.pid) && processAlive(saved.pid) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return { running: false, root };
    throw error;
  }
}

export async function startEngine(root: string, entryFile: string): Promise<EngineInfo & { alreadyRunning?: boolean }> {
  const current = await readEngineInfo(root);
  if (current.running) return { ...current, alreadyRunning: true };
  await mkdir(cacheDir(root), { recursive: true });
  const logFd = openSync(privateCachePath(root, "engine.log"), "a");
  const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", entryFile, "observe", "--daemon"], {
    cwd: root, detached: true, stdio: ["ignore", logFd, logFd],
  });
  try {
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  } finally { closeSync(logFd); }
  if (!child.pid) throw new Error("Observer process did not start");
  const info = { running: true, pid: child.pid, root, startedAt: new Date().toISOString() };
  await writeFile(pidPath(root), `${JSON.stringify(info, null, 2)}\n`, "utf8");
  child.unref();
  return info;
}

export async function writeEngineInfo(root: string, pid = process.pid): Promise<EngineInfo> {
  await mkdir(cacheDir(root), { recursive: true });
  const info = { running: true, pid, root, startedAt: new Date().toISOString() };
  await writeFile(pidPath(root), `${JSON.stringify(info, null, 2)}\n`, "utf8");
  return info;
}

export async function stopEngine(root: string): Promise<{ stopped: boolean; wasRunning: boolean }> {
  const info = await readEngineInfo(root);
  if (!info.running || !info.pid) {
    await unlink(pidPath(root)).catch(() => {});
    return { stopped: false, wasRunning: false };
  }
  process.kill(info.pid, "SIGTERM");
  for (let attempt = 0; attempt < 20 && processAlive(info.pid); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const stopped = !processAlive(info.pid);
  if (stopped) await unlink(pidPath(root)).catch(() => {});
  return { stopped, wasRunning: true };
}

export async function runObserverDaemon(root: string): Promise<void> {
  await writeEngineInfo(root);
  const observer = new UniversalGitObserver(root, 8_000, 2_000, "daemon");
  await observer.start();
  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    process.once("SIGTERM", finish);
    process.once("SIGINT", finish);
  });
  observer.stop();
  const info = await readEngineInfo(root);
  if (info.pid === process.pid) await unlink(pidPath(root)).catch(() => {});
}
