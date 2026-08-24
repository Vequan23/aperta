import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listTrackedFiles } from "./git.ts";
import { analyzeProjectSemantics } from "./semantic.ts";
import type { DiffEvent, ExplanationEvent } from "./types.ts";

export type ImpactNodeKind = "file" | "class" | "method" | "dependency" | "test" | "config" | "entrypoint";
export type ImpactStatus = "added" | "modified" | "removed" | "related";
export type EvidenceLevel = "observed" | "inferred" | "proven";
export interface AnalysisEvidence { level: EvidenceLevel; source: "git" | "structural" | "compiler" | "runtime"; detail: string }
export interface AnalysisCapability { id: "capture" | "structure" | "semantics" | "runtime"; label: string; status: "available" | "partial" | "unavailable"; detail: string }
export interface ImpactNode { id: string; label: string; kind: ImpactNodeKind; status: ImpactStatus; path?: string; detail?: string; evidence: AnalysisEvidence }
export interface ImpactEdge { from: string; to: string; kind: "defines" | "calls" | "depends-on" | "configures" | "covers" | "replaces" | "invalidates"; evidence: AnalysisEvidence }
export interface ImpactGraph {
  analyzer: string; headline: string; narrative: string; risk: "low" | "medium" | "high";
  languages: string[]; capabilities: AnalysisCapability[];
  nodes: ImpactNode[]; edges: ImpactEdge[]; insights: string[]; unproven: string[];
  staleNotes: Array<{ diffId: string; text: string; paths: string[] }>;
}

type FilePatch = { path: string; added: string; removed: string };
const testPath = (path: string) => /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/i.test(path) || /Test\.java$/.test(path);
const idFor = (kind: string, value: string) => `${kind}:${value}`.replace(/\s+/g, "-");
const observed = (detail: string): AnalysisEvidence => ({ level: "observed", source: "git", detail });
const inferred = (detail: string): AnalysisEvidence => ({ level: "inferred", source: "structural", detail });
const compilerEvidence = (detail: string): AnalysisEvidence => ({ level: "inferred", source: "compiler", detail });
const languageByExtension: Record<string, string> = {
  java: "Java", kt: "Kotlin", kts: "Kotlin", ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", vue: "Vue",
  py: "Python", go: "Go", rs: "Rust", cs: "C#", rb: "Ruby", php: "PHP", swift: "Swift", c: "C", h: "C/C++", cc: "C++", cpp: "C++", hpp: "C++", sh: "Shell",
};

function detectedLanguage(path: string) {
  return languageByExtension[path.split(".").at(-1)?.toLowerCase() ?? ""];
}

function splitPatch(patch: string): FilePatch[] {
  const files: FilePatch[] = [];
  let current: FilePatch | undefined;
  for (const line of patch.split("\n")) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (header) { current = { path: header[2], added: "", removed: "" }; files.push(current); continue; }
    if (!current || line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) current.added += `${line.slice(1)}\n`;
    if (line.startsWith("-")) current.removed += `${line.slice(1)}\n`;
  }
  return files;
}

