import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ChangeStatus, DiffLine, DiffMeta, FileRow, ScanMeta } from "../shared/api.ts";
import { classifyFile, findLocaleLevels, hasGeneratedHeader, isGenerated, refineKindByContent } from "./classify.ts";
import { GitObjectReader, listChangedFiles, objectSizes, type ChangedFile, type Comparison, type DiffSide } from "./gitdiff.ts";
import { alignedLines, diffLines } from "./linediff.ts";
import type { LineBucket } from "./lines.ts";
import { splitLines } from "./lines.ts";
import { measureFile, type FileMeasurement } from "./measure.ts";
import { buildFolders, buildWeightPrefixes, mapWithConcurrency, type ScanIndex, type ScanProgress } from "./scan.ts";
import { StructureAnalyzer } from "./structure.ts";
import { tokenCounter, type TokenizerName } from "./tokenize.ts";
import { acceptSourcePaths, listRevisionSourceFiles, listSourceFiles } from "./walk.ts";

export interface DiffScanOptions {
  /** Top of the worktree. It is also the scan root, so paths read the same as in a scan. */
  root: string;
  comparison: Comparison;
  tokenizer: TokenizerName;
  exclude: readonly string[];
  maxFileBytes: number;
  concurrency: number;
  onProgress?: (progress: ScanProgress) => void;
}

/**
 * Every source file the side a comparison ends at holds.
 *
 * Classification asks what a folder holds, and a comparison only sees the
 * files a change touched. Listing the after side in full is what lets a scan
 * and a comparison agree about the flavor of a file they both hold. The index
 * and the working tree are one checkout, so the walker answers for both.
 */
async function listTargetFiles(options: DiffScanOptions): Promise<string[]> {
  const target = options.comparison.target;
  if (target.kind === "revision") return listRevisionSourceFiles(options.root, target.rev, options.exclude);
  const listing = await listSourceFiles(options.root, { allFiles: false, exclude: options.exclude });
  return listing.relativePaths;
}

/** Empty content, which is what the missing side of an added or deleted file holds. */
const NOTHING = "";

/**
 * How one side names a path as a Git object, or `null` for the working tree.
 *
 * The index is spelled `:path`, which is the same stage-zero entry `git diff
 * --cached` compares against.
 */
function objectSpec(side: DiffSide, filePath: string): string | null {
  if (side.kind === "worktree") return null;
  return side.kind === "index" ? `:${filePath}` : `${side.rev}:${filePath}`;
}

/**
 * Put both sides on one line-ending convention.
 *
 * A blob is stored exactly as Git holds it while a working-tree file may have
 * been written back with CRLF, and without this every line of such a file
 * would read as changed.
 */
function normalizeLineEndings(text: string): string {
  return text.includes("\r") ? text.replace(/\r\n/g, "\n") : text;
}

/** Sum one side's own line verdicts over the lines the comparison touched. */
function bucketTotals(buckets: readonly LineBucket[], indices: readonly number[]): {
  lines: number; codeLines: number; commentLines: number;
} {
  let codeLines = 0;
  let commentLines = 0;
  for (const index of indices) {
    const bucket = buckets[index];
    if (bucket === "code") codeLines += 1;
    else if (bucket === "comment") commentLines += 1;
  }
  return { lines: codeLines + commentLines, codeLines, commentLines };
}

/** One file's two contents, already fetched and within the size ceiling. */
interface FileContents {
  before: string;
  after: string;
}

/** The object names a comparison reads one file's two sides from. */
function sideSpecs(comparison: Comparison, entry: ChangedFile): { before: string | null; after: string | null } {
  return {
    before: entry.status === "added" ? null : objectSpec(comparison.base, entry.basePath),
    after: entry.status === "deleted" ? null : objectSpec(comparison.target, entry.path),
  };
}

/**
 * Fetch both sides of one file, or `null` when either is over the ceiling.
 *
 * `sizes` is asked first so a blob too large to measure is never pulled
 * through the pipe. A working-tree side has no blob and is read from disk, as
 * a scan reads it.
 */
