import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

test("marketing site is wired for an isolated Vercel build", async () => {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const vercel = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
  const entry = await readFile(join(root, "marketing/src/main.ts"), "utf8");
  const viteConfig = await readFile(join(root, "marketing/vite.config.ts"), "utf8");
  assert.equal(packageJson.scripts["build:marketing"], "vite build --config marketing/vite.config.ts");
  assert.match(packageJson.devDependencies["osx-components"], /^\^0\.8\./);
  assert.match(entry, /registerOsxComponents\(\)/);
  assert.match(entry, /osx-components\/theme\.css/);
  assert.match(viteConfig, /isCustomElement:\s*\(tag\)\s*=>\s*tag\.startsWith\("osx-"\)/);
  assert.equal(vercel.buildCommand, "npm run build:marketing");
  assert.equal(vercel.outputDirectory, "marketing/dist");
});

test("marketing page exposes its core story and safe external links", async () => {
  const app = await readFile(join(root, "marketing/src/App.vue"), "utf8");
  for (const section of ["product", "proof", "integrations", "privacy"]) assert.match(app, new RegExp(`id="${section}"`));
  assert.match(app, /Your code works\./);
  assert.match(app, /Do you own it\?/);
  assert.match(app, /Private by architecture/);
  assert.doesNotMatch(app, /target="_blank"(?! rel="noreferrer")/);
});

test("marketing typography keeps the 12px accessibility floor", async () => {
  const styles = await readFile(join(root, "marketing/src/style.css"), "utf8");
  const declaredSizes = [...styles.matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(declaredSizes.length > 20);
  assert.deepEqual(declaredSizes.filter((size) => size < 12), []);
});
