import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FileRow, FileSource, ReviewMeta, ScanMeta } from "../shared/api.ts";
import { assembleIndex, type FolderNode, type ScanIndex } from "../shared/index.ts";
import { classifyFile, findLocaleLevels, hasGeneratedContent, isGenerated, refineKindByContent } from "./classify.ts";
import { GitObjectReader, objectSizes, type Comparison, type DiffSide } from "./gitdiff.ts";
import { measureFile } from "./measure.ts";
import { StructureAnalyzer } from "./structure.ts";
import { tokenCounter, type TokenizerName } from "./tokenize.ts";
import { acceptSourcePaths, listIndexFiles, listRevisionFiles, listSourceFiles } from "./walk.ts";

export { assembleIndex, type FolderNode, type ScanIndex } from "../shared/index.ts";

export interface ScanProgress {
  completedFiles: number;
  totalFiles: number;
}

export interface ScanOptions {
  root: string;
  tokenizer: TokenizerName;
  allFiles: boolean;
  exclude: readonly string[];
  maxFileBytes: number;
  /** Files read concurrently. Reading is IO-bound. Measuring is not. */
  concurrency: number;
  /** Called as file measurement advances. */
  onProgress?: (progress: ScanProgress) => void;
}

export interface ReviewSideScanOptions {
  root: string;
  comparison: Comparison;
  side: "before" | "after";
  tokenizer: TokenizerName;
  exclude: readonly string[];
  maxFileBytes: number;
  concurrency: number;
  onProgress?: (progress: ScanProgress) => void;
}

export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * The change-related half of a row that no comparison touched.
 *
 * A scan is the degenerate diff, so its rows carry the same fields with the
 * only values that are true of an unchanged file. Spelled out rather than
 * generated, so a search for `netCodeLines` finds this too.
 */
export const UNCHANGED_FILE_FIELDS = {
  status: "unchanged",
  previousPath: null,
  addedTokens: 0, removedTokens: 0, churnTokens: 0, netTokens: 0,
  addedLines: 0, removedLines: 0, churnLines: 0, netLines: 0,
  addedCodeLines: 0, removedCodeLines: 0, churnCodeLines: 0, netCodeLines: 0,
  addedCommentLines: 0, removedCommentLines: 0,
  addedPhysicalLines: 0, removedPhysicalLines: 0,
  beforeFunctions: 0, beforeClasses: 0, beforeBranches: 0,
} as const satisfies Partial<FileRow>;

/** The folder holding this path, where `""` is the scan root. */
function parentFolderOf(posixPath: string): string {
  const parent = path.posix.dirname(posixPath);
  return parent === "." ? "" : parent;
}

