import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { appendEvent, eventBase, readLedger } from "./ledger.ts";
import type { DiffEvent, ProbeEvent } from "./types.ts";
import type { ImpactGraph } from "./impact.ts";
import { cleanExecutionOutput, safeEnvironment } from "./execution.ts";

const execFileAsync = promisify(execFile);
const active = new Set<string>();

export interface ProbeDefinition {
  id: string; label: string; hypothesis: string; why: string;
  language: "java" | "typescript"; framework: string;
  readiness: "ready" | "needs-context"; generatedPath: string; source: string;
  command?: string; targetNodeIds: string[];
}

const commonImports = `import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwsHeader;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;`;

const helpers = `    private static JwtProperties properties(String rawKey, String issuer) {
        return new JwtProperties(Base64.getEncoder().encodeToString(rawKey.getBytes(StandardCharsets.UTF_8)),
                issuer, Duration.ofMinutes(15), Duration.ofDays(7));
    }

    private static String encode(JwtEncoder encoder, String issuer, String subject, Instant issuedAt, Instant expiresAt) {
        JwtClaimsSet claims = JwtClaimsSet.builder().issuer(issuer).subject(subject)
                .issuedAt(issuedAt).expiresAt(expiresAt).build();
        return encoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }`;

function javaSource(packageName: string, probeId: string) {
  const test = probeId === "jwt-expired"
    ? `    @Test
    void rejectsExpiredToken() {
        JwtProperties properties = properties("expired-probe-key-with-at-least-32-bytes", "auth-service");
        SecurityConfig configuration = new SecurityConfig();
        SecretKey key = configuration.jwtSigningKey(properties);
        JwtDecoder decoder = configuration.jwtDecoder(key, properties);
        Instant now = Instant.now();
        String token = encode(configuration.jwtEncoder(key), properties.issuer(), UUID.randomUUID().toString(),
                now.minusSeconds(120), now.minusSeconds(60));

        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
    }`
    : probeId === "jwt-issuer"
      ? `    @Test
    void rejectsTokenFromIncorrectIssuer() {
        JwtProperties properties = properties("issuer-probe-key-with-at-least-32-bytes", "auth-service");
        SecurityConfig configuration = new SecurityConfig();
        SecretKey key = configuration.jwtSigningKey(properties);
        JwtDecoder decoder = configuration.jwtDecoder(key, properties);
        Instant now = Instant.now();
        String token = encode(configuration.jwtEncoder(key), "another-issuer", UUID.randomUUID().toString(),
                now, now.plusSeconds(60));

        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
    }`
      : `    @Test
    void rejectsTokenWithInvalidSignature() {
        JwtProperties signingProperties = properties("signing-probe-key-with-at-least-32-bytes", "auth-service");
        JwtProperties verifyingProperties = properties("different-verification-key-32-bytes!", "auth-service");
        SecurityConfig configuration = new SecurityConfig();
        SecretKey signingKey = configuration.jwtSigningKey(signingProperties);
        SecretKey verifyingKey = configuration.jwtSigningKey(verifyingProperties);
        JwtDecoder decoder = configuration.jwtDecoder(verifyingKey, verifyingProperties);
        Instant now = Instant.now();
        String token = encode(configuration.jwtEncoder(signingKey), signingProperties.issuer(),
                UUID.randomUUID().toString(), now, now.plusSeconds(60));

        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
    }`;
  return `package ${packageName};

${commonImports}

class ApertaGeneratedSecurityProbeTest {

${test}

${helpers}
}
`;
}

function endpointScaffold(packageName: string) {
  return `package ${packageName};

// Aperta needs one concrete protected route and the repository's preferred
// Spring test slice before this integration probe can execute safely.
// Intended assertion: an unauthenticated request is rejected, while the same
// request with a decoder-accepted JWT reaches the protected endpoint.
class ApertaGeneratedEndpointAuthorizationProbeTest {}
`;
}

function targets(graph: ImpactGraph, patterns: RegExp[]) {
  return graph.nodes.filter((node) => patterns.some((pattern) => pattern.test(`${node.label} ${node.detail ?? ""}`))).map((node) => node.id);
}

async function javaContext(root: string, diff: DiffEvent) {
  const test = diff.files.find((file) => /JwtConfigurationTests\.java$/.test(file.path));
  if (!test) return null;
  let source = ""; try { source = await readFile(join(root, test.path), "utf8"); } catch { return null; }
  const packageName = source.match(/^package\s+([\w.]+);/m)?.[1];
  if (!packageName) return null;
  return { packageName, generatedPath: join(dirname(test.path), "ApertaGeneratedSecurityProbeTest.java") };
}

