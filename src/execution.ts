const ALLOWED_ENV = ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "JAVA_HOME", "NODE_OPTIONS", "NVM_BIN"] as const;

export function safeEnvironment() {
  const env: NodeJS.ProcessEnv = { CI: "true", NO_COLOR: "1" };
  for (const key of ALLOWED_ENV) if (process.env[key]) env[key] = process.env[key];
  return env;
}

export function cleanExecutionOutput(value: string) {
  const redacted = value.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/((?:token|secret|password|api[_-]?key)\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]");
  if (redacted.length <= 24_000) return redacted;
  const diagnosticPattern = /(?:\berror\b|\bfail(?:ed|ure)?\b|exception|caused by|cannot find|does not exist|expected|actual|undefined reference|traceback|syntaxerror|typeerror)/i;
  const diagnosticLines = redacted.split("\n").filter((line) => diagnosticPattern.test(line));
  const diagnostics = [...new Set(diagnosticLines)].join("\n").slice(0, 10_000);
  return `${redacted.slice(0, 6_000)}\n\n… high-signal diagnostics …\n${diagnostics || "No diagnostic lines were detected."}\n\n… output truncated …\n\n${redacted.slice(-6_000)}`;
}
