import test from "node:test";
import assert from "node:assert/strict";
import { cancelJob, getJob, startJob } from "../src/jobs.ts";
import { cleanExecutionOutput, safeEnvironment } from "../src/execution.ts";

test("tracks and cancels a visible execution job", async () => {
  const job = startJob("proof", "slow proof", (signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    setTimeout(() => resolve({ ok: true }), 100);
  }));
  assert.equal(cancelJob(job.id), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(getJob(job.id)?.state, "canceled");
});

test("minimizes the child environment and redacts common secrets", () => {
  const env = safeEnvironment();
  assert.equal(env.CI, "true");
  assert.equal("AWS_SECRET_ACCESS_KEY" in env, false);
  assert.equal(cleanExecutionOutput("token=abc123 Authorization: Bearer xyz.123"), "token=[REDACTED] Authorization: Bearer [REDACTED]");
});
