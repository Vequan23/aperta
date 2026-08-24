import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initializeStore } from "../src/ledger.ts";
import { executeProbe, generateProbes, probeHistory } from "../src/probes.ts";
import type { DiffEvent } from "../src/types.ts";
import type { ImpactGraph } from "../src/impact.ts";

const exec = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aperta-probe-lab-"));
  await exec("git", ["init", "-q", root]);
  await initializeStore(root);
  const testPath = "src/test/java/demo/JwtConfigurationTests.java";
  await mkdir(join(root, "src/test/java/demo"), { recursive: true });
  await writeFile(join(root, testPath), "package demo;\nclass JwtConfigurationTests {}\n");
  await writeFile(join(root, "pom.xml"), "<project></project>\n");
  await writeFile(join(root, "mvnw"), "#!/bin/sh\ntest -f src/test/java/demo/ApertaGeneratedSecurityProbeTest.java || exit 9\ngrep -q rejectsExpiredToken src/test/java/demo/ApertaGeneratedSecurityProbeTest.java || exit 8\necho isolated-probe-ok\n");
  await chmod(join(root, "mvnw"), 0o755);
  const diff: DiffEvent = { id: "jwt-probe", kind: "diff", ts: new Date().toISOString(), repo: "demo", branch: "main", authorship: "ai", files: [{ path: testPath, added: 30, removed: 0, hunks: 1 }] };
  const graph: ImpactGraph = { analyzer: "Java", headline: "Authentication moved into Spring Security’s resource-server pipeline", narrative: "", risk: "high", staleNotes: [], insights: [], unproven: ["Expired token rejection"], nodes: [
    { id: "method:decoder", label: "jwtDecoder", kind: "method", status: "modified" },
    { id: "config:resource", label: "OAuth2 resource server", kind: "config", status: "added" },
  ], edges: [] };
  return { root, diff, graph, testPath };
}

test("generates executable JWT probes and refuses to invent an endpoint target", async () => {
  const { root, diff, graph } = await fixture();
  const probes = await generateProbes(root, diff, graph);
  assert.equal(probes.length, 4);
  assert.equal(probes.find((probe) => probe.id === "jwt-expired")?.readiness, "ready");
  assert.match(probes.find((probe) => probe.id === "jwt-expired")?.source ?? "", /rejectsExpiredToken/);
  assert.equal(probes.find((probe) => probe.id === "jwt-endpoint")?.readiness, "needs-context");
});

test("runs a generated probe in a disposable copy and stores its evidence", async () => {
  const { root, diff, graph } = await fixture();
  const probe = (await generateProbes(root, diff, graph)).find((candidate) => candidate.id === "jwt-expired");
  assert.ok(probe);
  const result = await executeProbe(root, diff, probe);
  assert.equal(result.status, "proven");
  assert.match(result.output, /isolated-probe-ok/);
  await assert.rejects(access(join(root, probe.generatedPath)));
  assert.equal((await probeHistory(root, diff.id))[0].probeId, probe.id);
});
