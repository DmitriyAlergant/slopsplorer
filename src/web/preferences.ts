import type { FileKind, Measure, RankMetric, TreeSort, ViewRequest } from "../shared/api.ts";
import { FILE_KINDS, MEASURES, RANK_METRICS, TREE_SORTS } from "../shared/api.ts";

// v3 carries the sorted file-table column, which is now how the measure itself
// is chosen. Older payloads are discarded rather than half-read: v2 names no
// column, and v1 names a tree sort this build no longer knows.
const STORAGE_KEY = "slopsplorer.view-preferences.v3";
const TREE_PANEL_STORAGE_KEY = "slopsplorer.tree-panel-ratio.v1";
const WORKSPACE_HEIGHT_STORAGE_KEY = "slopsplorer.workspace-height.v1";

/**
 * Bounds on how tall the two workspace panels may stand.
 *
 * Read here and applied by the splitter that drags them, so a stored value and
 * a dragged one are held to one rule.
 */
export const MIN_WORKSPACE_HEIGHT = 260;
export const MAX_WORKSPACE_HEIGHT = 2000;
export const DEFAULT_WORKSPACE_HEIGHT = 660;

export interface ViewPreferences {
  kinds: FileKind[];
  showGenerated: boolean;
  treeSort: TreeSort;
  measure: Measure;
  /** Sorted column of both file tables, and the ranking's order. */
  rankMetric: RankMetric;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read a proportional panel width so it adapts when the browser is resized. */
export function readTreePanelRatio(storage: PreferenceStorage, fallback: number): number {
  try {
    const ratio = Number(storage.getItem(TREE_PANEL_STORAGE_KEY));
    return Number.isFinite(ratio) && ratio >= 0.1 && ratio <= 0.8 ? ratio : fallback;
  } catch {
    return fallback;
  }
}

/** Remember an operator's preferred source-tree width across visits. */
export function writeTreePanelRatio(storage: PreferenceStorage, ratio: number): void {
  try {
    storage.setItem(TREE_PANEL_STORAGE_KEY, String(ratio));
  } catch {
    // Browsers may deny storage in private or locked-down contexts.
  }
}

/**
 * Read the workspace height in pixels.
 *
 * Absolute rather than proportional, unlike the panel width: the panels scroll
 * inside themselves, so a useful height is a number of rows rather than a share
 * of the window.
 */
export function readWorkspaceHeight(storage: PreferenceStorage, fallback: number): number {
  try {
    const height = Number(storage.getItem(WORKSPACE_HEIGHT_STORAGE_KEY));
    return Number.isFinite(height) && height >= MIN_WORKSPACE_HEIGHT && height <= MAX_WORKSPACE_HEIGHT
      ? height
      : fallback;
  } catch {
    return fallback;
  }
}

/** Remember an operator's preferred workspace height across visits. */
export function writeWorkspaceHeight(storage: PreferenceStorage, height: number): void {
  try {
    storage.setItem(WORKSPACE_HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // Browsers may deny storage in private or locked-down contexts.
  }
}

/** Read validated display preferences without trusting arbitrary stored JSON. */
export function readPreferences(storage: PreferenceStorage): ViewPreferences | null {
  try {
    const encoded = storage.getItem(STORAGE_KEY);
    if (encoded === null) return null;
    const raw = JSON.parse(encoded) as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    const candidate = raw as Record<string, unknown>;
    if (!Array.isArray(candidate["kinds"]) || typeof candidate["showGenerated"] !== "boolean") return null;
    const storedKinds = candidate["kinds"].filter((kind): kind is string => typeof kind === "string");
    const kinds = FILE_KINDS.filter((kind) => storedKinds.includes(kind));
    const treeSort = TREE_SORTS.find((sort) => sort === candidate["treeSort"]);
    if (treeSort === undefined) return null;
    const measure = MEASURES.find((candidate_) => candidate_ === candidate["measure"]);
    if (measure === undefined) return null;
    const rankMetric = RANK_METRICS.find((candidate_) => candidate_ === candidate["rankMetric"]);
    if (rankMetric === undefined) return null;
    return { kinds, showGenerated: candidate["showGenerated"], treeSort, measure, rankMetric };
  } catch {
    return null;
  }
}

/** Store only durable display choices, leaving navigation and filters linkable. */
export function writePreferences(storage: PreferenceStorage, request: ViewRequest): void {
  const preferences: ViewPreferences = {
    kinds: FILE_KINDS.filter((kind) => request.kinds.includes(kind)),
    showGenerated: request.showGenerated,
    treeSort: request.treeSort,
    measure: request.measure,
    rankMetric: request.rank.metric,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Browsers may deny storage in private or locked-down contexts.
  }
}
