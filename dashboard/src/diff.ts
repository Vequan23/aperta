export type DiffLine = { kind: "add" | "delete" | "context" | "hunk" | "meta"; text: string; oldLine: number | null; newLine: number | null };
export type FilePatch = { path: string; lines: DiffLine[] };

export function parsePatch(patch: string): FilePatch[] {
  if (!patch.trim()) return [];
  return patch.split(/^diff --git /m).slice(1).map((section) => {
    const raw = section.split("\n");
    const plusPath = raw.find((line) => line.startsWith("+++ b/"))?.slice(6);
    const headerPath = raw[0]?.match(/ b\/(.+)$/)?.[1];
    const path = plusPath && plusPath !== "/dev/null" ? plusPath : headerPath ?? "unknown file";
    let oldLine = 0;
    let newLine = 0;
    const lines: DiffLine[] = raw.slice(1).map((text) => {
      const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); return { kind: "hunk", text, oldLine: null, newLine: null }; }
      if (text.startsWith("+") && !text.startsWith("+++")) return { kind: "add", text: text.slice(1), oldLine: null, newLine: newLine++ };
      if (text.startsWith("-") && !text.startsWith("---")) return { kind: "delete", text: text.slice(1), oldLine: oldLine++, newLine: null };
      if (text.startsWith(" ")) return { kind: "context", text: text.slice(1), oldLine: oldLine++, newLine: newLine++ };
      return { kind: "meta", text, oldLine: null, newLine: null };
    });
    return { path, lines };
  });
}
