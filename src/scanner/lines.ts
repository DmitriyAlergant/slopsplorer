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

/**
 * Comment markers for formats with no tree-sitter grammar.
 *
 * Prose formats are deliberately absent: a Markdown paragraph is content, not
 * commentary, and counting it as comment would misreport documentation weight.
 */
const LINE_COMMENT_PREFIXES: ReadonlyMap<string, readonly string[]> = new Map([
  [".yaml", ["#"]],
  [".yml", ["#"]],
  [".toml", ["#"]],
  [".sql", ["--"]],
  [".prisma", ["//"]],
  [".jsonc", ["//"]],
]);

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

/** Line metrics for formats without a grammar, using leading-marker detection. */
export function measureLinesByPrefix(text: string, extension: string): LineMetrics {
  const prefixes = LINE_COMMENT_PREFIXES.get(extension.toLowerCase());
  const lines = splitLines(text);
  let blankLines = 0;
  let commentLines = 0;
  let codeLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") blankLines += 1;
    else if (prefixes?.some((prefix) => trimmed.startsWith(prefix))) commentLines += 1;
    else codeLines += 1;
  }
  return { lines: commentLines + codeLines, codeLines, commentLines, blankLines };
}
