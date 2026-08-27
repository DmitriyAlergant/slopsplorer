import type { Aspect, FileKind, Measure, RankMetric, TreeSort, ViewRequest } from "../shared/api.ts";
import { ASPECTS, FILE_KINDS, MEASURES, RANK_METRICS, TREE_SORTS } from "../shared/api.ts";

// v4 carries the diff aspect, which decides what a figure means as much as the
// measure does. Older payloads are discarded rather than half-read, which is
// what versioning the key is for: an optional field with a default would let a
// stored preference and a rendered heading disagree about the same number.
const STORAGE_KEY = "slopsplorer.view-preferences.v4";
const TREE_PANEL_STORAGE_KEY = "slopsplorer.tree-panel-ratio.v1";
const WORKSPACE_HEIGHT_STORAGE_KEY = "slopsplorer.workspace-height.v1";
const RANKING_HEIGHT_STORAGE_KEY = "slopsplorer.ranking-height.v1";

/**
 * Bounds on the two dragged heights.
 *
 * Read here and applied by the splitter that drags them, so a stored value and
 * a dragged one are held to one rule.
 */
export const MIN_WORKSPACE_HEIGHT = 260;
export const MAX_WORKSPACE_HEIGHT = 2000;
export const DEFAULT_WORKSPACE_HEIGHT = 660;
export const MIN_RANKING_HEIGHT = 160;
export const MAX_RANKING_HEIGHT = 2000;
export const DEFAULT_RANKING_HEIGHT = 480;

export interface ViewPreferences {
  kinds: FileKind[];
  showGenerated: boolean;
  treeSort: TreeSort;
  measure: Measure;
  /** Side of a change the measure describes. Only a diff can act on it. */
  aspect: Aspect;
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
 * Read one dragged height in pixels.
 *
 * Absolute rather than proportional, unlike the panel width: these boxes scroll
 * inside themselves, so a useful height is a number of rows rather than a share
 * of the window.
 */
function readHeight(
  storage: PreferenceStorage, key: string, minimum: number, maximum: number, fallback: number,
): number {
  try {
    const height = Number(storage.getItem(key));
    return Number.isFinite(height) && height >= minimum && height <= maximum ? height : fallback;
  } catch {
    return fallback;
  }
}

function writeHeight(storage: PreferenceStorage, key: string, height: number): void {
  try {
    storage.setItem(key, String(height));
  } catch {
    // Browsers may deny storage in private or locked-down contexts.
  }
}

/** Read the height the source tree and the folder panel stand at. */
export function readWorkspaceHeight(storage: PreferenceStorage, fallback: number): number {
  return readHeight(storage, WORKSPACE_HEIGHT_STORAGE_KEY, MIN_WORKSPACE_HEIGHT, MAX_WORKSPACE_HEIGHT, fallback);
}

/** Remember an operator's preferred workspace height across visits. */
export function writeWorkspaceHeight(storage: PreferenceStorage, height: number): void {
  writeHeight(storage, WORKSPACE_HEIGHT_STORAGE_KEY, height);
}

/** Read the height the ranked file list is capped at. */
export function readRankingHeight(storage: PreferenceStorage, fallback: number): number {
  return readHeight(storage, RANKING_HEIGHT_STORAGE_KEY, MIN_RANKING_HEIGHT, MAX_RANKING_HEIGHT, fallback);
}

/** Remember an operator's preferred ranking height across visits. */
export function writeRankingHeight(storage: PreferenceStorage, height: number): void {
  writeHeight(storage, RANKING_HEIGHT_STORAGE_KEY, height);
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
    const aspect = ASPECTS.find((candidate_) => candidate_ === candidate["aspect"]);
    if (aspect === undefined) return null;
    const rankMetric = RANK_METRICS.find((candidate_) => candidate_ === candidate["rankMetric"]);
    if (rankMetric === undefined) return null;
    return { kinds, showGenerated: candidate["showGenerated"], treeSort, measure, aspect, rankMetric };
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
    aspect: request.aspect,
    rankMetric: request.rank.metric,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Browsers may deny storage in private or locked-down contexts.
  }
}
