import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listProjects, registerProject, resolveProject } from "../src/registry.ts";

const exec = promisify(execFile);

test("registers and safely resolves multiple local projects", async () => {
  const registry = await mkdtemp(join(tmpdir(), "aperta-registry-home-"));
  process.env.APERTA_HOME = registry;
  const first = await mkdtemp(join(tmpdir(), "aperta-project-one-"));
  const second = await mkdtemp(join(tmpdir(), "aperta-project-two-"));
  await exec("git", ["init", "-q", first]);
  await exec("git", ["init", "-q", second]);
  const one = await registerProject(first, new Date("2026-01-01T00:00:00.000Z"));
  const two = await registerProject(second, new Date("2026-01-02T00:00:00.000Z"));
  const projects = await listProjects();
  assert.deepEqual(projects.map((project) => project.id), [two.id, one.id]);
  assert.equal(projects.every((project) => project.available), true);
  assert.equal((await resolveProject(one.id, second)).root, first);
  await assert.rejects(() => resolveProject("not-registered", first), /not registered/);
  delete process.env.APERTA_HOME;
});
