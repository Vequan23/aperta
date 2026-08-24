import type { Authorship, ConfidenceScore } from "./types.ts";

async function singleKey(valid: Set<string>, timeoutMs?: number): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (value: string | null) => {
      if (timer) clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(value);
    };
    const onData = (key: string) => {
      if (key === "\u0003") {
        finish(null);
        process.kill(process.pid, "SIGINT");
      } else if (key === "\u001b") finish(null);
      else if (valid.has(key)) finish(key);
    };
    process.stdin.on("data", onData);
    if (timeoutMs) timer = setTimeout(() => finish(null), timeoutMs);
  });
}

export async function promptAuthorship(): Promise<Authorship | null> {
  process.stdout.write("Authorship: [a]i  [h]uman  [m]ixed  [esc] skip  ");
  const key = await singleKey(new Set(["a", "h", "m"]));
  process.stdout.write(key ? `${key}\n` : "skipped\n");
  return key === "a" ? "ai" : key === "h" ? "human" : key === "m" ? "mixed" : null;
}

export async function promptConfidence(timeoutSeconds: number): Promise<ConfidenceScore | null> {
  process.stdout.write("Confidence: [1] opaque  [2] followable  [3] owned  [esc] skip  ");
  const key = await singleKey(new Set(["1", "2", "3"]), timeoutSeconds * 1000);
  process.stdout.write(key ? `${key}\n` : "unrated\n");
  return key ? Number(key) as ConfidenceScore : null;
}
