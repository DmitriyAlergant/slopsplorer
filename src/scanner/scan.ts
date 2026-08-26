import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FileRow, ScanMeta } from "../shared/api.ts";
import { classifyFile, isGenerated } from "./classify.ts";
import { measureLines, measureLinesByPrefix } from "./lines.ts";
import { grammarForExtension, StructureAnalyzer } from "./structure.ts";
import { tokenCounter, type TokenizerName } from "./tokenize.ts";
import { listSourceFiles } from "./walk.ts";

/**
 * One folder in the scanned tree.
 *
 * `start`/`end` bound this folder's descendants inside the path-sorted `files`
 * array. Sorting makes every subtree contiguous, so aggregating a folder is a
 * range walk rather than a scan of every file in the project.
 */
export interface FolderNode {
  path: string;
  name: string;
  parentPath: string | null;
  childPaths: string[];
  directFileIndices: number[];
  depth: number;
  start: number;
  end: number;
}

export interface ScanIndex {
  meta: ScanMeta;
  /** Sorted by path. */
  files: FileRow[];
  /**
   * Running token totals over `files`, where `tokenPrefix[n]` is the sum of the
   * first `n` files. Because a folder's descendants are contiguous, its total
   * unfiltered weight is one subtraction, independent of any active filter.
   */
  tokenPrefix: Float64Array;
  /** Sorted by path, so a parent always precedes its children. */
  folders: FolderNode[];
  folderByPath: Map<string, FolderNode>;
  fileIndexByPath: Map<string, number>;
}

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

export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

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

async function mapWithConcurrency<In, Out>(
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
export async function scanSourceTree(options: ScanOptions): Promise<ScanIndex> {
  const startedAt = Date.now();
  const { relativePaths, gitTracked, respectsGitignore } = await listSourceFiles(options.root, {
    allFiles: options.allFiles,
    exclude: options.exclude,
  });

  const countTokens = tokenCounter(options.tokenizer);
  const analyzer = new StructureAnalyzer();
  let skippedLargeFiles = 0;
  let completedFiles = 0;
  options.onProgress?.({ completedFiles, totalFiles: relativePaths.length });

  let measured: (FileRow | null)[];
  let languages: string[];
  try {
    measured = await mapWithConcurrency(relativePaths, options.concurrency, async (relativePath) => {
      const absolutePath = path.join(options.root, relativePath);
      let text: string;
      try {
        const info = await stat(absolutePath);
        if (!info.isFile()) return null;
        if (info.size > options.maxFileBytes) {
          skippedLargeFiles += 1;
          return null;
        }
        text = await readFile(absolutePath, "utf8");
      } catch {
        // The file disappeared or is unreadable between listing and measuring.
        return null;
      }

      const extension = path.posix.extname(relativePath).toLowerCase();
      const grammar = grammarForExtension(extension);
      const structure = await analyzer.analyze(extension, text);
      // A grammar gives exact comment spans. Anything else uses leading-marker
      // detection, which reports zero for formats with no comment syntax
      // rather than guessing.
      const lineMetrics = grammar
        ? measureLines(text, structure.commentRanges)
        : measureLinesByPrefix(text, extension);
      const row: FileRow = {
        path: relativePath,
        name: path.posix.basename(relativePath),
        kind: classifyFile(relativePath),
        generated: isGenerated(relativePath),
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
  }

  const files = measured.filter((row): row is FileRow => row !== null);

  const folders = buildFolders(files, path.basename(path.resolve(options.root)) || options.root);

  const meta: ScanMeta = {
    rootPath: options.root,
    rootName: path.basename(path.resolve(options.root)) || options.root,
    tokenizer: options.tokenizer,
    fileCount: files.length,
    folderCount: folders.length,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    gitTracked,
    respectsGitignore,
    skippedLargeFiles,
    languages,
  };

  const tokenPrefix = new Float64Array(files.length + 1);
  for (const [position, file] of files.entries()) {
    tokenPrefix[position + 1] = tokenPrefix[position]! + file.tokens;
  }

  return {
    meta,
    files,
    tokenPrefix,
    folders,
    folderByPath: new Map(folders.map((folder) => [folder.path, folder])),
    fileIndexByPath: new Map(files.map((file, index) => [file.path, index])),
  };
}

/** Derive the folder hierarchy, including folders that only contain other folders. */
function buildFolders(files: readonly FileRow[], rootName: string): FolderNode[] {
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
    const parent = path.posix.dirname(file.path);
    const key = parent === "." ? "" : parent;
    const bucket = directIndices.get(key);
    if (bucket) bucket.push(index);
    else directIndices.set(key, [index]);
  }

  const childPaths = new Map<string, string[]>();
  for (const folderPath of sortedPaths) {
    if (!folderPath) continue;
    const parent = path.posix.dirname(folderPath);
    const key = parent === "." ? "" : parent;
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
      parentPath: folderPath ? (path.posix.dirname(folderPath) === "." ? "" : path.posix.dirname(folderPath)) : null,
      childPaths: childPaths.get(folderPath) ?? [],
      directFileIndices: directIndices.get(folderPath) ?? [],
      depth: folderPath ? folderPath.split("/").length : 0,
      start,
      end,
    } satisfies FolderNode;
  });
}