async function readSides(
  options: DiffScanOptions, reader: GitObjectReader, sizes: ReadonlyMap<string, number | null>, entry: ChangedFile,
): Promise<FileContents | null> {
  const read = async (side: DiffSide, filePath: string, exists: boolean): Promise<string | null> => {
    if (!exists) return NOTHING;
    const spec = objectSpec(side, filePath);
    if (spec === null) {
      const info = await stat(path.join(options.root, filePath)).catch(() => null);
      // A working-tree file the diff named but the filesystem no longer holds
      // is an empty after-image, which is what deleting it in between means.
      if (info === null || !info.isFile()) return NOTHING;
      if (info.size > options.maxFileBytes) return null;
      return readFile(path.join(options.root, filePath), "utf8");
    }
    const size = sizes.get(spec);
    if (size === undefined || size === null) return NOTHING;
    if (size > options.maxFileBytes) return null;
    const blob = await reader.read(spec);
    return blob === null ? NOTHING : blob.toString("utf8");
  };

  const before = await read(options.comparison.base, entry.basePath, entry.status !== "added");
  if (before === null) return null;
  const after = await read(options.comparison.target, entry.path, entry.status !== "deleted");
  if (after === null) return null;
  return { before: normalizeLineEndings(before), after: normalizeLineEndings(after) };
}

/**
 * One file's change, line by line, aligned by the same aligner its figures
 * came from rather than by a second `git diff`.
 *
 * One producer means the preview and the numbers beside it can never describe
 * different changes, and it reaches a file Git does not track yet.
 */
export async function diffOneFile(options: DiffScanOptions, row: FileRow): Promise<DiffLine[]> {
  const entry: ChangedFile = {
    path: row.path,
    basePath: row.previousPath ?? row.path,
    status: row.status === "unchanged" ? "modified" : row.status,
  };
  const specs = sideSpecs(options.comparison, entry);
  const wanted = [specs.before, specs.after].filter((spec): spec is string => spec !== null);
  const measured = await objectSizes(options.root, wanted);
  const sizes = new Map(wanted.map((spec, position) => [spec, measured[position] ?? null]));

  const reader = new GitObjectReader(options.root);
  try {
    const contents = await readSides(options, reader, sizes, entry);
    if (contents === null) throw new Error(`file is over the per-file size ceiling: ${row.path}`);
    const before = splitLines(contents.before);
    const after = splitLines(contents.after);
    return alignedLines(before, after, diffLines(before, after));
  } finally {
    reader.dispose();
  }
}

/**
 * Measure a comparison and build the same queryable index a scan builds.
 *
 * The map does not change: a folder holding most of a diff reads exactly as a
 * folder holding most of a tree, which is why this is a second producer of
 * `ScanIndex` rather than a second program.
 */
