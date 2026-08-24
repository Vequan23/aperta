import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("ownership file controls preserve full accessible names and readable identifiers", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  const styles = await readFile(join(root, "dashboard/src/style.css"), "utf8");
  assert.match(app, /:aria-label="`Review \$\{file\.path\}/);
  assert.match(app, /readableIdentifier\(symbol\)/);
  assert.match(styles, /\.changed-file:focus-visible/);
  assert.match(styles, /\.theme-panther \.changed-file\.active small \{ color: #f0f8fc; \}/);
});

test("dashboard typography never declares text below the 12px accessibility floor", async () => {
  const root = join(import.meta.dirname, "..");
  const styles = await readFile(join(root, "dashboard/src/style.css"), "utf8");
  const declaredSizes = [...styles.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(match => Number(match[1]));
  const shorthandSizes = [...styles.matchAll(/(?:^|[;{])\s*font:\s*[^;{}]*?(\d+(?:\.\d+)?)px/gm)].map(match => Number(match[1]));
  assert.deepEqual([...declaredSizes, ...shorthandSizes].filter(size => size < 12), []);
  assert.match(styles, /\.window small \{ font-size: 12px; \}/);
  assert.match(styles, /\.window \{ width: min\(1640px, 100%\)/);
});

test("agent composer sends on Enter while preserving Shift Enter for new lines", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  assert.match(app, /@keydown\.enter\.exact\.prevent="startAgentRun"/);
  assert.match(app, /Enter to send · Shift\+Enter for a new line/);
});

test("completed agent responses open the most useful result and render responses first", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  assert.match(app, /agentIntent\.value = ""/);
  assert.match(app, /run\.status === "no-changes"[\s\S]{0,100}\? "changes"/);
  assert.match(app, /run\?\.status === "no-changes" \? "changes" : "activity"/);
  assert.match(app, /selectedAgentRun\.status === "no-changes" \? "Response" : "Changes"/);
  assert.match(app, /v-if="selectedAgentRun\.status !== 'no-changes'"/);
  assert.match(app, /selectedAgentRun\.verification\.baseline \|\| selectedAgentRun\.verification\.attempts\.length/);
  assert.match(app, /agentUnderstandingHeadline\(selectedAgentRun\)/);
  assert.match(app, /agentActivityPanel\.value\?\.scrollTo/);
  assert.match(app, /class="agent-response-card"/);
  assert.match(app, /<strong>Response<\/strong>/);
  assert.match(app, /class="activity-command"/);
  assert.match(app, /activity-evidence[\s\S]{0,80}action\.evidenceStatus/);
});

test("agent workbench routes to model settings and preserves a return path", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  assert.match(app, /async function showAgentModelSettings\(\)/);
  assert.match(app, /@click="showAgentModelSettings"/);
  assert.match(app, />\s*Model settings\s*<\/button>/);
  assert.match(app, /v-if="settingsOpenedFromAgents"/);
  assert.match(app, /@click="returnToAgentWorkbench"/);
  assert.match(app, /← Agent Workbench/);
});

test("no-change responses own a bounded scroll region on the Changes tab", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  const styles = await readFile(join(root, "dashboard/src/style.css"), "utf8");
  assert.match(styles, /\.agent-no-change \{[^}]*grid-template-rows: auto minmax\(0,1fr\)[^}]*overflow: hidden/);
  assert.match(styles, /\.agent-no-change > section \{[^}]*min-height: 0[^}]*display: flex/);
  assert.match(styles, /\.agent-no-change > section > \.agent-markdown \{[^}]*flex: 1[^}]*overflow: auto/);
  assert.match(app, /<AgentMarkdown[\s\S]{0,120}:source="selectedAgentRun\.summary"[\s\S]{0,120}aria-label="Agent response"/);
  assert.match(app, /class="proof-loop-evidence"/);
  assert.match(app, /aria-label="Harness capability evidence"/);
  assert.match(styles, /\.proof-loop-evidence \{[^}]*grid-template-columns: repeat\(auto-fit,minmax\(230px,1fr\)\)/);
});

test("activity response Markdown is isolated from timeline layout rules", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  const styles = await readFile(join(root, "dashboard/src/style.css"), "utf8");
  assert.match(app, /class="agent-response-head"/);
  assert.doesNotMatch(styles, /\.agent-response-card > div \{/);
  assert.doesNotMatch(styles, /\.agent-activity-feed li \{/);
  assert.doesNotMatch(styles, /\.agent-activity-feed ol \{/);
  assert.match(styles, /\.agent-activity-feed > ol > li \{/);
});

test("proof graph responses use structured Markdown in a bounded region", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  const styles = await readFile(join(root, "dashboard/src/style.css"), "utf8");
  assert.match(app, /<AgentMarkdown class="proof-claim-detail" :source="claim\.detail" \/>/);
  assert.match(styles, /\.proof-claim-detail\.agent-markdown \{[^}]*max-height: 320px[^}]*overflow: auto/);
});

test("understanding evidence cannot overflow its grid card", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  const styles = await readFile(join(root, "dashboard/src/style.css"), "utf8");
  assert.match(app, /readableIdentifier\(proof\)/);
  assert.match(app, /readableIdentifier\(item\)/);
  assert.match(styles, /\.understanding-grid li \{[^}]*max-width: 100%[^}]*overflow-wrap: anywhere[^}]*word-break: break-word/);
});

test("repository opens directly on the explorer without a marketing hero", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  assert.doesNotMatch(app, /class="thesis-strip"/);
  assert.doesNotMatch(app, /THE COMPREHENSION GAP/);
});

test("Lucide navigation icons do not leak replacement chevrons into labels", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  const styles = await readFile(join(root, "dashboard/src/style.css"), "utf8");
  assert.match(app, /from "@lucide\/vue"/);
  assert.doesNotMatch(app, /<\/(?:Sparkles|LayoutGrid|ListChecks|RefreshCw|GitFork|Clock3|NotebookPen|Activity|Gauge|Settings)>\s*&gt;/);
  assert.doesNotMatch(app, /<\w+[^>]*class="nav-icon"[^>]*\/>\s*>\s*(?:\{\{|<span)/);
  assert.match(app, /:is="agentActionIcon\(action\)"/);
  assert.match(app, /:is="observerActivityIcon\(entry\)"/);
  assert.match(app, /:is="harnessSignalIcon\(signal\)"/);
  assert.match(app, /class="harness-privacy-icon"/);
  assert.match(app, /<X class="nav-icon" aria-hidden="true" \/>/);
  assert.match(app, /class="close-review icon-close"/);
  assert.match(styles, /\.icon-close \{ width: 30px; height: 30px;/);
});

test("collapsed navigation exposes keyboard and pointer tooltips", async () => {
  const root = join(import.meta.dirname, "..");
  const app = await readFile(join(root, "dashboard/src/App.vue"), "utf8");
  const styles = await readFile(join(root, "dashboard/src/style.css"), "utf8");
  assert.match(app, /@mouseenter="showNavTooltip\(\$event, 'Agent Workbench'\)"/);
  assert.match(app, /@focus="showNavTooltip\(\$event, 'Repository'\)"/);
  assert.match(app, /class="collapsed-nav-tooltip"/);
  assert.match(app, /role="tooltip"/);
  assert.match(styles, /\.collapsed-nav-tooltip \{ position: fixed;/);
});
