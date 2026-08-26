import type { FileKind, Measure, TreeSort, ViewRequest } from "../shared/api.ts";
import { FILE_KINDS, MEASURES, TREE_SORTS } from "../shared/api.ts";

// v2 carries the primary measure. A v1 payload names a tree sort this build no
// longer knows, so it is discarded rather than half-read.
const STORAGE_KEY = "slopsplorer.view-preferences.v2";
const TREE_PANEL_STORAGE_KEY = "slopsplorer.tree-panel-ratio.v1";

export interface ViewPreferences {
  kinds: FileKind[];
  showGenerated: boolean;
  treeSort: TreeSort;
  measure: Measure;
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
    return { kinds, showGenerated: candidate["showGenerated"], treeSort, measure };
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
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Browsers may deny storage in private or locked-down contexts.
  }
}
