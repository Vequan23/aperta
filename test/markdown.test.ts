import assert from "node:assert/strict";
import test from "node:test";
import { languagePath, parseMarkdown, renderInlineMarkdown } from "../dashboard/src/markdown.ts";

test("agent Markdown preserves fenced code as a structured block", () => {
  const blocks = parseMarkdown("## Run this\n\n```sh\n./mvnw test\n```\n");
  assert.deepEqual(blocks, [
    { type: "heading", level: 2, text: "Run this" },
    { type: "code", language: "sh", lines: ["./mvnw test"] },
  ]);
});

test("inline Markdown escapes model HTML before formatting", () => {
  assert.equal(
    renderInlineMarkdown("**safe** `<script>` <img>"),
    "<strong>safe</strong> <code>&lt;script&gt;</code> &lt;img&gt;",
  );
});

test("language aliases route code to the syntax tokenizer", () => {
  assert.equal(languagePath("typescript"), "snippet.ts");
  assert.equal(languagePath("bash"), "snippet.sh");
});