/** First index whose value is >= `target`. */
function lowerBound(values: readonly string[], target: string): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export async function mapWithConcurrency<In, Out>(
  items: readonly In[],
  limit: number,
  worker: (item: In, index: number) => Promise<Out>,
  onItemCompleted?: () => void,
): Promise<Out[]> {
  const results = new Array<Out>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]!, index);
      } finally {
        onItemCompleted?.();
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/** Measure every accepted file under `root` and build the queryable index. */
interface ScanFileRead {
  text: string | null;
  oversized: boolean;
}

interface ListedScan {
  relativePaths: string[];
  fileSource: FileSource;
  review: ReviewMeta | null;
  read(relativePath: string): Promise<ScanFileRead>;
  dispose(): void;
}

/** Measure a complete source-file listing, independent of where its bytes live. */
async function measureListedScan(options: ScanOptions, listing: ListedScan): Promise<ScanIndex> {
  const startedAt = Date.now();
  const { relativePaths } = listing;

  const localeLevels = findLocaleLevels(relativePaths);
  const countTokens = tokenCounter(options.tokenizer);
  const analyzer = new StructureAnalyzer();
  let skippedLargeFiles = 0;
  let completedFiles = 0;
  options.onProgress?.({ completedFiles, totalFiles: relativePaths.length });

  let measured: (FileRow | null)[];
  let languages: string[];
  try {
    measured = await mapWithConcurrency(relativePaths, options.concurrency, async (relativePath) => {
      const loaded = await listing.read(relativePath);
      if (loaded.oversized) skippedLargeFiles += 1;
      if (loaded.text === null) return null;
      const text = loaded.text;

      const name = path.posix.basename(relativePath);
      const { grammar, structure, lines: lineMetrics } = await measureFile(analyzer, name, text);
      const row: FileRow = {
        path: relativePath,
        name,
        kind: refineKindByContent(classifyFile(relativePath, localeLevels), relativePath, { grammar, ...structure }),
        generated: isGenerated(relativePath) || hasGeneratedContent(relativePath, text),
        ...UNCHANGED_FILE_FIELDS,
        tokens: countTokens(text),
        lines: lineMetrics.lines,
        codeLines: lineMetrics.codeLines,
        commentLines: lineMetrics.commentLines,
        blankLines: lineMetrics.blankLines,
        functions: structure.functions,
        classes: structure.classes,
        branches: structure.branches,
        language: grammar,
      };
      return row;
    }, () => {
      completedFiles += 1;
      options.onProgress?.({ completedFiles, totalFiles: relativePaths.length });
    });
    languages = analyzer.usedGrammars;
  } finally {
    analyzer.dispose();
    listing.dispose();
  }

  const files = measured.filter((row): row is FileRow => row !== null);

  const rootName = path.basename(path.resolve(options.root)) || options.root;
  const folders = buildFolders(files, rootName);

  const meta: ScanMeta = {
    rootPath: options.root,
    rootName,
    tokenizer: options.tokenizer,
    fileCount: files.length,
    folderCount: folders.length,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    fileSource: listing.fileSource,
    diff: null,
    review: listing.review,
    skippedLargeFiles,
    languages,
  };

  return assembleIndex(meta, files, folders);
}

/** Measure every accepted file under `root` and build the queryable index. */
export async function scanSourceTree(options: ScanOptions): Promise<ScanIndex> {
  const files = await listSourceFiles(options.root, {
    allFiles: options.allFiles,
    exclude: options.exclude,
  });
  return measureListedScan(options, {
    relativePaths: files.relativePaths,
    fileSource: files.gitTracked ? "git-index" : files.respectsGitignore ? "walk-gitignore" : "walk-all",
    review: null,
    read: async (relativePath) => {
      try {
        const absolutePath = path.join(options.root, relativePath);
        const info = await stat(absolutePath);
        if (!info.isFile()) return { text: null, oversized: false };
        if (info.size > options.maxFileBytes) return { text: null, oversized: true };
        return { text: await readFile(absolutePath, "utf8"), oversized: false };
      } catch {
        // The file disappeared or is unreadable between listing and measuring.
        return { text: null, oversized: false };
      }
    },
    dispose: () => undefined,
  });
}

function reviewMeta(options: ReviewSideScanOptions): ReviewMeta {
  return {
    mode: options.side,
    spec: options.comparison.spec,
    request: options.comparison.request,
    base: options.comparison.baseLabel,
    target: options.comparison.targetLabel,
  };
}

function sideOf(options: ReviewSideScanOptions): DiffSide {
  return options.side === "before" ? options.comparison.base : options.comparison.target;
}

function sideObjectSpec(side: DiffSide, relativePath: string): string | null {
  if (side.kind === "worktree") return null;
  return side.kind === "index" ? `:${relativePath}` : `${side.rev}:${relativePath}`;
}

/** Measure one complete side of a comparison without changing the worktree. */
export async function scanReviewSide(options: ReviewSideScanOptions): Promise<ScanIndex> {
  const side = sideOf(options);
  if (side.kind === "worktree") {
    const scanned = await scanSourceTree({ ...options, allFiles: false });
    return assembleIndex({ ...scanned.meta, review: reviewMeta(options) }, scanned.files, scanned.folders);
  }

  const inventory = side.kind === "index"
    ? await listIndexFiles(options.root)
    : await listRevisionFiles(options.root, side.rev);
  const relativePaths = acceptSourcePaths(inventory, options.exclude, inventory);
  const specs = relativePaths.map((relativePath) => sideObjectSpec(side, relativePath)!);
  const sizes = await objectSizes(options.root, specs);
  const sizeByPath = new Map(relativePaths.map((relativePath, index) => [relativePath, sizes[index] ?? null]));
  const reader = new GitObjectReader(options.root);
  return measureListedScan({ ...options, allFiles: false }, {
    relativePaths,
    fileSource: side.kind === "index" ? "git-index" : "git-tree",
    review: reviewMeta(options),
    read: async (relativePath) => {
      const size = sizeByPath.get(relativePath);
      if (size === undefined || size === null) return { text: null, oversized: false };
      if (size > options.maxFileBytes) return { text: null, oversized: true };
      const buffer = await reader.read(sideObjectSpec(side, relativePath)!);
      return { text: buffer?.toString("utf8") ?? null, oversized: false };
    },
    dispose: () => reader.dispose(),
  });
}

/** Derive the folder hierarchy, including folders that only contain other folders. */
export function buildFolders(files: readonly FileRow[], rootName: string): FolderNode[] {
  const folderPaths = new Set<string>([""]);
  for (const file of files) {
    let parent = path.posix.dirname(file.path);
    while (parent && parent !== ".") {
      folderPaths.add(parent);
      parent = path.posix.dirname(parent);
    }
  }

  const sortedPaths = [...folderPaths].sort();
  const filePaths = files.map((file) => file.path);
  const directIndices = new Map<string, number[]>();
  for (const [index, file] of files.entries()) {
    const key = parentFolderOf(file.path);
    const bucket = directIndices.get(key);
    if (bucket) bucket.push(index);
    else directIndices.set(key, [index]);
  }

  const childPaths = new Map<string, string[]>();
  for (const folderPath of sortedPaths) {
    if (!folderPath) continue;
    const key = parentFolderOf(folderPath);
    const bucket = childPaths.get(key);
    if (bucket) bucket.push(folderPath);
    else childPaths.set(key, [folderPath]);
  }

  return sortedPaths.map((folderPath) => {
    // All descendants share the `folderPath + "/"` prefix, and every such
    // string sorts below the same prefix with its trailing slash bumped to "0".
    const prefix = folderPath ? `${folderPath}/` : "";
    const start = folderPath ? lowerBound(filePaths, prefix) : 0;
    const end = folderPath ? lowerBound(filePaths, `${folderPath}0`) : filePaths.length;
    return {
      path: folderPath,
      name: folderPath ? path.posix.basename(folderPath) : rootName,
      parentPath: folderPath ? parentFolderOf(folderPath) : null,
      childPaths: childPaths.get(folderPath) ?? [],
      directFileIndices: directIndices.get(folderPath) ?? [],
      depth: folderPath ? folderPath.split("/").length : 0,
      start,
      end,
    } satisfies FolderNode;
  });
}
