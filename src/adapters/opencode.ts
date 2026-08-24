import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GateConfig, HarnessAdapter } from "../types.ts";
import { privateCachePath } from "../storage.ts";

const execFileAsync = promisify(execFile);

export class OpenCodeAdapter implements HarnessAdapter {
  readonly name = "opencode";
  private root: string;
  private cliEntry: string;
  private nodeExec: string;

  constructor(root: string, cliEntry: string, nodeExec = process.execPath) {
    this.root = root;
    this.cliEntry = cliEntry;
    this.nodeExec = nodeExec;
  }

  async detect(): Promise<boolean> {
    try { await execFileAsync("opencode", ["--version"]); return true; } catch {}
    for (const path of [join(this.root, ".opencode"), join(this.root, "opencode.json"), join(this.root, "opencode.jsonc")]) {
      try { await access(path, constants.F_OK); return true; } catch {}
    }
    return false;
  }

  async install(_config: GateConfig): Promise<void> {
    const pluginPath = join(this.root, ".opencode", "plugins", "aperta.ts");
    await mkdir(dirname(pluginPath), { recursive: true });
    const entry = JSON.stringify(this.cliEntry);
    const node = JSON.stringify(this.nodeExec);
    const logDir = privateCachePath(this.root);
    await mkdir(logDir, { recursive: true });
    const plugin = `// Installed by Aperta. Safe to commit; it records lifecycle evidence in private user storage.\nimport { spawnSync } from "node:child_process"\nimport { appendFileSync, mkdirSync } from "node:fs"\n\nexport const Aperta = async ({ directory }: { directory: string }) => ({\n  event: async ({ event }: { event: { type: string; properties?: Record<string, any> } }) => {\n    const props = event.properties ?? {}\n    const sessionId = props.sessionID ?? props.sessionId ?? props.info?.id\n    if (!sessionId) return\n    const action = event.type === "session.created" ? "begin" : event.type === "session.idle" ? "end" : null\n    if (!action) return\n    const result = spawnSync(${node}, ["--no-warnings", "--experimental-strip-types", ${entry}, "hook", action, String(sessionId)], { cwd: directory, encoding: "utf8" })\n    if (result.error || result.status !== 0) {\n      const logDir = ${JSON.stringify(logDir)}\n      mkdirSync(logDir, { recursive: true })\n      appendFileSync(logDir + "/opencode-hook.log", new Date().toISOString() + " " + action + " " + (result.error?.message ?? result.stderr ?? ("exit " + result.status)) + "\\n")\n    }\n  },\n})\n`;
    await writeFile(pluginPath, plugin, "utf8");
  }

  async uninstall(): Promise<void> {
    await rm(join(this.root, ".opencode", "plugins", "aperta.ts"), { force: true });
  }
}
