import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { executeProof, loadDashboardState, loadImpactGraph, loadOwnershipBrief, loadProbeLab, loadProofBrief, recordOwnershipReview, recordQueueDisposition, runGeneratedProbe } from "./dashboard-data.ts";
import { UniversalGitObserver, readObserverActivity, readObserverStatus } from "./observer.ts";
import { readEngineInfo } from "./engine.ts";
import { listProjects, registerProject, resolveProject } from "./registry.ts";
import { cancelJob, getJob, startJob } from "./jobs.ts";
import { coachStatusFromConfig, generateCoachDebrief, resolveCoachConfig } from "./coach.ts";
import { readRepositoryFile } from "./repository.ts";
import { activeAgentRuntime, activeModelConfig, activateModelProfile, assignModelRole, deleteModelProfile, inspectModelProvider, publicModelSettings, retestModelProfile, saveAgentRuntime, saveModelProfile, type ModelRole } from "./settings.ts";
import { applyAgentRun, listAgentConversations, runExternalAgent, runModelAgent, saveAgentUnderstanding } from "./agent-harness.ts";
import { buildHarnessHealth } from "./harness-intelligence.ts";
import { readGitWorkingStatus } from "./git.ts";
import { loadRepositoryProofGraph } from "./proof-graph.ts";
import { initializeStore } from "./ledger.ts";
import { inspectProjectInitialization } from "./storage.ts";

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

class DashboardHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

export async function startDashboard(root: string, port: number, shouldOpen = true): Promise<void> {
  await startDashboardServer(root, port, shouldOpen, true);
}

export async function startDashboardApi(root: string, port: number): Promise<Server> {
  return startDashboardServer(root, port, false, false);
}

