import type { FileRow, ScanMeta, WeightField } from "./api.ts";
import { WEIGHT_FIELD_NAMES } from "./api.ts";

/**
 * One folder in the path-sorted file index.
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

/** The queryable form both the live server and a static worker aggregate. */
export interface ScanIndex {
  meta: ScanMeta;
  /** Sorted by path. */
  files: FileRow[];
  weightPrefix: Record<WeightField, Float64Array>;
  /** Sorted by path, so a parent always precedes its children. */
  folders: FolderNode[];
  folderByPath: Map<string, FolderNode>;
  fileIndexByPath: Map<string, number>;
}

/** JSON form written beside a static explorer. */
export interface SerializedScanIndex {
  meta: ScanMeta;
  files: FileRow[];
  folders: FolderNode[];
}

/**
 * Build every derived lookup from the parts a producer measured.
 *
 * A tree and a comparison differ in how they arrive at `files`, and in nothing
 * after that, so every derived lookup is built in one place and neither
 * producer can grow a table the other one lacks.
 */
export function assembleIndex(meta: ScanMeta, files: FileRow[], folders: FolderNode[]): ScanIndex {
  return {
    meta,
    files,
    weightPrefix: buildWeightPrefixes(files),
    folders,
    folderByPath: new Map(folders.map((folder) => [folder.path, folder])),
    fileIndexByPath: new Map(files.map((file, index) => [file.path, index])),
  };
}

/** Strip derived tables before JSON serialization and replace the local root path. */
export function serializeScanIndex(index: ScanIndex, rootPath: string): SerializedScanIndex {
  return {
    meta: { ...index.meta, rootPath },
    files: index.files,
    folders: index.folders,
  };
}

/** Restore the exact index shape the scanner gives the live server. */
export function hydrateScanIndex(serialized: SerializedScanIndex): ScanIndex {
  return assembleIndex(serialized.meta, serialized.files, serialized.folders);
}

/** One running-total array per weight field, so any field costs the same to query. */
function buildWeightPrefixes(files: readonly FileRow[]): Record<WeightField, Float64Array> {
  const prefixes = {} as Record<WeightField, Float64Array>;
  for (const field of WEIGHT_FIELD_NAMES) {
    const running = new Float64Array(files.length + 1);
    for (const [position, file] of files.entries()) {
      running[position + 1] = running[position]! + file[field];
    }
    prefixes[field] = running;
  }
  return prefixes;
}
