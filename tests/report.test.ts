import path from "node:path";
import { describe, expect, it } from "vitest";
import { assembleIndex, buildFolders, UNCHANGED_FILE_FIELDS, type ScanIndex } from "../src/scanner/scan.ts";
import { buildReport, formatCompact, type ReportOptions } from "../src/server/report.ts";
import type { ChangeStatus, DiffMeta, FileKind, FileRow } from "../src/shared/api.ts";

/**
 * A file described by its weight alone.
 *
 * Weights stay under a thousand so that every printed figure is exact and a
 * test can add the rows of a level and compare them with the level above.
 */
interface FileSpec {
  path: string;
  tokens: number;
  kind?: FileKind;
  generated?: boolean;
  commentLines?: number;
  language?: string;
  functions?: number;
  branches?: number;
  status?: ChangeStatus;
  added?: number;
  removed?: number;
  previousPath?: string;
}

function rowOf(spec: FileSpec): FileRow {
  const added = spec.added ?? 0;
  const removed = spec.removed ?? 0;
  const commentLines = spec.commentLines ?? 0;
  return {
    ...UNCHANGED_FILE_FIELDS,
    path: spec.path,
    name: path.posix.basename(spec.path),
    kind: spec.kind ?? "code",
    generated: spec.generated ?? false,
    status: spec.status ?? "unchanged",
    previousPath: spec.previousPath ?? null,
    tokens: spec.tokens,
    lines: spec.tokens,
    codeLines: spec.tokens - commentLines,
    commentLines,
    blankLines: 0,
    functions: spec.functions ?? 0,
    classes: 0,
    branches: spec.branches ?? 0,
    language: spec.language ?? null,
    addedTokens: added, removedTokens: removed, churnTokens: added + removed, netTokens: added - removed,
    addedLines: added, removedLines: removed, churnLines: added + removed, netLines: added - removed,
    addedCodeLines: added, removedCodeLines: removed, churnCodeLines: added + removed, netCodeLines: added - removed,
    addedPhysicalLines: added, removedPhysicalLines: removed,
  };
}

function makeIndex(specs: readonly FileSpec[], diff: DiffMeta | null = null): ScanIndex {
  const files = specs.map(rowOf).sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const folders = buildFolders(files, "repo");
  return assembleIndex({
    rootPath: "/repo",
    rootName: "repo",
    tokenizer: "cl100k_base",
    fileCount: files.length,
    folderCount: folders.length,
    scannedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 0,
    fileSource: diff === null ? "git-index" : "git-diff",
    diff,
    review: diff === null ? null : {
      mode: "diff",
      spec: diff.spec,
      request: diff.request,
      base: diff.base,
      target: diff.target,
    },
    skippedLargeFiles: 0,
    languages: [],
  }, files, folders);
}

const SCAN_OPTIONS: ReportOptions = { measure: "tokens", aspect: "after", threshold: 3 };

/** A printed row as its depth and its columns, so a test does not depend on padding. */
function parseRow(line: string): { depth: number; cells: string[] } {
  const leading = line.length - line.trimStart().length;
  return { depth: leading / 2, cells: line.trim().split(/ {2,}/) };
}

