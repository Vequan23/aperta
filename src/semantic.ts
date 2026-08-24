import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse as parseVue } from "@vue/compiler-sfc";
// TypeScript 7 is the native project compiler, but 7.0 intentionally ships
// without an embeddable API. Aperta uses Microsoft's supported TypeScript 6
// compatibility package for in-process semantic analysis until the new API
// arrives in TypeScript 7.1.
import ts from "@typescript/typescript6";
import type { DiffEvent } from "./types.ts";
import { privateCachePath } from "./storage.ts";

const execFileAsync = promisify(execFile);
export type SemanticProvider = "java-compiler" | "typescript-compiler";
export interface SemanticSymbol { path: string; name: string; kind: "class" | "method" }
export interface SemanticRelation { fromPath: string; toPath: string; fromName?: string | null; toName?: string | null; kind: "calls" | "imports" }
export interface SemanticAnalysis { provider: SemanticProvider; status: "resolved" | "partial" | "unavailable"; detail: string; diagnostics: number; symbols: SemanticSymbol[]; relations: SemanticRelation[] }

const cache = new Map<string, Promise<SemanticAnalysis[]>>();
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
const slash = (path: string) => path.replaceAll("\\", "/");

async function analyzeJava(root: string, diff: DiffEvent): Promise<SemanticAnalysis> {
  const java = diff.files.filter((file) => file.path.endsWith(".java")).map((file) => file.path);
  if (!java.length) return { provider: "java-compiler", status: "unavailable", detail: "No changed Java source", diagnostics: 0, symbols: [], relations: [] };
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const adjacentHelper = join(moduleDir, "../tools/ApertaJavaAnalyzer.java");
  const helper = await exists(adjacentHelper) ? adjacentHelper : join(moduleDir, "../../tools/ApertaJavaAnalyzer.java");
  try {
    const parts = [join(root, "target/classes"), join(root, "target/test-classes")];
    try { parts.push(...(await readFile(privateCachePath(root, "semantic", "java-classpath.txt"), "utf8")).trim().split(":")); } catch {}
    const classpath = parts.filter(Boolean).join(":");
    const { stdout } = await execFileAsync("java", [helper, root, classpath, ...java], { cwd: root, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
    const result = JSON.parse(stdout) as { diagnostics: number; symbols: SemanticSymbol[]; relations: SemanticRelation[] };
    const status = result.diagnostics ? "partial" : "resolved";
    return { provider: "java-compiler", status, detail: result.diagnostics ? `JDK compiler resolved project-local symbols with ${result.diagnostics} missing-dependency or source diagnostic${result.diagnostics === 1 ? "" : "s"}.` : "JDK compiler resolved project-local symbols and call targets.", ...result };
  } catch (error) {
    return { provider: "java-compiler", status: "unavailable", detail: `JDK semantic analysis unavailable: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`, diagnostics: 0, symbols: [], relations: [] };
  }
}

function configFor(root: string, changedPaths: string[]) {
  const rootPath = resolve(root);
  const nearest = (file: string) => {
    let directory = dirname(resolve(file));
    while (directory === rootPath || directory.startsWith(`${rootPath}/`)) {
      for (const name of ["tsconfig.json", "jsconfig.json"]) { const candidate = join(directory, name); if (ts.sys.fileExists(candidate)) return candidate; }
      const parent = dirname(directory); if (parent === directory) break; directory = parent;
    }
    return undefined;
  };
  const configPaths = [...new Set(changedPaths.map(nearest).filter((path): path is string => Boolean(path)))];
  const parsed = configPaths.map((configPath) => {
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    return loaded.error ? undefined : ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configPath), { noEmit: true, allowJs: true }, configPath);
  }).filter((value): value is ts.ParsedCommandLine => Boolean(value));
  if (parsed.length) return { fileNames: [...new Set(parsed.flatMap((value) => value.fileNames))], options: parsed[0].options, errors: parsed.flatMap((value) => value.errors) };
  const files = ts.sys.readDirectory(root, [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"], ["node_modules", "dist", "build", ".git"], undefined, 12_000);
  return { fileNames: files, options: { noEmit: true, allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, errors: [] };
}

function declarationName(checker: ts.TypeChecker, node: ts.Node) {
  const named = node as ts.Node & { name?: ts.Node };
  if (!named.name) return undefined;
  const symbol = checker.getSymbolAtLocation(named.name);
  return symbol ? checker.getFullyQualifiedName(symbol).replace(/^".*"\./, "") : named.name.getText();
}

async function analyzeTypeScript(root: string, diff: DiffEvent): Promise<SemanticAnalysis> {
  const changed = new Set(diff.files.filter((file) => /\.(?:[cm]?[jt]sx?|vue)$/.test(file.path)).map((file) => slash(resolve(root, file.path))));
  if (!changed.size) return { provider: "typescript-compiler", status: "unavailable", detail: "No changed JavaScript, TypeScript, or Vue source", diagnostics: 0, symbols: [], relations: [] };
  try {
    const config = configFor(root, [...changed]);
    const virtualVue = new Map<string, string>();
    for (const vuePath of ts.sys.readDirectory(root, [".vue"], ["node_modules", "dist", "build", ".git"], undefined, 4_000)) {
      try {
        const source = await readFile(vuePath, "utf8");
        const descriptor = parseVue(source, { filename: vuePath }).descriptor;
        const script = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join("\n");
        if (script) virtualVue.set(`${slash(resolve(vuePath))}.tsx`, script);
      } catch {}
    }
    const host = ts.createCompilerHost(config.options);
    const normalFileExists = host.fileExists.bind(host), normalReadFile = host.readFile.bind(host), normalGetSourceFile = host.getSourceFile.bind(host);
    host.fileExists = (path) => virtualVue.has(slash(resolve(path))) || normalFileExists(path);
    host.readFile = (path) => virtualVue.get(slash(resolve(path))) ?? normalReadFile(path);
    host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
      const content = virtualVue.get(slash(resolve(path)));
      return content === undefined ? normalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile) : ts.createSourceFile(path, content, languageVersion, true, ts.ScriptKind.TSX);
    };
    host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
      if (moduleName.endsWith(".vue")) {
        const candidate = `${slash(resolve(dirname(containingFile), moduleName))}.tsx`;
        if (virtualVue.has(candidate)) return { resolvedFileName: candidate, extension: ts.Extension.Tsx, isExternalLibraryImport: false };
      }
      return ts.resolveModuleName(moduleName, containingFile, config.options, host).resolvedModule;
    });
    const program = ts.createProgram({ rootNames: [...config.fileNames, ...virtualVue.keys()], options: config.options, host });
    const checker = program.getTypeChecker();
    const symbols: SemanticSymbol[] = [], relations: SemanticRelation[] = [];
    const symbolKeys = new Set<string>(), relationKeys = new Set<string>();
    const pathOf = (source: ts.SourceFile) => slash(relative(root, source.fileName)).replace(/\.vue\.tsx$/, ".vue");
    const addSymbol = (path: string, name: string | undefined, kind: "class" | "method") => { if (!name) return; const key = `${path}|${name}|${kind}`; if (!symbolKeys.has(key)) { symbolKeys.add(key); symbols.push({ path, name, kind }); } };
    for (const source of program.getSourceFiles()) {
      if (source.isDeclarationFile || source.fileName.includes("/node_modules/")) continue;
      const sourceAbsolute = slash(resolve(source.fileName)).replace(/\.vue\.tsx$/, ".vue");
      const sourcePath = pathOf(source);
      const visit = (node: ts.Node) => {
        if (changed.has(sourceAbsolute)) {
          if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) addSymbol(sourcePath, declarationName(checker, node), "class");
          if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) addSymbol(sourcePath, declarationName(checker, node.parent && ts.isVariableDeclaration(node.parent) ? node.parent : node), "method");
        }
        if (ts.isCallExpression(node)) {
          const signature = checker.getResolvedSignature(node);
          const declaration = signature?.declaration;
          const targetSource = declaration?.getSourceFile();
          if (targetSource && !targetSource.isDeclarationFile) {
            const targetPath = pathOf(targetSource);
            const targetAbsolute = slash(resolve(targetSource.fileName)).replace(/\.vue\.tsx$/, ".vue");
            if (targetPath !== sourcePath && (changed.has(sourceAbsolute) || changed.has(targetAbsolute))) {
              const targetName = declaration ? declarationName(checker, declaration) : undefined;
              const key = `${sourcePath}|${targetPath}|${targetName ?? ""}|calls`;
              if (!relationKeys.has(key)) { relationKeys.add(key); relations.push({ fromPath: sourcePath, toPath: targetPath, toName: targetName, kind: "calls" }); }
            }
          }
        }
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const symbol = checker.getSymbolAtLocation(node.moduleSpecifier);
          const target = symbol?.declarations?.[0]?.getSourceFile();
          if (target && !target.isDeclarationFile && changed.has(sourceAbsolute)) {
            const targetPath = pathOf(target); const key = `${sourcePath}|${targetPath}|imports`;
            if (!relationKeys.has(key)) { relationKeys.add(key); relations.push({ fromPath: sourcePath, toPath: targetPath, kind: "imports" }); }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    const diagnostics = ts.getPreEmitDiagnostics(program).length + config.errors.length;
    const frontend = virtualVue.size ? " JavaScript/TypeScript and Vue component scripts were included." : "";
    return { provider: "typescript-compiler", status: diagnostics ? "partial" : "resolved", detail: diagnostics ? `TypeScript resolved project symbols with ${diagnostics} configuration or type diagnostic${diagnostics === 1 ? "" : "s"}.${frontend}` : `TypeScript resolved project symbols, imports, and call targets.${frontend}`, diagnostics, symbols, relations };
  } catch (error) {
    return { provider: "typescript-compiler", status: "unavailable", detail: `TypeScript semantic analysis unavailable: ${error instanceof Error ? error.message : String(error)}`, diagnostics: 0, symbols: [], relations: [] };
  }
}

export async function analyzeProjectSemantics(root: string, diff: DiffEvent) {
  const key = `${root}:${diff.fingerprint ?? diff.id}:semantic-v1`;
  let pending = cache.get(key);
  if (!pending) {
    pending = Promise.all([analyzeJava(root, diff), analyzeTypeScript(root, diff)]).then((results) => results.filter((result) => result.detail !== "No changed Java source" && result.detail !== "No changed JavaScript, TypeScript, or Vue source"));
    cache.set(key, pending);
    if (cache.size > 40) cache.delete(cache.keys().next().value!);
  }
  return pending;
}
