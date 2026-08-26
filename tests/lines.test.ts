import { describe, expect, it } from "vitest";
import { measureLines, measureLinesByMarkers, splitLines, type CommentRange } from "../src/scanner/lines.ts";

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

describe("measureLinesByMarkers", () => {
  it("recognises the leading hash as a YAML comment so config commentary is separated from settings", () => {
    const metrics = measureLinesByMarkers("# header\nkey: 1\n\n  # indented note\nother: 2\n", "values.yaml");
    expect(metrics.commentLines).toBe(2);
    expect(metrics.codeLines).toBe(2);
    expect(metrics.blankLines).toBe(1);
    expect(metrics.lines).toBe(4);
  });

  it("reports no comments for a format with no comment syntax rather than guessing at one", () => {
    // JSON has no comments, and Markdown prose is content, not commentary.
    const json = measureLinesByMarkers('{\n  "a": 1\n}\n', "package.json");
    expect(json.commentLines).toBe(0);
    expect(json.codeLines).toBe(3);

    const markdown = measureLinesByMarkers("# Heading\n\nA paragraph.\n", "README.md");
    expect(markdown.commentLines).toBe(0);
    expect(markdown.codeLines).toBe(2);
    expect(markdown.blankLines).toBe(1);
  });

  it("attributes every content line of an unknown format to code, so no file reports nothing at all", () => {
    const metrics = measureLinesByMarkers("alpha\n\nbeta\n", "notes.unknownformat");
    expect(metrics.codeLines).toBe(2);
    expect(metrics.commentLines).toBe(0);
    expect(metrics.lines).toBe(2);
  });

  it("matches the extension case-insensitively so an uppercase filename is measured the same way", () => {
    const metrics = measureLinesByMarkers("-- note\nSELECT 1;\n", "REPORT.SQL");
    expect(metrics.commentLines).toBe(1);
    expect(metrics.codeLines).toBe(1);
  });

  it("carries a block comment across lines, including its opening and closing lines", () => {
    const metrics = measureLinesByMarkers("/* one\n   two\n   three */\n.a { color: red; }\n", "theme.css");
    expect(metrics.commentLines).toBe(3);
    expect(metrics.codeLines).toBe(1);
  });

  it("treats a blank line inside a block comment as blank, exactly as the grammar path does", () => {
    const metrics = measureLinesByMarkers("/* one\n\n   three */\n.a { color: red; }\n", "theme.css");
    expect(metrics.blankLines).toBe(1);
    expect(metrics.commentLines).toBe(2);
    expect(metrics.codeLines).toBe(1);
  });

  it("counts a line that opens and closes a block around code as code", () => {
    const metrics = measureLinesByMarkers("/* note */ .a { color: red; } /* tail */\n", "theme.css");
    expect(metrics.codeLines).toBe(1);
    expect(metrics.commentLines).toBe(0);
  });

  it("ignores a comment marker inside a string literal, which would otherwise open a block that never closes", () => {
    // Regression guard: one stray marker in a literal must not turn the rest
    // of a file into commentary.
    const metrics = measureLinesByMarkers('let a = "/* x */"\nlet b = 1\nlet c = 2\n', "App.swift");
    expect(metrics.codeLines).toBe(3);
    expect(metrics.commentLines).toBe(0);
  });

  it("treats an unterminated block as commentary to the end of the file, as the compiler would", () => {
    const metrics = measureLinesByMarkers("@brand: red;\n/* never closed\n.dead { color: @brand; }\n", "mixins.less");
    expect(metrics.codeLines).toBe(1);
    expect(metrics.commentLines).toBe(2);
  });

  it("prefers the longer block opener so a Lua block comment is not read as a line comment", () => {
    const metrics = measureLinesByMarkers("--[[\nnote\n]]\nreturn 1\n", "init.lua");
    expect(metrics.commentLines).toBe(3);
    expect(metrics.codeLines).toBe(1);
  });

  it("identifies formats that carry no extension by filename", () => {
    const dockerfile = measureLinesByMarkers("# base\nFROM alpine\n", "Dockerfile");
    expect(dockerfile.commentLines).toBe(1);
    expect(dockerfile.codeLines).toBe(1);

    const env = measureLinesByMarkers("# secrets\nTOKEN=abc\n", ".env");
    expect(env.commentLines).toBe(1);
    expect(env.codeLines).toBe(1);
  });

  it("falls back to the shebang when the name says nothing about the format", () => {
    const metrics = measureLinesByMarkers("#!/usr/bin/env fish\n# note\nset -gx EDITOR vim\n", "config.fish.d");
    expect(metrics.commentLines).toBe(2);
    expect(metrics.codeLines).toBe(1);
  });

  it("reports zeros for an empty file rather than a phantom line", () => {
    expect(measureLinesByMarkers("", "values.yaml")).toEqual({ lines: 0, codeLines: 0, commentLines: 0, blankLines: 0 });
  });
});
