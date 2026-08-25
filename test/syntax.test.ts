import test from "node:test";
import assert from "node:assert/strict";
import { tokenizeLine } from "../dashboard/src/syntax.ts";

test("classifies Java syntax without emitting HTML", () => {
  const tokens = tokenizeLine("@Bean public JwtDecoder decoder(String issuer) { return null; }", "SecurityConfig.java");
  assert.deepEqual(tokens.filter((token) => token.kind !== "plain").map((token) => [token.text, token.kind]), [
    ["@Bean", "annotation"], ["public", "keyword"], ["JwtDecoder", "type"], ["String", "type"], ["return", "keyword"], ["null", "literal"],
  ]);
});

test("preserves untrusted source as text tokens", () => {
  const source = "const value = '<script>alert(1)</script>'; // safe text";
  const tokens = tokenizeLine(source, "example.ts");
  assert.equal(tokens.map((token) => token.text).join(""), source);
  assert.equal(tokens.some((token) => token.text.includes("<script>") && token.kind === "string"), true);
  assert.equal(tokens.at(-1)?.kind, "comment");
});

test("highlights XML tags, attributes, and values", () => {
  const tokens = tokenizeLine('<dependency scope="test">', "pom.xml");
  assert.equal(tokens.find((token) => token.kind === "tag")?.text, "<dependency");
  assert.equal(tokens.find((token) => token.kind === "attribute")?.text, "scope");
  assert.equal(tokens.find((token) => token.kind === "string")?.text, '"test"');
});

test("highlights CSS selectors, properties, colors, dimensions, and comments", () => {
  const source = ".agent-card:hover { color: #8ed5aa; padding: 12px 1.5rem; } /* safe */";
  const tokens = tokenizeLine(source, "workbench.css");
  assert.equal(tokens.map((token) => token.text).join(""), source);
  assert.ok(tokens.some((token) => token.text === ".agent-card" && token.kind === "tag"));
  assert.ok(tokens.some((token) => token.text === "color" && token.kind === "property"));
  assert.ok(tokens.some((token) => token.text === "#8ed5aa" && token.kind === "literal"));
  assert.ok(tokens.some((token) => token.text === "12px" && token.kind === "number"));
  assert.ok(tokens.some((token) => token.text === "/* safe */" && token.kind === "comment"));
});
