import type { GateConfig, HarnessAdapter } from "../types.ts";

export class GitOnlyAdapter implements HarnessAdapter {
  readonly name = "git-only";
  async detect(): Promise<boolean> { return true; }
  async install(_config: GateConfig): Promise<void> {}
  async uninstall(): Promise<void> {}
}
