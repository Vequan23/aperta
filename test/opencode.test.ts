import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenCodeAdapter } from "../src/adapters/opencode.ts";
import { defaultConfig } from "../src/ledger.ts";

test("detects a project configuration and installs an automatic observer", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-opencode-"));
  await mkdir(join(root, ".opencode"));
  const adapter = new OpenCodeAdapter(root, "/opt/aperta/src/cli.ts", "/opt/node/bin/node");
  assert.equal(await adapter.detect(), true);
  await adapter.install(defaultConfig.gate);
  const plugin = await readFile(join(root, ".opencode/plugins/aperta.ts"), "utf8");
  assert.match(plugin, /session\.created/);
  assert.match(plugin, /session\.idle/);
  assert.match(plugin, /\/opt\/aperta\/src\/cli\.ts/);
  assert.match(plugin, /\/opt\/node\/bin\/node/);
  assert.doesNotMatch(plugin, /spawnSync\(process\.execPath/);
  assert.match(plugin, /opencode-hook\.log/);
});
