import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { openDiffAligner, type DiffScanOptions } from "../scanner/diffScan.ts";
import { GitObjectReader, type DiffSide } from "../scanner/gitdiff.ts";
import type { ReviewSideScanOptions, ScanIndex } from "../scanner/scan.ts";
import type { DiffLine, FileRow, SourceResponse } from "../shared/api.ts";

/** Enough producer state to read a file from every kind of index. */
export type SourceProducer =
  | { kind: "scan"; root: string }
  | { kind: "diff"; options: DiffScanOptions }
  | { kind: "review"; options: ReviewSideScanOptions };

export class SourceReadError extends Error {
  readonly statusCode: 403 | 404;

  constructor(message: string, statusCode: 403 | 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Ceiling on one source preview, so one generated bundle cannot stall the browser. */
export const MAX_SOURCE_BYTES = 512 * 1024;

function takeUpToByteCeiling(aligned: readonly DiffLine[]): { lines: DiffLine[]; totalBytes: number } {
  let totalBytes = 0;
  let kept = aligned.length;
  for (const [index, line] of aligned.entries()) {
    totalBytes += Buffer.byteLength(line.text) + 1;
    if (totalBytes > MAX_SOURCE_BYTES && index < kept) kept = index;
  }
  return { lines: aligned.slice(0, kept), totalBytes };
}

/** Reads files one index accepted, with the same safety rules in every consumer. */
export interface SourceReader {
  read(requestedPath: string): Promise<SourceResponse>;
  dispose(): void;
}

function rowOf(index: ScanIndex, requestedPath: string): FileRow {
  const fileIndex = index.fileIndexByPath.get(requestedPath);
  if (fileIndex === undefined) throw new SourceReadError("file is not part of the current scan", 404);
  return index.files[fileIndex]!;
}

function isFileSystemError(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && "code" in cause && typeof cause.code === "string";
}

async function readScanSource(root: string, requestedPath: string, row: FileRow): Promise<SourceResponse> {
  const realFilePath = await resolveInsideRoot(root, requestedPath);
  if (realFilePath === null) throw new SourceReadError("file is no longer readable", 404);

  let buffer: Buffer;
  try {
    buffer = await readFile(realFilePath);
  } catch (cause) {
    if (!isFileSystemError(cause)) throw cause;
    throw new SourceReadError("file is no longer readable", 404);
  }
  const truncated = buffer.byteLength > MAX_SOURCE_BYTES;
  const content = truncated
    ? new StringDecoder("utf8").write(buffer.subarray(0, MAX_SOURCE_BYTES))
    : buffer.toString("utf8");
  return {
    path: row.path,
    content,
    mode: "source",
    truncated,
    totalBytes: buffer.byteLength,
    language: row.language,
  };
}

function reviewSide(options: ReviewSideScanOptions): DiffSide {
  return options.side === "before" ? options.comparison.base : options.comparison.target;
}

function reviewObjectSpec(side: Exclude<DiffSide, { kind: "worktree" }>, requestedPath: string): string {
  return side.kind === "index" ? `:${requestedPath}` : `${side.rev}:${requestedPath}`;
}

function sourceFromBuffer(row: FileRow, buffer: Buffer): SourceResponse {
  const truncated = buffer.byteLength > MAX_SOURCE_BYTES;
  return {
    path: row.path,
    content: truncated
      ? new StringDecoder("utf8").write(buffer.subarray(0, MAX_SOURCE_BYTES))
      : buffer.toString("utf8"),
    mode: "source",
    truncated,
    totalBytes: buffer.byteLength,
    language: row.language,
  };
}

/** Resolve an existing file and enforce the scan-root boundary. */
async function resolveInsideRoot(root: string, requestedPath: string): Promise<string | null> {
  const scanRoot = path.resolve(root);
  try {
    const realFilePath = await realpath(path.resolve(scanRoot, requestedPath));
    const realScanRoot = await realpath(scanRoot);
    const relative = path.relative(realScanRoot, realFilePath);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new SourceReadError("file resolves outside the scan root", 403);
    }
    return realFilePath;
  } catch (cause) {
    if (cause instanceof SourceReadError) throw cause;
    return null;
  }
}

/**
 * Open one reader for these rows. The caller disposes it, and reads only rows
 * it was opened for.
 *
 * A comparison reads through one aligner opened for exactly these rows, so an
 * exporter's reads share one size batch and one object reader, and a single
 * interactive preview measures one file rather than the whole comparison.
 */
export async function openSourceReader(
  index: ScanIndex, producer: SourceProducer, rows: readonly FileRow[],
): Promise<SourceReader> {
  if (producer.kind === "scan") {
    const { root } = producer;
    return {
      read: (requestedPath) => readScanSource(root, requestedPath, rowOf(index, requestedPath)),
      dispose: () => {
        // A scan reads straight from disk and holds nothing to release.
      },
    };
  }

  if (producer.kind === "review") {
    const side = reviewSide(producer.options);
    if (side.kind === "worktree") {
      return {
        read: (requestedPath) => readScanSource(
          producer.options.root, requestedPath, rowOf(index, requestedPath),
        ),
        dispose: () => undefined,
      };
    }
    const reader = new GitObjectReader(producer.options.root);
    return {
      read: async (requestedPath) => {
        const row = rowOf(index, requestedPath);
        const buffer = await reader.read(reviewObjectSpec(side, requestedPath));
        if (buffer === null) throw new SourceReadError("file is no longer readable", 404);
        return sourceFromBuffer(row, buffer);
      },
      dispose: () => reader.dispose(),
    };
  }

  const aligner = await openDiffAligner(producer.options, rows);
  return {
    read: async (requestedPath) => {
      const row = rowOf(index, requestedPath);
      let worktreeFilePath: string | null | undefined;
      if (producer.options.comparison.target.kind === "worktree" && row.status !== "deleted") {
        worktreeFilePath = await resolveInsideRoot(producer.options.root, row.path);
      }
      let aligned: DiffLine[] | null;
      try {
        aligned = await aligner.align(row, worktreeFilePath);
      } catch (cause) {
        if (!isFileSystemError(cause)) throw cause;
        throw new SourceReadError("file is no longer readable", 404);
      }
      if (aligned === null) throw new SourceReadError("file is over the per-file size ceiling", 404);
      const kept = takeUpToByteCeiling(aligned);
      return {
        path: row.path,
        lines: kept.lines,
        mode: "diff",
        truncated: kept.lines.length < aligned.length,
        totalBytes: kept.totalBytes,
        language: row.language,
      };
    },
    dispose: () => aligner.dispose(),
  };
}

/** Read one file accepted by the index, opening and disposing a reader for that row alone. */
export async function readIndexedSource(
  index: ScanIndex, producer: SourceProducer, requestedPath: string,
): Promise<SourceResponse> {
  const reader = await openSourceReader(index, producer, [rowOf(index, requestedPath)]);
  try {
    return await reader.read(requestedPath);
  } finally {
    reader.dispose();
  }
}
