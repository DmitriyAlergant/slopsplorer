import type { FileKind, TreeSort, ViewRequest } from "../shared/api.ts";
import { FILE_KINDS, TREE_SORTS } from "../shared/api.ts";

const STORAGE_KEY = "slopsplorer.view-preferences.v1";

export interface ViewPreferences {
  kinds: FileKind[];
  showGenerated: boolean;
  treeSort: TreeSort;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
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
    return { kinds, showGenerated: candidate["showGenerated"], treeSort };
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
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Browsers may deny storage in private or locked-down contexts.
  }
}
