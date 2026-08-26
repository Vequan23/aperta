import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { startDashboardApi } from "../src/dashboard-server.ts";

const apiPort = 5174;
const apiState = globalThis as typeof globalThis & { __apertaDevApi?: Server };

async function closePreviousApi(): Promise<void> {
  const existing = apiState.__apertaDevApi;
  if (!existing?.listening) return;
  await new Promise<void>((resolveClose) => existing.close(() => resolveClose()));
}

function apertaApi(): Plugin {
  return {
    name: "aperta-local-api",
    async configureServer(server) {
      await closePreviousApi();
      const apiServer = await startDashboardApi(process.cwd(), apiPort);
      apiState.__apertaDevApi = apiServer;
      server.httpServer?.once("close", () => {
        if (apiState.__apertaDevApi !== apiServer) return;
        apiServer.close();
        delete apiState.__apertaDevApi;
      });
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [vue({
    template: {
      compilerOptions: { isCustomElement: (tag) => tag.startsWith("osx-") },
    },
  }), apertaApi()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}` } },
  },
});