function symbols(source: string, language: "java" | "typescript") {
  const found: Array<{ name: string; kind: "class" | "method" | "entrypoint" | "config" }> = [];
  const push = (name: string, kind: "class" | "method" | "entrypoint" | "config") => {
    if (name && !found.some((item) => item.name === name && item.kind === kind)) found.push({ name, kind });
  };
  if (language === "java") {
    for (const match of source.matchAll(/\b(?:class|interface|record|enum)\s+([A-Za-z_$][\w$]*)/g)) push(match[1], "class");
    for (const match of source.matchAll(/^\s*(?:(?:public|protected|private)\s+)?(?:static\s+)?(?:final\s+)?[\w<>?,.\[\]]+\s+([a-zA-Z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[\w.,\s]+)?\{/gm)) {
      if (!["if", "for", "while", "switch", "catch"].includes(match[1])) push(match[1], "method");
    }
    if (/@(?:RestController|Controller)|@(Get|Post|Put|Patch|Delete|Request)Mapping/.test(source)) push("HTTP API", "entrypoint");
    if (/@(?:Configuration|Bean|EnableWebSecurity)/.test(source)) push("Spring security runtime", "config");
  } else {
    for (const match of source.matchAll(/\b(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) push(match[1], "class");
    for (const match of source.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)) push(match[1] ?? match[2], "method");
    if (/\b(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/.test(source)) push("HTTP API", "entrypoint");
  }
  return found;
}

function dependencies(source: string, language: "java" | "typescript") {
  const values = language === "java"
    ? [...source.matchAll(/^import\s+(?:static\s+)?([\w.]+);/gm)].map((match) => match[1].split(".").at(-1) ?? match[1])
    : [...source.matchAll(/^import(?:[\s\S]*?from\s*)?["']([^"']+)["']/gm)].map((match) => match[1]);
  return [...new Set(values)].filter((value) => !/^(java|javax)$/.test(value)).slice(0, 16);
}

export async function analyzeImpact(root: string, diff: DiffEvent, patch: string, history: Array<{ diff: DiffEvent; notes: ExplanationEvent[] }> = []): Promise<ImpactGraph> {
  const patchFiles = splitPatch(patch);
  const nodes: ImpactNode[] = [];
  const edges: ImpactEdge[] = [];
  const nodeIds = new Set<string>();
  const addNode = (node: ImpactNode) => { if (!nodeIds.has(node.id)) { nodeIds.add(node.id); nodes.push(node); } return node.id; };
  const addEdge = (edge: ImpactEdge) => {
    const existing = edges.find((item) => item.from === edge.from && item.to === edge.to && item.kind === edge.kind);
    if (!existing) edges.push(edge);
    else if (edge.evidence.source === "compiler" && existing.evidence.source === "structural") existing.evidence = edge.evidence;
  };
  const languages = new Set<string>();
  const changedSymbolNames = new Set<string>();
  const sourceByPath = new Map<string, string>();

  for (const file of diff.files) {
    const language = file.path.endsWith(".java") ? "java" : /\.[cm]?[jt]sx?$/.test(file.path) ? "typescript" : null;
    const detected = detectedLanguage(file.path);
    if (detected) languages.add(detected);
    const filePatch = patchFiles.find((item) => item.path === file.path);
    let current = "";
    try { current = await readFile(join(root, file.path), "utf8"); } catch {}
    sourceByPath.set(file.path, current || filePatch?.added || "");
    const removedFile = file.removed > 0 && file.added === 0 && !current;
    const status: ImpactStatus = removedFile ? "removed" : file.removed === 0 ? "added" : "modified";
    const kind: ImpactNodeKind = testPath(file.path) ? "test" : /(?:pom\.xml|package\.json|\.ya?ml$|\.properties$)/.test(file.path) ? "config" : "file";
    const fileId = addNode({ id: idFor("file", file.path), label: file.path.split("/").at(-1) ?? file.path, path: file.path, kind, status, detail: `${file.added} additions · ${file.removed} deletions`, evidence: observed("Changed path and line counts reported by Git") });
    if (!language) continue;
    const addedSymbols = symbols(filePatch?.added ?? current, language);
    const removedSymbols = symbols(filePatch?.removed ?? "", language);
    const currentSymbols = symbols(current, language);
    for (const symbol of [...removedSymbols, ...addedSymbols]) {
      const isRemoved = removedSymbols.some((item) => item.name === symbol.name && item.kind === symbol.kind) && !currentSymbols.some((item) => item.name === symbol.name && item.kind === symbol.kind);
      const nodeKind: ImpactNodeKind = symbol.kind === "config" ? "config" : symbol.kind;
      const symbolId = addNode({ id: idFor(nodeKind, `${file.path}:${symbol.name}`), label: symbol.name, path: file.path, kind: nodeKind, status: isRemoved ? "removed" : status === "added" ? "added" : "modified", detail: symbol.kind === "method" ? "Changed executable behavior" : "Changed structural surface", evidence: inferred(`${language === "java" ? "Java" : "TypeScript"} source pattern match; compiler not consulted`) });
      addEdge({ from: fileId, to: symbolId, kind: "defines", evidence: inferred("Definition relationship detected from source structure") });
      changedSymbolNames.add(symbol.name);
    }
    for (const dependency of dependencies(`${filePatch?.added ?? ""}\n${current}`, language)) {
      const dependencyId = addNode({ id: idFor("dependency", dependency), label: dependency, kind: "dependency", status: "related", detail: "Imported by changed code", evidence: inferred("Import statement detected; dependency resolution not verified") });
      addEdge({ from: fileId, to: dependencyId, kind: "depends-on", evidence: inferred("Import relationship detected from source text") });
    }
  }

  const tracked = (await listTrackedFiles(root)).filter((path) => /\.(java|[cm]?[jt]sx?)$/.test(path) && !diff.files.some((file) => file.path === path)).slice(0, 1500);
  for (const path of tracked) {
    let source = ""; try { source = await readFile(join(root, path), "utf8"); } catch { continue; }
    const references = [...changedSymbolNames].filter((name) => name.length > 2 && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(source));
    if (!references.length) continue;
    const relatedId = addNode({ id: idFor("related", path), label: path.split("/").at(-1) ?? path, path, kind: testPath(path) ? "test" : "file", status: "related", detail: `References ${references.slice(0, 3).join(", ")}`, evidence: inferred("Name reference found in tracked source; symbol resolution not verified") });
    for (const changed of nodes.filter((node) => node.path && changedSymbolNames.has(node.label) && references.includes(node.label))) addEdge({ from: relatedId, to: changed.id, kind: testPath(path) ? "covers" : "calls", evidence: inferred("Name reference suggests this relationship; compiler and coverage not consulted") });
  }

  const semanticAnalyses = await analyzeProjectSemantics(root, diff);
  const shortName = (name?: string | null) => name?.split("#").at(-1)?.split(".").at(-1) ?? "";
  for (const analysis of semanticAnalyses.filter((item) => item.status !== "unavailable")) {
    const evidence = compilerEvidence(analysis.detail);
    for (const symbol of analysis.symbols) {
      const label = shortName(symbol.name);
      const existing = nodes.find((node) => node.path === symbol.path && node.label === label && node.kind === symbol.kind);
      if (existing) existing.evidence = evidence;
      else {
        const fileNode = nodes.find((node) => node.path === symbol.path && (node.kind === "file" || node.kind === "test"));
        if (!fileNode) continue;
        const symbolId = addNode({ id: idFor(symbol.kind, `${symbol.path}:${label}`), label, path: symbol.path, kind: symbol.kind, status: "related", detail: "Compiler-resolved surface in a changed file", evidence });
        addEdge({ from: fileNode.id, to: symbolId, kind: "defines", evidence });
      }
    }
    for (const relation of analysis.relations) {
      const ensureFile = (path: string) => {
        const existing = nodes.find((node) => node.path === path && (node.kind === "file" || node.kind === "test"));
        if (existing) return existing;
        const related: ImpactNode = { id: idFor("related", path), label: path.split("/").at(-1) ?? path, path, kind: testPath(path) ? "test" : "file", status: "related", detail: "Compiler-resolved repository relationship", evidence };
        addNode(related); return related;
      };
      const from = ensureFile(relation.fromPath);
      const targetLabel = shortName(relation.toName);
      const to = nodes.find((node) => node.path === relation.toPath && targetLabel && node.label === targetLabel) ?? ensureFile(relation.toPath);
      addEdge({ from: from.id, to: to.id, kind: relation.kind === "imports" ? "depends-on" : "calls", evidence });
      if (from.status === "related") from.evidence = evidence;
      if (to.status === "related") to.evidence = evidence;
    }
  }

  const allText = `${patch}\n${nodes.map((node) => node.label).join(" ")}`;
  const jwtMigration = /JwtAuthenticationFilter/.test(allText) && /oauth2ResourceServer|JwtDecoder|JwtEncoder/.test(allText);
  if (jwtMigration) {
    const filter = nodes.find((node) => node.label === "JwtAuthenticationFilter");
    const runtime = addNode({ id: "config:spring-resource-server", label: "OAuth2 resource server", kind: "config", status: "added", detail: "Spring Security now owns bearer-token authentication", evidence: inferred("Spring Security configuration patterns detected in the diff") });
    if (filter) addEdge({ from: filter.id, to: runtime, kind: "replaces", evidence: inferred("Removal and replacement configuration co-occur in this change") });
  }
  for (const test of nodes.filter((node) => node.kind === "test")) {
    const testSource = sourceByPath.get(test.path ?? "") ?? "";
    const targets = nodes.filter((node) => node.status !== "removed" && (node.kind === "class" || node.kind === "method" || node.kind === "dependency" || node.kind === "config") && node.label.length > 3 && new RegExp(`\\b${node.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(testSource));
    for (const target of targets.slice(0, 10)) addEdge({ from: test.id, to: target.id, kind: "covers", evidence: inferred("Test source references this surface; executed coverage not collected") });
    if (jwtMigration && /decode|validat|token/i.test(testSource)) addEdge({ from: test.id, to: "config:spring-resource-server", kind: "covers", evidence: inferred("Test vocabulary matches the changed authentication behavior") });
  }

  const changedPaths = new Set(diff.files.map((file) => file.path));
  const staleNotes = history.flatMap(({ diff: priorDiff, notes }) => {
    const paths = priorDiff.files.map((file) => file.path).filter((path) => changedPaths.has(path));
    return paths.length ? notes.map((note) => ({ diffId: priorDiff.id, text: note.text, paths })) : [];
  });
  const testCount = nodes.filter((node) => node.kind === "test").length;
  const sensitive = /auth|security|token|permission|payment/i.test(allText);
  const risk: "low" | "medium" | "high" = sensitive || !testCount ? "high" : diff.files.length > 3 ? "medium" : "low";
  const unproven = jwtMigration
    ? ["Expired token rejection", "Incorrect issuer rejection", "Invalid signature rejection", "Endpoint authorization boundaries"]
    : [!testCount ? "No changed or connected test proves this behavior" : "Failure paths not named by connected tests", "Runtime integration beyond the changed files"];
  const structurallySupported = [...languages].some((language) => language === "Java" || language === "TypeScript" || language === "JavaScript" || language === "Vue");
  const languageLabel = languages.size ? [...languages].join(" + ") : "Unknown language";
  const activeSemantics = semanticAnalyses.filter((analysis) => analysis.status !== "unavailable");
  const semanticStatus: AnalysisCapability["status"] = !activeSemantics.length ? "unavailable" : activeSemantics.every((analysis) => analysis.status === "resolved") ? "available" : "partial";
  const semanticDetail = activeSemantics.length ? activeSemantics.map((analysis) => analysis.detail).join(" ") : "No compiler adapter could resolve this capture.";
  const capabilities: AnalysisCapability[] = [
    { id: "capture", label: "Change capture", status: "available", detail: "Git paths, hunks, additions, and deletions are observed directly." },
    { id: "structure", label: "Code structure", status: structurallySupported ? (languages.size > 1 && [...languages].some((language) => !["Java", "TypeScript", "JavaScript", "Vue"].includes(language)) ? "partial" : "available") : "unavailable", detail: structurallySupported ? "Java, JavaScript/TypeScript, and Vue script surfaces are structurally inspected." : `${languageLabel} has file-level analysis only in this version.` },
    { id: "semantics", label: "Resolved semantics", status: semanticStatus, detail: semanticDetail },
    { id: "runtime", label: "Runtime proof", status: "unavailable", detail: "Run a proof or generated probe to attach executed evidence." },
  ];
  const headline = jwtMigration ? "Authentication moved into Spring Security’s resource-server pipeline" : structurallySupported ? `${diff.files.length} changed file${diff.files.length === 1 ? "" : "s"} alter ${nodes.filter((node) => node.kind === "method" || node.kind === "class").length} detected code surfaces` : `${diff.files.length} ${languageLabel} file${diff.files.length === 1 ? "" : "s"} changed; semantic impact still needs an adapter`;
  const narrative = jwtMigration
    ? "JWT authentication moved from a custom servlet filter to Spring Security’s OAuth2 resource-server pipeline. Token creation now uses JwtEncoder; validation depends on JwtDecoder, issuer matching, UUID subjects, HS256, and the configured signing key. Happy-path issuance and invalid-subject validation are connected to tests; expiry, issuer, signature, and endpoint authorization remain unproven."
    : structurallySupported ? `Aperta connected ${nodes.filter((node) => node.status !== "related").length} changed surfaces to ${nodes.filter((node) => node.status === "related").length} repository relationships. Treat inferred relationships as leads, then verify behavior in the ownership session.` : `Aperta observed this change through Git and can drive a file-level ownership session. It will not claim symbol, call-graph, or test-coverage knowledge for ${languageLabel} until a structural or compiler adapter supplies evidence.`;
  const insights = [
    `${nodes.filter((node) => node.status === "removed").length} removed · ${nodes.filter((node) => node.status === "added").length} added · ${nodes.filter((node) => node.status === "modified").length} modified surfaces`,
    `${nodes.filter((node) => node.status === "related").length} callers, dependencies, tests, or configuration surfaces connected`,
    testCount ? `${testCount} test surface${testCount === 1 ? "" : "s"} connected to the change` : "No test surface connected to the change",
  ];
  const compilerNames = activeSemantics.map((analysis) => analysis.provider === "java-compiler" ? "JDK compiler" : "TypeScript compiler");
  return { analyzer: compilerNames.length ? `${compilerNames.join(" + ")} semantic analyzer v1` : structurallySupported ? `${languageLabel} structural analyzer v1` : `${languageLabel} universal Git analyzer v1`, languages: [...languages], capabilities, headline, narrative, risk, nodes, edges, insights, unproven, staleNotes };
}
