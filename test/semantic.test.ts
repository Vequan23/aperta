import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeProjectSemantics } from "../src/semantic.ts";
import type { DiffEvent } from "../src/types.ts";

const base = (id: string, paths: string[]): DiffEvent => ({ id, kind: "diff", ts: new Date().toISOString(), repo: "semantic-test", branch: "main", authorship: "ai", files: paths.map((path) => ({ path, added: 1, removed: 1, hunks: 1 })) });

test("uses the JDK compiler to resolve project-local Java callers", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-java-semantic-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/TokenService.java"), `class TokenService { String issue() { return "token"; } }`);
  await writeFile(join(root, "src/AuthController.java"), `class AuthController { String login() { return new TokenService().issue(); } }`);
  const results = await analyzeProjectSemantics(root, base("java-semantic", ["src/TokenService.java"]));
  const java = results.find((result) => result.provider === "java-compiler");
  assert.ok(java);
  assert.equal(java.status, "resolved");
  assert.ok(java.symbols.some((symbol) => symbol.path === "src/TokenService.java" && symbol.name.includes("#issue")));
  assert.ok(java.relations.some((relation) => relation.fromPath === "src/AuthController.java" && relation.toPath === "src/TokenService.java" && relation.kind === "calls"));
});

test("uses TypeScript to resolve callers across TS and frontend modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-ts-semantic-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve", noEmit: true }, include: ["src"] }));
  await writeFile(join(root, "src/session.ts"), `export function createSession() { return { id: "1" }; }`);
  await writeFile(join(root, "src/LoginPanel.tsx"), `import { createSession } from "./session"; export function LoginPanel() { return createSession().id; }`);
  const results = await analyzeProjectSemantics(root, base("ts-semantic", ["src/session.ts"]));
  const typescript = results.find((result) => result.provider === "typescript-compiler");
  assert.ok(typescript);
  assert.equal(typescript.status, "resolved");
  assert.ok(typescript.symbols.some((symbol) => symbol.path === "src/session.ts" && symbol.name.includes("createSession")));
  assert.ok(typescript.relations.some((relation) => relation.fromPath === "src/LoginPanel.tsx" && relation.toPath === "src/session.ts" && relation.kind === "calls"));
});

test("includes Vue component scripts in frontend semantic analysis", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-vue-semantic-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", noEmit: true }, include: ["src"] }));
  await writeFile(join(root, "src/api.ts"), `export function saveUser() { return true; }`);
  await writeFile(join(root, "src/ProfilePanel.vue"), `<script setup lang="ts">\nimport { saveUser } from "./api";\nconst submit = () => saveUser();\n</script>\n<template><button @click="submit">Save</button></template>`);
  const results = await analyzeProjectSemantics(root, base("vue-semantic", ["src/ProfilePanel.vue"]));
  const typescript = results.find((result) => result.provider === "typescript-compiler");
  assert.ok(typescript);
  assert.ok(typescript.symbols.some((symbol) => symbol.path === "src/ProfilePanel.vue" && symbol.name.includes("submit")));
  assert.ok(typescript.relations.some((relation) => relation.fromPath === "src/ProfilePanel.vue" && relation.toPath === "src/api.ts"));
});

test("uses the nearest package tsconfig in a frontend workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperta-workspace-semantic-"));
  await mkdir(join(root, "packages/web/src"), { recursive: true });
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ files: [], references: [{ path: "./packages/web" }] }));
  await writeFile(join(root, "packages/web/tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", noEmit: true }, include: ["src"] }));
  await writeFile(join(root, "packages/web/src/model.ts"), `export const loadModel = () => ({ ready: true });`);
  await writeFile(join(root, "packages/web/src/page.tsx"), `import { loadModel } from "./model"; export const Page = () => loadModel().ready;`);
  const results = await analyzeProjectSemantics(root, base("workspace-semantic", ["packages/web/src/model.ts"]));
  const typescript = results.find((result) => result.provider === "typescript-compiler");
  assert.ok(typescript?.relations.some((relation) => relation.fromPath.endsWith("page.tsx") && relation.toPath.endsWith("model.ts")));
});
