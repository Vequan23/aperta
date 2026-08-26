import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { loadDashboardState, loadOwnershipBrief, recordOwnershipReview } from "../src/dashboard-data.ts";
import { initializeStore } from "../src/ledger.ts";
import { listProjects, resolveProject } from "../src/registry.ts";
import { readRepositoryFile } from "../src/repository.ts";
import { inspectProjectInitialization } from "../src/storage.ts";

function apertaData(): Plugin {
  return {
    name: "aperta-local-data",
    configureServer(server) {
      server.middlewares.use("/api", async (request, response, next) => {
        try {
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          if (url.pathname === "/state") {
            const project = await resolveProject(url.searchParams.get("project") ?? undefined, process.cwd());
            const initialization = await inspectProjectInitialization(project.root);
            const projects = await listProjects();
            const dashboard = await loadDashboardState(project.root, undefined, [], initialization);
            response.end(JSON.stringify({
              ...dashboard,
              initialization,
              projectId: project.id,
              projects: projects.map(({ id, name, available }) => ({ id, name, available })),
            }));
          }
          else if (url.pathname === "/project" && request.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const project = await resolveProject(body.projectId, process.cwd());
            await initializeStore(project.root);
            response.end(JSON.stringify({ initialization: await inspectProjectInitialization(project.root) }));
          }
          else if (url.pathname === "/ownership" && request.method === "GET") {
            const project = await resolveProject(url.searchParams.get("project") ?? undefined, process.cwd());
            response.end(JSON.stringify(await loadOwnershipBrief(project.root, url.searchParams.get("diffId") ?? "")));
          }
          else if (url.pathname === "/file" && request.method === "GET") {
            const project = await resolveProject(url.searchParams.get("project") ?? undefined, process.cwd());
            response.end(JSON.stringify(await readRepositoryFile(project.root, url.searchParams.get("path") ?? "")));
          }
          else if (url.pathname === "/ownership" && request.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const project = await resolveProject(body.projectId, process.cwd());
            response.end(JSON.stringify(await recordOwnershipReview(project.root, body)));
          } else next();
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: (error as Error).message }));
        }
      });
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [vue(), apertaData()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5173 },
});