export async function scanDiff(options: DiffScanOptions): Promise<ScanIndex> {
  const startedAt = Date.now();
  const { comparison } = options;
  const changed = await listChangedFiles(options.root, comparison);
  const byPath = new Map(changed.map((entry) => [entry.path, entry]));
  const localeLevels = findLocaleLevels(await listTargetFiles(options));
  const accepted = acceptSourcePaths(changed.map((entry) => entry.path), options.exclude)
    .map((filePath) => byPath.get(filePath)!);

  const sizeSpecs: string[] = [];
  for (const entry of accepted) {
    const specs = sideSpecs(comparison, entry);
    if (specs.before !== null) sizeSpecs.push(specs.before);
    if (specs.after !== null) sizeSpecs.push(specs.after);
  }
  const sizes = new Map<string, number | null>();
  const measuredSizes = await objectSizes(options.root, sizeSpecs);
  for (const [position, spec] of sizeSpecs.entries()) sizes.set(spec, measuredSizes[position] ?? null);

  const reader = new GitObjectReader(options.root);
  const countTokens = tokenCounter(options.tokenizer);
  const analyzer = new StructureAnalyzer();
  let skippedLargeFiles = 0;
  let cappedFiles = 0;
  let completedFiles = 0;
  options.onProgress?.({ completedFiles, totalFiles: accepted.length });

  let measured: (FileRow | null)[];
  let languages: string[];
  try {
    measured = await mapWithConcurrency(accepted, options.concurrency, async (entry: ChangedFile) => {
      const contents = await readSides(options, reader, sizes, entry);
      if (contents === null) {
        skippedLargeFiles += 1;
        return null;
      }

      const name = path.posix.basename(entry.path);
      const baseName = path.posix.basename(entry.basePath);
      const before: FileMeasurement = await measureFile(analyzer, baseName, contents.before);
      const after: FileMeasurement = await measureFile(analyzer, name, contents.after);
      const alignment = diffLines(before.lineTexts, after.lineTexts);
      if (alignment.capped) cappedFiles += 1;

      const addedTotals = bucketTotals(after.buckets, alignment.added);
      const removedTotals = bucketTotals(before.buckets, alignment.removed);
      const addedTokens = countTokens(alignment.added.map((index) => after.lineTexts[index]!).join("\n"));
      const removedTokens = countTokens(alignment.removed.map((index) => before.lineTexts[index]!).join("\n"));
      const grammar = after.grammar ?? before.grammar;

      const row: FileRow = {
        path: entry.path,
        name,
        kind: refineKindByContent(classifyFile(entry.path, localeLevels), entry.path, { grammar, ...after.structure }),
        // The after image, or the before image of a file the change deleted.
        generated: isGenerated(entry.path) || hasGeneratedHeader(contents.after || contents.before),
        status: entry.status,
        previousPath: entry.status === "renamed" ? entry.basePath : null,
        tokens: countTokens(contents.after),
        lines: after.lines.lines,
        codeLines: after.lines.codeLines,
        commentLines: after.lines.commentLines,
        blankLines: after.lines.blankLines,
        addedTokens,
        removedTokens,
        churnTokens: addedTokens + removedTokens,
        netTokens: addedTokens - removedTokens,
        addedLines: addedTotals.lines,
        removedLines: removedTotals.lines,
        churnLines: addedTotals.lines + removedTotals.lines,
        netLines: addedTotals.lines - removedTotals.lines,
        addedCodeLines: addedTotals.codeLines,
        removedCodeLines: removedTotals.codeLines,
        churnCodeLines: addedTotals.codeLines + removedTotals.codeLines,
        netCodeLines: addedTotals.codeLines - removedTotals.codeLines,
        addedCommentLines: addedTotals.commentLines,
        removedCommentLines: removedTotals.commentLines,
        addedPhysicalLines: alignment.added.length,
        removedPhysicalLines: alignment.removed.length,
        functions: after.structure.functions,
        classes: after.structure.classes,
        branches: after.structure.branches,
        beforeFunctions: before.structure.functions,
        beforeClasses: before.structure.classes,
        beforeBranches: before.structure.branches,
        language: grammar,
      };
      return row;
    }, () => {
      completedFiles += 1;
      options.onProgress?.({ completedFiles, totalFiles: accepted.length });
    });
    languages = analyzer.usedGrammars;
  } finally {
    analyzer.dispose();
    reader.dispose();
  }

  const files = measured.filter((row): row is FileRow => row !== null);
  const rootName = path.basename(path.resolve(options.root)) || options.root;
  const folders = buildFolders(files, rootName);
  const countOf = (status: ChangeStatus): number => files.filter((file) => file.status === status).length;

  const diff: DiffMeta = {
    spec: comparison.spec,
    request: comparison.request,
    base: comparison.baseLabel,
    target: comparison.targetLabel,
    filesAdded: countOf("added"),
    filesModified: countOf("modified"),
    filesDeleted: countOf("deleted"),
    filesRenamed: countOf("renamed"),
    cappedFiles,
  };

  const meta: ScanMeta = {
    rootPath: options.root,
    rootName,
    tokenizer: options.tokenizer,
    fileCount: files.length,
    folderCount: folders.length,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    fileSource: "git-diff",
    diff,
    skippedLargeFiles,
    languages,
  };

  return {
    meta,
    files,
    weightPrefix: buildWeightPrefixes(files),
    folders,
    folderByPath: new Map(folders.map((folder) => [folder.path, folder])),
    fileIndexByPath: new Map(files.map((file, index) => [file.path, index])),
  };
}
