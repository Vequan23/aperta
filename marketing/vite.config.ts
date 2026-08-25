import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [vue({
    template: {
      compilerOptions: { isCustomElement: (tag) => tag.startsWith("osx-") },
    },
  })],
  build: { outDir: "dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 4174 },
});
