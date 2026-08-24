import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { loadDashboardState, loadOwnershipBrief, recordOwnershipReview } from "../src/dashboard-data.ts";

function apertaData(): Plugin {
  return {
    name: "aperta-local-data",
    configureServer(server) {
      server.middlewares.use("/api", async (request, response, next) => {
        try {
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          if (url.pathname === "/state") response.end(JSON.stringify(await loadDashboardState(process.cwd())));
          else if (url.pathname === "/ownership" && request.method === "GET") response.end(JSON.stringify(await loadOwnershipBrief(process.cwd(), url.searchParams.get("diffId") ?? "")));
          else if (url.pathname === "/ownership" && request.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(chunk);
            response.end(JSON.stringify(await recordOwnershipReview(process.cwd(), JSON.parse(Buffer.concat(chunks).toString("utf8")))));
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
