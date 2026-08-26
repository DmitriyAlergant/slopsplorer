import { describe, expect, it } from "vitest";
import { measureLines, measureLinesByPrefix, splitLines, type CommentRange } from "../src/scanner/lines.ts";

/**
 * Comment spans are hand-built here rather than parsed, so these tests pin the
 * line classifier's behaviour independently of any tree-sitter grammar version.
 */
function span(startRow: number, startColumn: number, endRow: number, endColumn: number): CommentRange {
  return { startRow, startColumn, endRow, endColumn };
}

describe("splitLines", () => {
  it("does not invent a trailing line for a file that ends with a newline", () => {
    expect(splitLines("a\n")).toEqual(["a"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("measureLines", () => {
  it("keeps blank lines out of the headline count so whitespace cannot inflate a file's size", () => {
    const text = "a = 1\n\n\nb = 2\n";
    const metrics = measureLines(text, []);
    expect(metrics.blankLines).toBe(2);
    expect(metrics.codeLines).toBe(2);
    expect(metrics.commentLines).toBe(0);
    expect(metrics.lines).toBe(2);
  });

  it("keeps the three counts mutually exclusive, so lines always equals code plus comment", () => {
    const text = "x = 1  # why\n# note\n\ny = 2\n";
    const metrics = measureLines(text, [span(0, 7, 0, 12), span(1, 0, 1, 6)]);
    expect(metrics.lines).toBe(metrics.codeLines + metrics.commentLines);
    expect(metrics.codeLines).toBe(2);
    expect(metrics.commentLines).toBe(1);
    expect(metrics.blankLines).toBe(1);
  });

  it("counts a statement with a trailing explanation as code, so commented code is not read as documentation", () => {
    const text = "const x = 1; // note\n";
    const metrics = measureLines(text, [span(0, 13, 0, 20)]);
    expect(metrics.codeLines).toBe(1);
    expect(metrics.commentLines).toBe(0);
  });

  it("counts a line that is nothing but commentary as comment", () => {
    const text = "  // note\n";
    const metrics = measureLines(text, [span(0, 2, 0, 9)]);
    expect(metrics.commentLines).toBe(1);
    expect(metrics.codeLines).toBe(0);
  });

  it("marks every line of a block comment as comment, including the opening and closing lines", () => {
    const text = "/* one\n   two\n   three */\n";
    const metrics = measureLines(text, [span(0, 0, 2, 11)]);
    expect(metrics.commentLines).toBe(3);
    expect(metrics.codeLines).toBe(0);
    expect(metrics.lines).toBe(3);
  });

  it("still counts the opening line as code when a block comment starts after a statement", () => {
    const text = "foo(); /* note\n   more */\nbar();\n";
    const metrics = measureLines(text, [span(0, 7, 1, 10)]);
    expect(metrics.codeLines).toBe(2);
    expect(metrics.commentLines).toBe(1);
    expect(metrics.lines).toBe(3);
  });

  it("treats a blank line inside a block comment as blank, not as comment", () => {
    // A doc block padded with empty lines should not read as denser prose than it is.
    const text = "/* one\n\n   three */\ncode();\n";
    const metrics = measureLines(text, [span(0, 0, 2, 11)]);
    expect(metrics.blankLines).toBe(1);
    expect(metrics.commentLines).toBe(2);
    expect(metrics.codeLines).toBe(1);
  });

  it("ignores comment spans pointing past the end of the text instead of throwing", () => {
    const metrics = measureLines("a = 1\n", [span(9, 0, 9, 4)]);
    expect(metrics.codeLines).toBe(1);
    expect(metrics.commentLines).toBe(0);
  });

  it("reports zeros for an empty file rather than a phantom line", () => {
    expect(measureLines("", [])).toEqual({ lines: 0, codeLines: 0, commentLines: 0, blankLines: 0 });
  });
});

describe("measureLinesByPrefix", () => {
  it("recognises the leading hash as a YAML comment so config commentary is separated from settings", () => {
    const metrics = measureLinesByPrefix("# header\nkey: 1\n\n  # indented note\nother: 2\n", ".yaml");
    expect(metrics.commentLines).toBe(2);
    expect(metrics.codeLines).toBe(2);
    expect(metrics.blankLines).toBe(1);
    expect(metrics.lines).toBe(4);
  });

  it("reports no comments for a format with no comment syntax rather than guessing at one", () => {
    // JSON has no comments, and Markdown prose is content, not commentary.
    const json = measureLinesByPrefix('{\n  "a": 1\n}\n', ".json");
    expect(json.commentLines).toBe(0);
    expect(json.codeLines).toBe(3);

    const markdown = measureLinesByPrefix("# Heading\n\nA paragraph.\n", ".md");
    expect(markdown.commentLines).toBe(0);
    expect(markdown.codeLines).toBe(2);
    expect(markdown.blankLines).toBe(1);
  });

  it("matches the extension case-insensitively so an uppercase filename is measured the same way", () => {
    const metrics = measureLinesByPrefix("-- note\nSELECT 1;\n", ".SQL");
    expect(metrics.commentLines).toBe(1);
    expect(metrics.codeLines).toBe(1);
  });

  it("reports zeros for an empty file rather than a phantom line", () => {
    expect(measureLinesByPrefix("", ".yaml")).toEqual({ lines: 0, codeLines: 0, commentLines: 0, blankLines: 0 });
  });
});
