import path from "node:path";
import { shebangInterpreter } from "./classify.ts";

/** A comment span reported by tree-sitter, in zero-based row/column coordinates. */
export interface CommentRange {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

export interface LineMetrics {
  /** Lines with content: code plus comment. Blank lines are excluded. */
  lines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
}

/** A paired block-comment delimiter, such as the C-family slash-star pair. */
interface BlockDelimiter {
  open: string;
  close: string;
}

/**
 * How one format marks commentary, for files with no tree-sitter grammar.
 *
 * `strings` stops a marker inside a literal from opening a comment. Without it
 * a Swift string holding a slash-star pair would open a block that never
 * closes and swallow the rest of the file. String state is deliberately
 * line-local, so an unbalanced apostrophe in prose costs one line at most.
 */
interface CommentSyntax {
  /** Markers that comment out the remainder of the line. */
  line: readonly string[];
  /** Delimiters that open a comment which may run past the end of the line. */
  block: readonly BlockDelimiter[];
  /** Quote characters whose literals suppress marker recognition. */
  strings: readonly string[];
}

const CODE_QUOTES: readonly string[] = ["\"", "'"];
/** Markup quotes attribute values with `"`. A bare `'` is usually an apostrophe. */
const ATTRIBUTE_QUOTES: readonly string[] = ["\""];

const SLASH_STAR: BlockDelimiter = { open: "/*", close: "*/" };
const ANGLE_BANG: BlockDelimiter = { open: "<!--", close: "-->" };

const HASH_LINE: CommentSyntax = { line: ["#"], block: [], strings: CODE_QUOTES };
/** Every INI dialect in the wild accepts both markers, whichever one it documents. */
const SEMICOLON_OR_HASH_LINE: CommentSyntax = { line: [";", "#"], block: [], strings: CODE_QUOTES };
/** Java properties files, where `!` is a comment marker and nothing else uses it. */
const BANG_OR_HASH_LINE: CommentSyntax = { line: ["#", "!"], block: [], strings: [] };
const SLASH_LINE: CommentSyntax = { line: ["//"], block: [], strings: CODE_QUOTES };
const C_STYLE: CommentSyntax = { line: ["//"], block: [SLASH_STAR], strings: CODE_QUOTES };
/** CSS proper has no line comment. Only its supersets added one. */
const C_BLOCK_ONLY: CommentSyntax = { line: [], block: [SLASH_STAR], strings: CODE_QUOTES };
const SQL_STYLE: CommentSyntax = { line: ["--"], block: [SLASH_STAR], strings: CODE_QUOTES };
const LUA_STYLE: CommentSyntax = { line: ["--"], block: [{ open: "--[[", close: "]]" }], strings: CODE_QUOTES };
const HCL_STYLE: CommentSyntax = { line: ["#", "//"], block: [SLASH_STAR], strings: ATTRIBUTE_QUOTES };
const MARKUP_STYLE: CommentSyntax = { line: [], block: [ANGLE_BANG], strings: ATTRIBUTE_QUOTES };
/** A single-file component is markup wrapped around script and style blocks. */
const COMPONENT_STYLE: CommentSyntax = { line: ["//"], block: [ANGLE_BANG, SLASH_STAR], strings: CODE_QUOTES };

/**
 * Comment markers for formats with no tree-sitter grammar.
 *
 * The markers follow `cloc`'s language definitions, which were read as the
 * reference while this table was built. It stays an explicit table rather than
 * a pattern match because these counts are the product's output, so a reader
 * has to be able to check exactly what was treated as commentary.
 *
 * Prose formats are deliberately absent: a Markdown paragraph is content, not
 * commentary, and counting it as comment would misreport documentation weight.
 * JSON is absent because it has no comment syntax at all. An absent format
 * reports every content line as code, never nothing, so a file with content
 * always shows up somewhere.
 */
const COMMENT_SYNTAX_BY_EXTENSION: ReadonlyMap<string, CommentSyntax> = new Map([
  // Hash-marked configuration and scripting.
  [".yaml", HASH_LINE], [".yml", HASH_LINE], [".toml", HASH_LINE],
  [".fish", HASH_LINE], [".r", HASH_LINE], [".pl", HASH_LINE], [".pm", HASH_LINE],
  [".mk", HASH_LINE], [".cmake", HASH_LINE], [".dockerfile", HASH_LINE],
  [".ini", SEMICOLON_OR_HASH_LINE], [".cfg", SEMICOLON_OR_HASH_LINE], [".conf", SEMICOLON_OR_HASH_LINE],
  [".properties", BANG_OR_HASH_LINE],
  // C-family languages with no grammar of their own here.
  [".kt", C_STYLE], [".kts", C_STYLE], [".swift", C_STYLE], [".scala", C_STYLE],
  [".sbt", C_STYLE], [".dart", C_STYLE], [".proto", C_STYLE],
  [".jsonc", C_STYLE], [".json5", C_STYLE],
  [".prisma", SLASH_LINE],
  [".sql", SQL_STYLE],
  [".lua", LUA_STYLE],
  [".tf", HCL_STYLE], [".tfvars", HCL_STYLE], [".hcl", HCL_STYLE],
  // Stylesheets.
  [".css", C_BLOCK_ONLY], [".scss", C_STYLE], [".sass", C_STYLE], [".less", C_STYLE],
  // Markup.
  [".html", MARKUP_STYLE], [".htm", MARKUP_STYLE], [".xhtml", MARKUP_STYLE],
  [".xml", MARKUP_STYLE], [".svg", MARKUP_STYLE],
  [".vue", COMPONENT_STYLE], [".svelte", COMPONENT_STYLE],
]);

/**
 * Formats identified by filename, because they carry no extension to key on.
 *
 * `path.extname` returns nothing for `Dockerfile` and for a leading-dot name
 * such as `.env`, so these are matched on the whole lowercased basename.
 */
const COMMENT_SYNTAX_BY_FILENAME: ReadonlyMap<string, CommentSyntax> = new Map([
  ["dockerfile", HASH_LINE], ["containerfile", HASH_LINE],
  ["makefile", HASH_LINE], ["gnumakefile", HASH_LINE], ["cmakelists.txt", HASH_LINE],
  [".env", HASH_LINE], [".env.example", HASH_LINE], [".env.local", HASH_LINE],
  [".env.sample", HASH_LINE], [".env.template", HASH_LINE],
  [".editorconfig", SEMICOLON_OR_HASH_LINE],
]);

/**
 * Shebang interpreters whose scripts use `#` line comments.
 *
 * The Bourne family is absent because `grammarForFile` routes it to the bash
 * grammar before this fallback is consulted. Fish is here instead of there:
 * it uses `#` too, but its syntax is not Bourne shell.
 */
const HASH_COMMENT_INTERPRETERS: ReadonlySet<string> = new Set([
  "awk", "fish", "gawk", "make", "perl", "python", "r", "rscript", "ruby",
  "sed", "tcl", "tclsh",
]);

/** The markers that apply to one file, or `null` when no rule covers it. */
function commentSyntaxFor(fileName: string, text: string): CommentSyntax | null {
  const name = fileName.toLowerCase();
  const byFilename = COMMENT_SYNTAX_BY_FILENAME.get(name);
  if (byFilename) return byFilename;
  const byExtension = COMMENT_SYNTAX_BY_EXTENSION.get(path.posix.extname(name));
  if (byExtension) return byExtension;
  const interpreter = shebangInterpreter(text);
  if (interpreter !== null && HASH_COMMENT_INTERPRETERS.has(interpreter)) return HASH_LINE;
  return null;
}

/**
 * Split `text` into lines, dropping the empty element a trailing newline
 * produces so that "a\n" counts as one line rather than two.
 */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Classify every line as blank, comment, or code.
 *
 * A line counts as comment only when its entire content is commentary, so a
 * statement with a trailing explanation still counts as code. This matches the
 * convention `cloc` uses and keeps the three counts mutually exclusive.
 */
export function measureLines(text: string, commentRanges: readonly CommentRange[]): LineMetrics {
  const lines = splitLines(text);
  // Int32Array cannot hold Number.MAX_SAFE_INTEGER, so the largest int32 is
  // the "no comment starts on this line yet" sentinel.
  const NO_COMMENT = 0x7fffffff;
  const spanStart = new Int32Array(lines.length).fill(NO_COMMENT);
  const spanEnd = new Int32Array(lines.length).fill(-1);
  const fullyCommented = new Uint8Array(lines.length);

  for (const range of commentRanges) {
    if (range.startRow === range.endRow) {
      const row = range.startRow;
      if (row < 0 || row >= lines.length) continue;
      spanStart[row] = Math.min(spanStart[row]!, range.startColumn);
      spanEnd[row] = Math.max(spanEnd[row]!, range.endColumn);
      continue;
    }
    if (range.startRow >= 0 && range.startRow < lines.length) {
      spanStart[range.startRow] = Math.min(spanStart[range.startRow]!, range.startColumn);
      spanEnd[range.startRow] = lines[range.startRow]!.length;
    }
    for (let row = range.startRow + 1; row < range.endRow && row < lines.length; row += 1) {
      fullyCommented[row] = 1;
    }
    if (range.endRow >= 0 && range.endRow < lines.length) {
      spanStart[range.endRow] = 0;
      spanEnd[range.endRow] = Math.max(spanEnd[range.endRow]!, range.endColumn);
    }
  }

  let blankLines = 0;
  let commentLines = 0;
  let codeLines = 0;
  for (const [row, line] of lines.entries()) {
    if (line.trim() === "") {
      blankLines += 1;
      continue;
    }
    if (fullyCommented[row] === 1) {
      commentLines += 1;
      continue;
    }
    const end = spanEnd[row]!;
    if (end >= 0) {
      const before = line.slice(0, spanStart[row]!);
      const after = line.slice(end);
      if (before.trim() === "" && after.trim() === "") {
        commentLines += 1;
        continue;
      }
    }
    codeLines += 1;
  }

  return { lines: commentLines + codeLines, codeLines, commentLines, blankLines };
}

/** What one line contributed, and the block comment left open at its end. */
interface LineScan {
  /** Any non-whitespace character outside a comment, so the line counts as code. */
  hasCode: boolean;
  openBlock: BlockDelimiter | null;
}

/**
 * Walk one line, tracking block-comment and string-literal state.
 *
 * Block openers are tested before line markers so that Lua's `--[[` wins over
 * its `--`. Block state carries to the next line and string state does not,
 * which bounds the damage from an unbalanced quote to the line that holds it.
 */
function scanLine(line: string, syntax: CommentSyntax, entryBlock: BlockDelimiter | null): LineScan {
  let openBlock = entryBlock;
  let quote: string | null = null;
  let hasCode = false;
  let index = 0;
  while (index < line.length) {
    if (openBlock !== null) {
      if (line.startsWith(openBlock.close, index)) {
        index += openBlock.close.length;
        openBlock = null;
      } else index += 1;
      continue;
    }
    const character = line[index]!;
    if (quote !== null) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === quote) quote = null;
      index += 1;
      continue;
    }
    const opened = syntax.block.find((delimiter) => line.startsWith(delimiter.open, index));
    if (opened !== undefined) {
      openBlock = opened;
      index += opened.open.length;
      continue;
    }
    if (syntax.line.some((marker) => line.startsWith(marker, index))) break;
    if (syntax.strings.includes(character)) {
      quote = character;
      hasCode = true;
      index += 1;
      continue;
    }
    if (character.trim() !== "") hasCode = true;
    index += 1;
  }
  return { hasCode, openBlock };
}