export async function generateProbes(root: string, diff: DiffEvent, graph: ImpactGraph): Promise<ProbeDefinition[]> {
  const context = await javaContext(root, diff);
  if (!context || !/JwtAuthenticationFilter|OAuth2 resource server/.test(`${graph.headline} ${graph.nodes.map((node) => node.label).join(" ")}`)) return [];
  const command = "./mvnw -q -Dtest=ApertaGeneratedSecurityProbeTest test";
  const decoderTargets = targets(graph, [/JwtDecoder/i, /resource server/i, /jwtDecoder/i]);
  const definitions: Array<Omit<ProbeDefinition, "source" | "generatedPath" | "command" | "targetNodeIds"> & { executable: boolean; patterns: RegExp[] }> = [
    { id: "jwt-expired", label: "Expired token rejection", hypothesis: "The configured decoder rejects a correctly signed token after its expiration instant.", why: "Default timestamp validation is assumed but has not been executed against this configuration.", language: "java", framework: "JUnit 5 + AssertJ", readiness: "ready", executable: true, patterns: [/JwtDecoder/i, /resource server/i, /jwtDecoder/i] },
    { id: "jwt-issuer", label: "Incorrect issuer rejection", hypothesis: "The configured decoder rejects a valid signature when the issuer claim does not match JwtProperties.", why: "Issuer validation was added as configuration and needs executable evidence.", language: "java", framework: "JUnit 5 + AssertJ", readiness: "ready", executable: true, patterns: [/JwtIssuerValidator/i, /JwtDecoder/i, /jwtDecoder/i] },
    { id: "jwt-signature", label: "Invalid signature rejection", hypothesis: "The configured decoder rejects a token signed with a different HS256 key.", why: "Signing-key mismatch is a critical authentication boundary not covered by the changed tests.", language: "java", framework: "JUnit 5 + AssertJ", readiness: "ready", executable: true, patterns: [/SecretKey/i, /JwtDecoder/i, /jwtDecoder/i] },
    { id: "jwt-endpoint", label: "Endpoint authorization boundaries", hypothesis: "Protected endpoints reject anonymous requests and accept decoder-approved bearer tokens.", why: "No concrete protected controller route exists in the current repository, so Aperta will not invent an integration target.", language: "java", framework: "Spring MockMvc", readiness: "needs-context", executable: false, patterns: [/HTTP API/i, /SecurityFilterChain/i, /securityFilterChain/i] },
  ];
  return definitions.map((definition) => ({
    id: definition.id, label: definition.label, hypothesis: definition.hypothesis, why: definition.why,
    language: definition.language, framework: definition.framework, readiness: definition.readiness,
    generatedPath: definition.id === "jwt-endpoint" ? context.generatedPath.replace("SecurityProbe", "EndpointAuthorizationProbe") : context.generatedPath,
    source: definition.id === "jwt-endpoint" ? endpointScaffold(context.packageName) : javaSource(context.packageName, definition.id),
    command: definition.executable ? command : undefined,
    targetNodeIds: definition.patterns.length ? targets(graph, definition.patterns) : decoderTargets,
  }));
}

export async function probeHistory(root: string, diffId: string): Promise<ProbeEvent[]> {
  return (await readLedger(root)).filter((event): event is ProbeEvent => event.kind === "probe" && event.diffId === diffId).sort((a, b) => b.ts.localeCompare(a.ts));
}

export async function executeProbe(root: string, diff: DiffEvent, probe: ProbeDefinition, signal?: AbortSignal): Promise<ProbeEvent> {
  if (probe.readiness !== "ready" || !probe.command) throw new Error("This probe needs repository context before it can run.");
  const key = `${root}:${diff.id}:${probe.id}`;
  if (active.has(key)) throw new Error("This probe is already running.");
  active.add(key);
  const temp = await mkdtemp(join(tmpdir(), "aperta-probe-"));
  const isolatedRoot = join(temp, "repo");
  const started = Date.now();
  let exitCode: number | null = 0; let output = "";
  try {
    await cp(root, isolatedRoot, { recursive: true, filter: (source) => {
      const parts = relative(root, source).split(sep);
      return !parts.some((part) => [".git", ".comprehension", "node_modules", "target", "build", ".gradle"].includes(part));
    } });
    const destination = join(isolatedRoot, probe.generatedPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, probe.source, "utf8");
    try { await chmod(join(isolatedRoot, "mvnw"), 0o755); } catch {}
    try {
      const result = await execFileAsync("./mvnw", ["-q", "-Dtest=ApertaGeneratedSecurityProbeTest", "test"], { cwd: isolatedRoot, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024, env: safeEnvironment(), signal });
      output = `${result.stdout}${result.stderr}`;
    } catch (error) {
      const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
      exitCode = typeof failure.code === "number" ? failure.code : null;
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.killed ? "\nProbe timed out after five minutes." : ""}`;
    }
  } finally { await rm(temp, { recursive: true, force: true }); active.delete(key); }
  if (signal?.aborted) throw new Error("Probe canceled");
  const cleaned = cleanExecutionOutput(output);
  const status: ProbeEvent["status"] = exitCode === 0 ? "proven" : /Tests run:|Failures:|AssertionError|expected:/i.test(cleaned) ? "disproven" : "inconclusive";
  const event: ProbeEvent = {
    ...eventBase(root, diff.branch), kind: "probe", diffId: diff.id, probeId: probe.id, label: probe.label, status,
    command: probe.command, durationMs: Date.now() - started, exitCode, output: cleaned, generatedPath: probe.generatedPath,
    sourceHash: createHash("sha256").update(probe.source).digest("hex"), targetNodeIds: probe.targetNodeIds,
  };
  await appendEvent(root, event);
  return event;
}
