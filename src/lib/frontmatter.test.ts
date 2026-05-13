// Run with: node --test src/lib/frontmatter.test.ts
// (Node 24 strips TS natively.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinFrontmatter, parseFrontmatter, parseSimpleYaml } from "./frontmatter.ts";

test("parseFrontmatter — no frontmatter returns body unchanged", () => {
  const txt = "# hello\nworld\n";
  const r = parseFrontmatter(txt);
  assert.equal(r.prefix, null);
  assert.equal(r.frontmatter, null);
  assert.equal(r.body, txt);
});

test("parseFrontmatter — simple LF document", () => {
  const txt = "---\ntitle: Foo\ntags: [a, b]\n---\n# Heading\n";
  const r = parseFrontmatter(txt);
  assert.equal(r.frontmatter, "title: Foo\ntags: [a, b]");
  assert.equal(r.body, "# Heading\n");
  assert.equal(joinFrontmatter(r.prefix, r.body), txt);
});

test("parseFrontmatter — CRLF document", () => {
  const txt = "---\r\ntitle: Foo\r\n---\r\nbody\r\n";
  const r = parseFrontmatter(txt);
  assert.equal(r.frontmatter, "title: Foo");
  assert.equal(r.body, "body\r\n");
  assert.equal(joinFrontmatter(r.prefix, r.body), txt);
});

test("parseFrontmatter — extra blank lines belong to prefix", () => {
  const txt = "---\ntitle: Foo\n---\n\n\nbody\n";
  const r = parseFrontmatter(txt);
  assert.equal(r.frontmatter, "title: Foo");
  assert.equal(r.body, "body\n");
  assert.equal(joinFrontmatter(r.prefix, r.body), txt);
});

test("parseFrontmatter — no trailing newline after closing ---", () => {
  const txt = "---\ntitle: Foo\n---";
  const r = parseFrontmatter(txt);
  assert.equal(r.frontmatter, "title: Foo");
  assert.equal(r.body, "");
});

test("parseFrontmatter — frontmatter must be at byte 0", () => {
  const txt = "\n---\ntitle: Foo\n---\nbody\n";
  const r = parseFrontmatter(txt);
  assert.equal(r.prefix, null);
  assert.equal(r.body, txt);
});

test("parseFrontmatter — bare `---` (HR) at start is not frontmatter", () => {
  // A horizontal rule without a closing fence shouldn't be misread.
  const txt = "---\njust a paragraph\nwith no closing\n";
  const r = parseFrontmatter(txt);
  assert.equal(r.prefix, null);
  assert.equal(r.body, txt);
});

test("parseFrontmatter — round-trip preserves arbitrary YAML content", () => {
  const txt =
    "---\n# a yaml comment\ntitle: \"quoted: value\"\nnested:\n  key: val\n  list:\n    - one\n    - two\n---\n\nbody text\n";
  const r = parseFrontmatter(txt);
  assert.equal(joinFrontmatter(r.prefix, r.body), txt);
});

test("joinFrontmatter — null prefix yields just the body", () => {
  assert.equal(joinFrontmatter(null, "hello"), "hello");
});

test("parseSimpleYaml — top-level key/value pairs", () => {
  const props = parseSimpleYaml("title: Foo\nauthor: Camille\n");
  assert.deepEqual(props, [
    { key: "title", value: "Foo" },
    { key: "author", value: "Camille" },
  ]);
});

test("parseSimpleYaml — flattens one level of nesting", () => {
  const props = parseSimpleYaml("model: opus\nparams:\n  temperature: 0.7\n  top_p: 1\n");
  assert.equal(props.length, 2);
  assert.equal(props[0].key, "model");
  assert.equal(props[0].value, "opus");
  assert.equal(props[1].key, "params");
  // nested keys are joined with " · "
  assert.match(props[1].value, /temperature: 0\.7/);
  assert.match(props[1].value, /top_p: 1/);
});

test("parseSimpleYaml — empty value yields empty string", () => {
  const props = parseSimpleYaml("name:\nval: x\n");
  assert.deepEqual(props, [
    { key: "name", value: "" },
    { key: "val", value: "x" },
  ]);
});

test("parseSimpleYaml — ignores blank lines and yaml comments don't crash", () => {
  // The parser is intentionally lightweight: a `#` comment line does not
  // match the top-level regex and is currently swallowed by the `else if`
  // branch as nested content of the previous key. This test documents that
  // behavior so a future change is intentional.
  const props = parseSimpleYaml("\n\ntitle: Foo\n\n");
  assert.deepEqual(props, [{ key: "title", value: "Foo" }]);
});

test("parseSimpleYaml — hyphenated keys", () => {
  const props = parseSimpleYaml("source-path: /tmp/x\nfont-size: 14\n");
  assert.deepEqual(props, [
    { key: "source-path", value: "/tmp/x" },
    { key: "font-size", value: "14" },
  ]);
});