async function startDashboardServer(root: string, port: number, shouldOpen: boolean, serveAssets: boolean): Promise<Server> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const adjacentDist = join(moduleDir, "../dashboard/dist");
  let dist = adjacentDist;
  if (serveAssets) {
    try { await stat(join(adjacentDist, "index.html")); }
    catch { dist = join(moduleDir, "../../dashboard/dist"); }
    try {
      await stat(join(dist, "index.html"));
    } catch {
      throw new Error("Dashboard assets are missing. Run `npm run build` in the Aperta project first.");
    }
  }

  await registerProject(root);
  const observers = new Map<string, UniversalGitObserver>();
  async function observerContext(targetRoot: string) {
    const engine = await readEngineInfo(targetRoot);
    const existing = observers.get(targetRoot);
    if (engine.running) {
      if (existing) { existing.stop(); observers.delete(targetRoot); }
      return { status: await readObserverStatus(targetRoot), activity: await readObserverActivity(targetRoot) };
    }
    let observer = existing;
    if (!observer) { observer = new UniversalGitObserver(targetRoot); await observer.start(); observers.set(targetRoot, observer); }
    return { status: observer.getStatus(), activity: await readObserverActivity(targetRoot) };
  }
  await observerContext(root);
  async function requireInitialized(targetRoot: string) {
    const status = await inspectProjectInitialization(targetRoot);
    if (!status.initialized) throw new DashboardHttpError(409, "Aperta is not initialized for this project. Initialize it before using agents, captures, reviews, or learning memory.");
    return status;
  }
  async function runtimeCoachConfig(role: ModelRole = "builder") { return await activeModelConfig(role) ?? resolveCoachConfig(); }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/api/state") {
        const project = await resolveProject(url.searchParams.get("project") ?? undefined, root);
        const initialization = await inspectProjectInitialization(project.root);
        const observed = initialization.initialized ? await observerContext(project.root) : { status: undefined, activity: [] };
        const projects = await listProjects();
        const dashboard = await loadDashboardState(project.root, observed.status, observed.activity, initialization);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ ...dashboard, initialization, projectId: project.id,
          projects: projects.map(({ id, name, available }) => ({ id, name, available })) }));
        return;
      }
      if (url.pathname === "/api/project" && request.method === "POST") {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 100_000) throw new Error("Project request is too large"); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (body.action !== "initialize") throw new Error("Unknown project action");
        const project = await resolveProject(body.projectId, root);
        await initializeStore(project.root);
        await observerContext(project.root);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ initialization: await inspectProjectInitialization(project.root) }));
        return;
      }
      if (url.pathname === "/api/ownership" && request.method === "GET") {
        const project = await resolveProject(url.searchParams.get("project") ?? undefined, root);
        await requireInitialized(project.root);
        const payload = await loadOwnershipBrief(project.root, url.searchParams.get("diffId") ?? "");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/file" && request.method === "GET") {
        const project = await resolveProject(url.searchParams.get("project") ?? undefined, root);
        const payload = await readRepositoryFile(project.root, url.searchParams.get("path") ?? "");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/git" && request.method === "GET") {
        const project = await resolveProject(url.searchParams.get("project") ?? undefined, root);
        const payload = await readGitWorkingStatus(project.root);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/impact" && request.method === "GET") {
        const project = await resolveProject(url.searchParams.get("project") ?? undefined, root);
        await requireInitialized(project.root);
        const payload = await loadImpactGraph(project.root, url.searchParams.get("diffId") ?? "");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/proof" && request.method === "GET") {
        const project = await resolveProject(url.searchParams.get("project") ?? undefined, root);
        await requireInitialized(project.root);
        const payload = await loadProofBrief(project.root, url.searchParams.get("diffId") ?? "");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/proof" && request.method === "POST") {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 100_000) throw new Error("Proof request is too large"); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const project = await resolveProject(body.projectId, root);
        await requireInitialized(project.root);
        const job = startJob("proof", `Proof for ${body.diffId ?? "capture"}`, (signal) => executeProof(project.root, body.diffId ?? "", signal));
        response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ job }));
        return;
      }
      if (url.pathname === "/api/probes" && request.method === "GET") {
        const project = await resolveProject(url.searchParams.get("project") ?? undefined, root);
        await requireInitialized(project.root);
        const payload = await loadProbeLab(project.root, url.searchParams.get("diffId") ?? "");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/probes" && request.method === "POST") {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 100_000) throw new Error("Probe request is too large"); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const project = await resolveProject(body.projectId, root);
        await requireInitialized(project.root);
        const job = startJob("probe", `Probe ${body.probeId ?? ""}`, (signal) => runGeneratedProbe(project.root, body.diffId ?? "", body.probeId ?? "", signal));
        response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ job }));
        return;
      }
      if (url.pathname === "/api/coach" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ status: coachStatusFromConfig(await runtimeCoachConfig("coach")) }));
        return;
      }
      if (url.pathname === "/api/coach" && request.method === "POST") {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 100_000) throw new Error("Coach request is too large"); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const project = await resolveProject(body.projectId, root);
        await requireInitialized(project.root);
        const config = await runtimeCoachConfig("coach");
        const status = coachStatusFromConfig(config);
        if (!status.enabled) throw new Error(status.reason ?? "Aperta Coach is not configured");
        const job = startJob("coach", `Coach debrief for ${body.diffId ?? "capture"}`, async (signal) => {
          const [brief, proof] = await Promise.all([loadOwnershipBrief(project.root, body.diffId ?? ""), loadProofBrief(project.root, body.diffId ?? "")]);
          return generateCoachDebrief(brief, proof, signal, fetch, process.env, config);
        });
        response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ job }));
        return;
      }
      if (url.pathname === "/api/settings" && request.method === "GET") {
        const payload = await publicModelSettings();
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/settings" && request.method === "POST") {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 100_000) throw new Error("Settings request is too large"); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (body.action === "inspect") {
          const inspection = await inspectModelProvider(body.profile ?? {});
          response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          response.end(JSON.stringify(inspection));
          return;
        }
        if (body.action === "save") await saveModelProfile(body.profile ?? {});
        else if (body.action === "activate") await activateModelProfile(body.id ?? "");
        else if (body.action === "assign") await assignModelRole(body.id ?? "", body.role ?? "");
        else if (body.action === "retest") await retestModelProfile(body.id ?? "");
        else if (body.action === "delete") await deleteModelProfile(body.id ?? "");
        else if (body.action === "runtime") await saveAgentRuntime(body.runtime ?? {});
        else throw new Error("Unknown settings action");
        const payload = await publicModelSettings();
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/agents" && request.method === "GET") {
        const project = await resolveProject(url.searchParams.get("project") ?? undefined, root);
        await requireInitialized(project.root);
        const conversations = await listAgentConversations(project.root);
        const coach = coachStatusFromConfig(await runtimeCoachConfig("builder"));
        const runtime = await activeAgentRuntime();
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ conversations, runs: conversations.flatMap((conversation) => conversation.runs), coach, runtime }));
        return;
      }
      if (url.pathname === "/api/harness" && request.method === "GET") {
        const project = await resolveProject(url.searchParams.get("project") ?? undefined, root);
        await requireInitialized(project.root);
        const payload = await buildHarnessHealth(project.root);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/proof-graph" && request.method === "GET") {
        const project = await resolveProject(url.searchParams.get("project") ?? undefined, root);
        await requireInitialized(project.root);
        const payload = await loadRepositoryProofGraph(project.root);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/agents" && request.method === "POST") {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 100_000) throw new Error("Agent request is too large"); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const project = await resolveProject(body.projectId, root);
        await requireInitialized(project.root);
        if (body.action === "start") {
          const runtime = await activeAgentRuntime();
          const config = runtime.kind === "aperta" ? await runtimeCoachConfig() : null;
          if (runtime.kind === "aperta" && !config) throw new Error("Configure and activate a builder model profile before starting an agent run");
          if (runtime.kind !== "aperta" && !runtime.available) throw new Error(`${runtime.detail} Open Settings to choose another runtime or finish its installation.`);
          const conversations = await listAgentConversations(project.root);
          const conversation = body.conversationId ? conversations.find((candidate) => candidate.id === body.conversationId) : undefined;
          if (body.conversationId && !conversation) throw new Error("Agent conversation not found");
          const job = startJob("agent", `Agent turn: ${String(body.intent ?? "").slice(0, 80)}`, (signal) => runtime.kind !== "aperta"
            ? runExternalAgent(project.root, body.intent ?? "", runtime, signal, { conversationId: conversation?.id, previousRuns: conversation?.runs ?? [] })
            : runModelAgent(project.root, body.intent ?? "", config!, signal, fetch, { conversationId: conversation?.id, previousRuns: conversation?.runs ?? [] }));
          response.writeHead(202, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify({ job })); return;
        }
        if (body.action === "apply") {
          const run = await applyAgentRun(project.root, body.runId ?? "", { acceptUnverified: body.acceptUnverified === true });
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify({ run })); return;
        }
        if (body.action === "understanding") {
          const run = await saveAgentUnderstanding(project.root, body.runId ?? "", body.responses ?? {});
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify({ run })); return;
        }
        throw new Error("Unknown agent action");
      }
      if (url.pathname === "/api/jobs" && request.method === "GET") {
        const job = getJob(url.searchParams.get("id") ?? "");
        if (!job) throw new Error("Job not found");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ job }));
        return;
      }
      if (url.pathname === "/api/jobs" && request.method === "DELETE") {
        const canceled = cancelJob(url.searchParams.get("id") ?? "");
        response.writeHead(canceled ? 200 : 409, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ canceled }));
        return;
      }
      if (url.pathname === "/api/ownership" && request.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 1_000_000) throw new Error("Review is too large");
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (![1, 2, 3].includes(body.score)) throw new Error("Score must be 1, 2, or 3");
        const project = await resolveProject(body.projectId, root);
        await requireInitialized(project.root);
        const payload = await recordOwnershipReview(project.root, body);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/api/queue" && request.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 100_000) throw new Error("Queue action is too large");
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (body.action !== "skip") throw new Error("Unknown queue action");
        const project = await resolveProject(body.projectId, root);
        await requireInitialized(project.root);
        const payload = await recordQueueDisposition(project.root, { diffId: body.diffId, action: body.action });
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (!serveAssets) {
        response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "API route not found" }));
        return;
      }
      const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
      let file = join(dist, safePath);
      try {
        if (!(await stat(file)).isFile()) file = join(dist, "index.html");
      } catch {
        file = join(dist, "index.html");
      }
      response.writeHead(200, { "content-type": mime.get(extname(file)) ?? "application/octet-stream" });
      response.end(await readFile(file));
    } catch (error) {
      if (response.headersSent) {
        if (!response.writableEnded) response.end();
        console.error(`Dashboard request failed after response start: ${(error as Error).message}`);
        return;
      }
      response.writeHead(error instanceof DashboardHttpError ? error.status : 500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: (error as Error).message }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  if (serveAssets) {
    const url = `http://127.0.0.1:${port}`;
    console.log(`Aperta dashboard: ${url}`);
    console.log("Press Ctrl+C to stop.");
    if (shouldOpen) openBrowser(url);
  }
  server.on("close", () => { for (const observer of observers.values()) observer.stop(); });
  return server;
}
