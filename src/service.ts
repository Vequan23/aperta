import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectId } from "./registry.ts";
import { privateCachePath } from "./storage.ts";

const execFileAsync = promisify(execFile);
const label = (root: string) => `dev.aperta.observer.${projectId(root)}`;
const agentsDir = () => process.env.APERTA_LAUNCH_AGENTS ?? join(homedir(), "Library", "LaunchAgents");
const plistPath = (root: string) => join(agentsDir(), `${label(root)}.plist`);
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

function domain(): string {
  if (process.getuid === undefined) throw new Error("Login services are not supported on this platform");
  return `gui/${process.getuid()}`;
}

export async function loginServiceInstalled(root: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try { await readFile(plistPath(root), "utf8"); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export async function installLoginService(root: string, entryFile: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Automatic login startup currently supports macOS only");
  await mkdir(agentsDir(), { recursive: true });
  const log = privateCachePath(root, "engine.log");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label(root))}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string><string>--no-warnings</string><string>--experimental-strip-types</string>
    <string>${xml(entryFile)}</string><string>observe</string><string>--daemon</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
  <key>ProcessType</key><string>Background</string>
</dict></plist>\n`;
  await writeFile(plistPath(root), plist, "utf8");
  await execFileAsync("launchctl", ["bootout", domain(), plistPath(root)]).catch(() => {});
  await execFileAsync("launchctl", ["bootstrap", domain(), plistPath(root)]);
}

export async function uninstallLoginService(root: string): Promise<boolean> {
  if (!(await loginServiceInstalled(root))) return false;
  await execFileAsync("launchctl", ["bootout", domain(), plistPath(root)]).catch(() => {});
  await unlink(plistPath(root)).catch(() => {});
  return true;
}
