import assert from "node:assert/strict";
import test from "node:test";
import { assertSkillAllowsAction, selectAgentSkill, skillPrompt } from "../src/skills.ts";

test("skill selection is deterministic and prioritizes the requested outcome", () => {
  assert.equal(selectAgentSkill("Explain how authentication works.").id, "explain-code");
  assert.equal(selectAgentSkill("Run the tests and report the result.").id, "verify-project");
  assert.equal(selectAgentSkill("Fix the failing compiler checks.").id, "debug-failing-behavior");
  assert.equal(selectAgentSkill("Add a health endpoint.").id, "implement-proven-change");
  assert.equal(selectAgentSkill("Is Redis running on the configured port?").id, "observe-runtime");
});

test("read-only skills reject mutation while change skills permit it", () => {
  const explain = selectAgentSkill("Explain how authentication works.");
  assert.doesNotThrow(() => assertSkillAllowsAction(explain, { action: "read", path: "src/auth.ts" }));
  assert.throws(() => assertSkillAllowsAction(explain, { action: "write", path: "src/auth.ts" }), /does not permit repository\.write/);
  const implementation = selectAgentSkill("Add an authentication endpoint.");
  assert.doesNotThrow(() => assertSkillAllowsAction(implementation, { action: "write", path: "src/auth.ts" }));
});

test("skill prompts expose bounded tools, proof requirements, and learning objectives", () => {
  const selected = selectAgentSkill("Fix the failing compiler checks.");
  const prompt = skillPrompt(selected);
  assert.equal(prompt.id, "debug-failing-behavior");
  assert.ok(prompt.allowedTools.includes("checks.run"));
  assert.ok(prompt.proofRequirements.some((item) => item.id === "repair-verified"));
  assert.ok(prompt.learningObjectives.some((item) => /failure/i.test(item)));
});