/**
 * Line metrics for formats with no grammar, using comment markers.
 *
 * A format the marker table does not cover reports every content line as code.
 * A file with content must never report nothing at all, and code is the honest
 * bucket for a format whose comment syntax is unknown.
 *
 * `fileName` is the basename rather than the extension, because `Dockerfile`,
 * `Makefile`, and `.env` have no extension to key on, and because a `#!` line
 * is the last resort for a name that says nothing.
 */
export function measureLinesByMarkers(text: string, fileName: string): LineMetrics {
  const syntax = commentSyntaxFor(fileName, text);
  const lines = splitLines(text);
  let blankLines = 0;
  let commentLines = 0;
  let codeLines = 0;
  let openBlock: BlockDelimiter | null = null;
  for (const line of lines) {
    // Checked before the scan so a padding line inside a block comment counts
    // as blank, exactly as it does on the grammar path.
    if (line.trim() === "") {
      blankLines += 1;
      continue;
    }
    if (syntax === null) {
      codeLines += 1;
      continue;
    }
    const scan = scanLine(line, syntax, openBlock);
    openBlock = scan.openBlock;
    if (scan.hasCode) codeLines += 1;
    else commentLines += 1;
  }
  return { lines: commentLines + codeLines, codeLines, commentLines, blankLines };
}
