import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyzeImpact } from "../src/impact.ts";
import type { DiffEvent } from "../src/types.ts";

const exec = promisify(execFile);

async function repo() {
  const root = await mkdtemp(join(tmpdir(), "aperta-impact-"));
  await exec("git", ["init", "-q", root]);
  return root;
}

test("traces a Java JWT migration and names unproven security behavior", async () => {
  const root = await repo();
  await mkdir(join(root, "src/test"), { recursive: true });
  await writeFile(join(root, "src/SecurityConfig.java"), `
    import org.springframework.security.oauth2.jwt.JwtDecoder;
    @Configuration public class SecurityConfig {
      @Bean public JwtDecoder jwtDecoder() { return null; }
      public void configure() { oauth2ResourceServer(); }
    }
  `);
  await writeFile(join(root, "src/JwtService.java"), `import org.springframework.security.oauth2.jwt.JwtEncoder; public class JwtService { public String issueToken() { return ""; } }`);
  await writeFile(join(root, "src/test/JwtConfigurationTests.java"), `public class JwtConfigurationTests { public void issuedTokenValidates() {} public void invalidSubjectRejected() {} }`);
  const diff: DiffEvent = { id: "jwt", kind: "diff", ts: new Date().toISOString(), repo: "auth", branch: "main", authorship: "ai", files: [
    { path: "src/SecurityConfig.java", added: 20, removed: 3, hunks: 1 },
    { path: "src/JwtAuthenticationFilter.java", added: 0, removed: 49, hunks: 1 },
    { path: "src/JwtService.java", added: 15, removed: 38, hunks: 1 },
    { path: "src/test/JwtConfigurationTests.java", added: 68, removed: 0, hunks: 1 },
  ] };
  const patch = `diff --git a/src/SecurityConfig.java b/src/SecurityConfig.java
--- a/src/SecurityConfig.java
+++ b/src/SecurityConfig.java
@@ -1 +1 @@
+import org.springframework.security.oauth2.jwt.JwtDecoder;
+import org.springframework.security.oauth2.jwt.JwtEncoder;
+oauth2ResourceServer();
diff --git a/src/JwtAuthenticationFilter.java b/src/JwtAuthenticationFilter.java
--- a/src/JwtAuthenticationFilter.java
+++ /dev/null
@@ -1 +0,0 @@
-public class JwtAuthenticationFilter { public void doFilterInternal() {} }
diff --git a/src/JwtService.java b/src/JwtService.java
--- a/src/JwtService.java
+++ b/src/JwtService.java
@@ -1 +1 @@
+public class JwtService { public String issueToken() { return ""; } }
diff --git a/src/test/JwtConfigurationTests.java b/src/test/JwtConfigurationTests.java
--- /dev/null
+++ b/src/test/JwtConfigurationTests.java
@@ -0,0 +1 @@
+public class JwtConfigurationTests { public void issuedTokenValidates() {} }
`;
  const graph = await analyzeImpact(root, diff, patch);
  assert.match(graph.headline, /Spring Security/);
  assert.match(graph.narrative, /JwtEncoder/);
  assert.ok(graph.nodes.some((node) => node.label === "JwtAuthenticationFilter" && node.status === "removed"));
  assert.ok(graph.nodes.some((node) => node.label === "OAuth2 resource server" && node.status === "added"));
  assert.ok(graph.edges.some((edge) => edge.kind === "replaces"));
  assert.ok(graph.unproven.includes("Invalid signature rejection"));
  assert.ok(graph.nodes.some((node) => node.kind === "test"));
});

test("uses the TypeScript analyzer to link unchanged callers to changed exports", async () => {
  const root = await repo();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/session.ts"), `export function createSession() { return { id: "1" }; }`);
  await writeFile(join(root, "src/controller.ts"), `import { createSession } from "./session"; export function login() { return createSession(); }`);
  const diff: DiffEvent = { id: "ts", kind: "diff", ts: new Date().toISOString(), repo: "web", branch: "main", authorship: "ai", files: [{ path: "src/session.ts", added: 1, removed: 1, hunks: 1 }] };
  const patch = `diff --git a/src/session.ts b/src/session.ts
--- a/src/session.ts
+++ b/src/session.ts
@@ -1 +1 @@
-export function createSession() { return null; }
+export function createSession() { return { id: "1" }; }
`;
  const graph = await analyzeImpact(root, diff, patch);
  assert.match(graph.analyzer, /TypeScript/);
  assert.ok(graph.nodes.some((node) => node.path === "src/controller.ts" && node.status === "related"));
  assert.ok(graph.edges.some((edge) => edge.kind === "calls"));
});

test("keeps unsupported languages useful without inventing semantic certainty", async () => {
  const root = await repo();
  await writeFile(join(root, "service.py"), `def issue_token(subject):\n    return subject\n`);
  const diff: DiffEvent = { id: "py", kind: "diff", ts: new Date().toISOString(), repo: "python-api", branch: "main", authorship: "ai", files: [{ path: "service.py", added: 2, removed: 0, hunks: 1 }] };
  const patch = `diff --git a/service.py b/service.py
--- /dev/null
+++ b/service.py
@@ -0,0 +1,2 @@
+def issue_token(subject):
+    return subject
`;
  const graph = await analyzeImpact(root, diff, patch);
  assert.deepEqual(graph.languages, ["Python"]);
  assert.match(graph.analyzer, /universal Git analyzer/);
  assert.equal(graph.capabilities.find((capability) => capability.id === "capture")?.status, "available");
  assert.equal(graph.capabilities.find((capability) => capability.id === "structure")?.status, "unavailable");
  assert.match(graph.narrative, /will not claim symbol/);
  assert.equal(graph.nodes[0]?.evidence.level, "observed");
  assert.equal(graph.nodes.some((node) => node.kind === "method"), false);
});
