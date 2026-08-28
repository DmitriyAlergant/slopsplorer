import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FileRow, ScanMeta } from "../shared/api.ts";
import { assembleIndex, type FolderNode, type ScanIndex } from "../shared/index.ts";
import { classifyFile, findLocaleLevels, hasGeneratedHeader, isGenerated, refineKindByContent } from "./classify.ts";
import { measureFile } from "./measure.ts";
import { StructureAnalyzer } from "./structure.ts";
import { tokenCounter, type TokenizerName } from "./tokenize.ts";
import { listSourceFiles } from "./walk.ts";

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
export async function scanSourceTree(options: ScanOptions): Promise<ScanIndex> {
  const startedAt = Date.now();
  const { relativePaths, gitTracked, respectsGitignore } = await listSourceFiles(options.root, {
    allFiles: options.allFiles,
    exclude: options.exclude,
  });

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

      const name = path.posix.basename(relativePath);
      const { grammar, structure, lines: lineMetrics } = await measureFile(analyzer, name, text);
      const row: FileRow = {
        path: relativePath,
        name,
        kind: refineKindByContent(classifyFile(relativePath, localeLevels), relativePath, { grammar, ...structure }),
        generated: isGenerated(relativePath) || hasGeneratedHeader(text),
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
    fileSource: gitTracked ? "git-index" : respectsGitignore ? "walk-gitignore" : "walk-all",
    diff: null,
    skippedLargeFiles,
    languages,
  };

  return assembleIndex(meta, files, folders);
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
