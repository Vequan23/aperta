import test from "node:test";
import assert from "node:assert/strict";
import { parsePatch } from "../dashboard/src/diff.ts";

test("parses a multi-file patch into navigable, numbered semantic lines", () => {
  const patch = `diff --git a/src/one.ts b/src/one.ts
index 1111111..2222222 100644
--- a/src/one.ts
+++ b/src/one.ts
@@ -4,2 +4,2 @@
-const oldValue = 1
+const newValue = 2
 context()
diff --git a/test/one.test.ts b/test/one.test.ts
new file mode 100644
--- /dev/null
+++ b/test/one.test.ts
@@ -0,0 +1 @@
+test("one", () => {})`;
  const files = parsePatch(patch);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, "src/one.ts");
  assert.deepEqual(files[0].lines.filter((line) => line.kind === "delete")[0], { kind: "delete", text: "const oldValue = 1", oldLine: 4, newLine: null });
  assert.deepEqual(files[0].lines.filter((line) => line.kind === "add")[0], { kind: "add", text: "const newValue = 2", oldLine: null, newLine: 4 });
  assert.equal(files[1].path, "test/one.test.ts");
  assert.equal(files[1].lines.filter((line) => line.kind === "add")[0].newLine, 1);
});