/** The rows of one section, up to the next blank line. */
function sectionRows(report: string, heading: string): string[] {
  const lines = report.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${heading}  `));
  if (start < 0) throw new Error(`no section ${heading} in:\n${report}`);
  const rows: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line === "") break;
    rows.push(line);
  }
  return rows;
}

function sectionLine(report: string, heading: string): string {
  const line = report.split("\n").find((candidate) => candidate.startsWith(`${heading}  `));
  if (line === undefined) throw new Error(`no section ${heading} in:\n${report}`);
  return line;
}

const TREE: readonly FileSpec[] = [
  { path: "src/app/main.ts", tokens: 400 },
  { path: "src/app/util.ts", tokens: 100 },
  { path: "src/app/tiny.ts", tokens: 5 },
  { path: "src/lib/index.ts", tokens: 95 },
  { path: "tests/app.test.ts", tokens: 80, kind: "test" },
  { path: "tests/lib/lib.test.ts", tokens: 20, kind: "test" },
  { path: "README.md", tokens: 50, kind: "text" },
  { path: "docs/guide.md", tokens: 30, kind: "text" },
  { path: "package.json", tokens: 40, kind: "data" },
  { path: "package-lock.json", tokens: 300, kind: "data", generated: true },
];

describe("report header", () => {
  const report = buildReport(makeIndex(TREE), SCAN_OPTIONS);
  const [title, totals, split, sentences] = report.split("\n");

  it("names the root and the whole tree", () => {
    expect(title).toBe("slopsplorer report  /repo");
    expect(totals).toBe("tree of 10 files: 1.1k tokens (cl100k_base), 1.1k lines, 1.1k loc, 0% comment");
  });

  it("splits the unit by flavor against the whole tree, generated included", () => {
    expect(split).toBe("tokens by flavor: code 600 54%  tests 100 9%  docs 80 7%  data 40 4%  generated 300 27%");
  });

  it("states the test-to-code ratio and the rule", () => {
    expect(sentences).toBe("Tests weigh 17% of code. A node is expanded at >= 3% of its section.");
  });
});

describe("report code section", () => {
  const report = buildReport(makeIndex(TREE), SCAN_OPTIONS);
  const rows = sectionRows(report, "CODE").map(parseRow);

  it("heads the section with its own total and comment share", () => {
    expect(sectionLine(report, "CODE")).toBe("CODE  600 tokens, 4 files, 0% comment");
  });

  it("collapses the root into the one folder that holds every code file", () => {
    expect(rows[0]).toEqual({ depth: 0, cells: ["src/", "600", "100%", "4 files"] });
  });

  it("expands a node at the threshold, lists the heaviest first, and rolls up the rest", () => {
    expect(rows.slice(1)).toEqual([
      { depth: 1, cells: ["app/", "505", "84%", "3 files"] },
      { depth: 2, cells: ["main.ts", "400", "67%", "400 loc"] },
      { depth: 2, cells: ["util.ts", "100", "17%", "100 loc"] },
      { depth: 2, cells: ["... 1 file", "5", "1%"] },
      { depth: 1, cells: ["lib/", "95", "16%", "1 file"] },
      { depth: 2, cells: ["index.ts", "95", "16%", "95 loc"] },
    ]);
  });

  it("partitions every expanded folder: its listed children and the roll-up sum to it", () => {
    // app/ is 505 = 400 + 100 + 5, and src/ is 600 = 505 + 95.
    const weightOf = (label: string): number => Number(rows.find((row) => row.cells[0] === label)!.cells[1]);
    expect(weightOf("main.ts") + weightOf("util.ts") + weightOf("... 1 file")).toBe(weightOf("app/"));
    expect(weightOf("app/") + weightOf("lib/")).toBe(weightOf("src/"));
  });

  it("prints a folder as a leaf when no child reaches the threshold", () => {
    const spread = [
      { path: "main.ts", tokens: 300 },
      ...Array.from({ length: 20 }, (_, position) => ({ path: `big/f${position}.ts`, tokens: 10 })),
    ];
    const leafRows = sectionRows(buildReport(makeIndex(spread), SCAN_OPTIONS), "CODE").map(parseRow);
    expect(leafRows).toEqual([
      { depth: 0, cells: ["./", "500", "100%", "21 files"] },
      { depth: 1, cells: ["main.ts", "300", "60%", "300 loc"] },
      { depth: 1, cells: ["big/", "200", "40%", "20 files"] },
    ]);
  });

  it("collapses a chain of single-folder folders into one row", () => {
    const chain = [
      { path: "src/main/java/com/acme/App.java", tokens: 500 },
      { path: "src/main/java/com/acme/Util.java", tokens: 100 },
    ];
    const chainRows = sectionRows(buildReport(makeIndex(chain), SCAN_OPTIONS), "CODE").map(parseRow);
    expect(chainRows[0]).toEqual({ depth: 0, cells: ["src/main/java/com/acme/", "600", "100%", "2 files"] });
    expect(chainRows[1]?.cells[0]).toBe("App.java");
  });

  it("always names a file that reaches the threshold, however deep it sits", () => {
    const deep = [
      { path: "a/b/c/d/heavy.ts", tokens: 30 },
      { path: "a/b/c/d/light.ts", tokens: 1 },
      { path: "a/b/c/other.ts", tokens: 1 },
      { path: "a/x.ts", tokens: 968 },
    ];
    // 30 of 1000 is 3%, exactly at the threshold, so the folder chain above it is opened.
    const labels = sectionRows(buildReport(makeIndex(deep), SCAN_OPTIONS), "CODE").map((row) => parseRow(row).cells[0]);
    expect(labels).toEqual(["a/", "x.ts", "b/c/", "d/", "heavy.ts", "... 1 file", "... 1 file"]);
  });

  it("prints only the root row at a threshold no child reaches", () => {
    const rootOnly = sectionRows(buildReport(makeIndex(TREE), { ...SCAN_OPTIONS, threshold: 100 }), "CODE");
    expect(rootOnly.map(parseRow)).toEqual([{ depth: 0, cells: ["src/", "600", "100%", "4 files"] }]);
  });

  it("carries a structure trailer on a parsed file and a comment share when it is notable", () => {
    const parsed = [
      { path: "a.ts", tokens: 100, language: "typescript", functions: 4, branches: 7, commentLines: 30 },
      { path: "b.ts", tokens: 100, language: "typescript", functions: 1, branches: 0, commentLines: 10 },
    ];
    const trailers = sectionRows(buildReport(makeIndex(parsed), SCAN_OPTIONS), "CODE").map((row) => parseRow(row).cells.at(-1));
    expect(trailers).toEqual(["2 files", "70 loc, 30% comment, 4 fn, 7 br", "90 loc, 1 fn, 0 br"]);
  });
});

describe("report other sections", () => {
  const report = buildReport(makeIndex(TREE), SCAN_OPTIONS);

  it("walks tests against the test total, without trailers", () => {
    expect(sectionLine(report, "TESTS")).toBe("TESTS  100 tokens, 2 files");
    expect(sectionRows(report, "TESTS").map(parseRow)).toEqual([
      { depth: 0, cells: ["tests/", "100", "100%", "2 files"] },
      { depth: 1, cells: ["app.test.ts", "80", "80%"] },
      { depth: 1, cells: ["lib/", "20", "20%", "1 file"] },
      { depth: 2, cells: ["lib.test.ts", "20", "20%"] },
    ]);
  });

  it("names the heaviest files of the flavors it does not walk", () => {
    expect(sectionLine(report, "DOCS")).toBe("DOCS  80 tokens, 2 files: README.md 50, docs/guide.md 30");
    expect(sectionLine(report, "DATA & CONFIG")).toBe("DATA & CONFIG  40 tokens, 1 file: package.json 40");
    expect(sectionLine(report, "GENERATED")).toBe("GENERATED  300 tokens, 1 file, excluded above: package-lock.json 300");
  });

  it("omits a flavor the tree does not hold, but says when code or tests are absent", () => {
    expect(report).not.toContain("I18N");
    expect(report).not.toContain("OTHER");
    const docsOnly = buildReport(makeIndex([{ path: "README.md", tokens: 10, kind: "text" }]), SCAN_OPTIONS);
    expect(docsOnly).toContain("\nCODE  none\n");
    expect(docsOnly).toContain("\nTESTS  none\n");
    expect(docsOnly).not.toContain("Tests weigh");
  });

  it("reports in lines or loc when asked", () => {
    const loc = buildReport(makeIndex(TREE), { ...SCAN_OPTIONS, measure: "codeLines" });
    expect(loc).toContain("loc by flavor:");
    expect(sectionLine(loc, "CODE")).toBe("CODE  600 loc, 4 files, 0% comment");
    // The weight already is the loc, so the trailer does not repeat it.
    expect(sectionRows(loc, "CODE").map(parseRow)[2]).toEqual({ depth: 2, cells: ["main.ts", "400", "67%"] });
  });

  it("refuses an aspect other than after for a scan", () => {
    expect(() => buildReport(makeIndex(TREE), { ...SCAN_OPTIONS, aspect: "churn" })).toThrow(/after/);
  });

  it("refuses a threshold outside 0 to 100", () => {
    expect(() => buildReport(makeIndex(TREE), { ...SCAN_OPTIONS, threshold: 101 })).toThrow(/threshold/);
  });
});

const DIFF_META: DiffMeta = {
  spec: "main...HEAD",
  request: { kind: "mergeBase", base: "main", target: "HEAD" },
  base: "main",
  target: "HEAD",
  filesAdded: 1,
  filesModified: 1,
  filesDeleted: 1,
  filesRenamed: 1,
  cappedFiles: 0,
};

const CHANGE: readonly FileSpec[] = [
  { path: "src/a.ts", tokens: 500, status: "modified", added: 300, removed: 100 },
  { path: "src/b.ts", tokens: 200, status: "added", added: 200 },
  { path: "src/c.ts", tokens: 0, status: "deleted", removed: 150 },
  { path: "src/d.ts", tokens: 90, status: "renamed", added: 10, removed: 10, previousPath: "src/old.ts" },
];

describe("report of a comparison", () => {
  const churn = buildReport(makeIndex(CHANGE, DIFF_META), { measure: "tokens", aspect: "churn", threshold: 3 });

  it("heads with the comparison, the status counts, and churn beside net", () => {
    const [, compare, totals, split, sentences] = churn.split("\n");
    expect(compare).toBe("compare main...HEAD: 4 files, 1 added, 1 modified, 1 deleted, 1 renamed");
    expect(totals).toBe("churn 770 tokens (+510 -260), net +250, added is 0% comment");
    expect(split).toBe("churn tokens by flavor: code 770 100%");
    expect(sentences).toBe("Tests weigh 0% of code churn. A node is expanded at >= 3% of its section.");
  });

  it("walks the change by churn with a status letter and both sides on every row", () => {
    expect(sectionLine(churn, "CODE")).toBe("CODE  churn 770 tokens (+510 -260), net +250, 4 files, added is 0% comment");
    expect(sectionRows(churn, "CODE").map(parseRow)).toEqual([
      { depth: 0, cells: ["src/", "770", "100%", "4 files", "+510 -260"] },
      { depth: 1, cells: ["a.ts", "400", "52%", "M", "+300 -100"] },
      { depth: 1, cells: ["b.ts", "200", "26%", "A", "+200"] },
      { depth: 1, cells: ["c.ts", "150", "19%", "D", "-150"] },
      // 20 of 770 rounds to 3% but is below it, so the rename folds into the roll-up.
      { depth: 1, cells: ["... 1 file", "20", "3%", "+10 -10"] },
    ]);
    expect(sectionLine(churn, "TESTS")).toBe("TESTS  none");
  });

  it("signs every figure in net and draws its shares against churn", () => {
    const net = buildReport(makeIndex(CHANGE, DIFF_META), { measure: "tokens", aspect: "net", threshold: 0 });
    expect(net.split("\n")[3]).toBe("net tokens by flavor: code +250 32%");
    expect(sectionRows(net, "CODE").map(parseRow)).toEqual([
      { depth: 0, cells: ["src/", "+250", "32%", "4 files", "+510 -260"] },
      { depth: 1, cells: ["a.ts", "+200", "26%", "M", "+300 -100"] },
      { depth: 1, cells: ["b.ts", "+200", "26%", "A", "+200"] },
      { depth: 1, cells: ["c.ts", "-150", "19%", "D", "-150"] },
      { depth: 1, cells: ["d.ts", "0", "0%", "R", "+10 -10", "from src/old.ts"] },
    ]);
  });
});

describe("formatCompact", () => {
  it("keeps three or four significant characters", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1000)).toBe("1.0k");
    expect(formatCompact(4210)).toBe("4.2k");
    expect(formatCompact(9949)).toBe("9.9k");
    expect(formatCompact(9950)).toBe("10k");
    expect(formatCompact(61_678)).toBe("62k");
    expect(formatCompact(999_499)).toBe("999k");
    expect(formatCompact(1_234_567)).toBe("1.2M");
    expect(formatCompact(-500)).toBe("-500");
  });
});
