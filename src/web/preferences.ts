import type { Aspect, Measure, OpenInApplication, RankMetric, TreeSort, ViewRequest } from "../shared/api.ts";
import { ASPECTS, MEASURES, OPEN_IN_APPLICATIONS, RANK_METRICS, TREE_SORTS } from "../shared/api.ts";

// v4 carries the diff aspect, which decides what a figure means as much as the
// measure does. Older payloads are discarded rather than half-read, which is
// what versioning the key is for: an optional field with a default would let a
// stored preference and a rendered heading disagree about the same number.
const STORAGE_KEY = "slopsplorer.view-preferences.v4";
const TREE_PANEL_STORAGE_KEY = "slopsplorer.tree-panel-ratio.v1";
const WORKSPACE_HEIGHT_STORAGE_KEY = "slopsplorer.workspace-height.v1";
const CHANGED_LINES_ONLY_STORAGE_KEY = "slopsplorer.changed-lines-only.v1";
const WRAP_LINES_STORAGE_KEY = "slopsplorer.wrap-lines.v1";
const SPINE_EXPANDED_STORAGE_KEY = "slopsplorer.spine-expanded.v1";
const SPINE_HEIGHT_STORAGE_KEY = "slopsplorer.spine-height.v1";
const ASK_AGENT_STORAGE_KEY = "slopsplorer.ask-agent.v1";
const OPEN_IN_APPLICATION_STORAGE_KEY = "slopsplorer.open-in-application.v1";

/**
 * Bounds on the two dragged heights.
 *
 * Read here and applied by the splitter that drags them, so a stored value and
 * a dragged one are held to one rule.
 */
export const MIN_SPINE_HEIGHT = 90;
export const MAX_SPINE_HEIGHT = 900;
export const DEFAULT_SPINE_HEIGHT = 260;

export const MIN_WORKSPACE_HEIGHT = 260;
export const MAX_WORKSPACE_HEIGHT = 2000;
export const DEFAULT_WORKSPACE_HEIGHT = 780;

/** Bounds on the dragged source-tree width, as a share of the workspace. */
const MIN_TREE_PANEL_RATIO = 0.1;
const MAX_TREE_PANEL_RATIO = 0.8;

export interface ViewPreferences {
  treeSort: TreeSort;
  measure: Measure;
  /** Side of a change the measure describes. Only a diff can act on it. */
  aspect: Aspect;
  /** Sorted column of the folder panel's file table. */
  rankMetric: RankMetric;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A store that holds nothing, for a browser that grants none. */
const DENIED_STORAGE: PreferenceStorage = {
  getItem: () => null,
  setItem: () => undefined,
};

/**
 * The browser's own store, or one that holds nothing.
 *
 * Reaching `window.localStorage` is itself denied in some locked-down contexts,
 * and the denial arrives as a throw from the property access rather than from
 * the call. Resolved once here, so no caller has to guard the access as well
 * as the read.
 */
export function browserStorage(): PreferenceStorage {
  try {
    return window.localStorage;
  } catch {
    return DENIED_STORAGE;
  }
}

/**
 * The two primitives every preference is read and written through.
 *
 * A browser may deny storage outright in a private or locked-down context, and
 * the denial arrives as a throw from the property access itself. A preference
 * is a convenience, so a denied read is an absent value and a denied write is
 * a value this visit keeps and the next one does not. Held in one place, so no
 * caller has to decide that again.
 */
function readItem(storage: PreferenceStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(storage: PreferenceStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage denied. The choice still holds for this visit.
  }
}

/** An off-by-default switch: anything but a stored `true` is off. */
function readFlag(storage: PreferenceStorage, key: string): boolean {
  return readItem(storage, key) === "true";
}

/** A stored number, or the fallback when it is absent or outside its bounds. */
function readBounded(
  storage: PreferenceStorage, key: string, minimum: number, maximum: number, fallback: number,
): number {
  const value = Number(readItem(storage, key));
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

/**
 * Read a proportional panel width so it adapts when the browser is resized.
 *
 * Proportional, unlike the two dragged heights: the panels scroll inside
 * themselves, so a useful height is a number of rows rather than a share of
 * the window, while a useful width is a share of it.
 */
export function readTreePanelRatio(storage: PreferenceStorage, fallback: number): number {
  return readBounded(storage, TREE_PANEL_STORAGE_KEY, MIN_TREE_PANEL_RATIO, MAX_TREE_PANEL_RATIO, fallback);
}

/** Remember an operator's preferred source-tree width across visits. */
export function writeTreePanelRatio(storage: PreferenceStorage, ratio: number): void {
  writeItem(storage, TREE_PANEL_STORAGE_KEY, String(ratio));
}

/** Read the height the source tree and the folder panel stand at. */
export function readWorkspaceHeight(storage: PreferenceStorage, fallback: number): number {
  return readBounded(storage, WORKSPACE_HEIGHT_STORAGE_KEY, MIN_WORKSPACE_HEIGHT, MAX_WORKSPACE_HEIGHT, fallback);
}

/** Remember an operator's preferred workspace height across visits. */
export function writeWorkspaceHeight(storage: PreferenceStorage, height: number): void {
  writeItem(storage, WORKSPACE_HEIGHT_STORAGE_KEY, String(height));
}

/** Whether the preview of a compared file hides the lines that did not change. */
export function readChangedLinesOnly(storage: PreferenceStorage): boolean {
  return readFlag(storage, CHANGED_LINES_ONLY_STORAGE_KEY);
}

/** Remember that choice across visits, because it is how someone reads a diff. */
export function writeChangedLinesOnly(storage: PreferenceStorage, changedOnly: boolean): void {
  writeItem(storage, CHANGED_LINES_ONLY_STORAGE_KEY, String(changedOnly));
}

/**
 * Whether the preview wraps a long line instead of scrolling sideways.
 *
 * Off until asked: a wrapped line breaks the column a reader counts indentation
 * by, so wrapping is a choice and not a default.
 */
export function readWrapLines(storage: PreferenceStorage): boolean {
  return readFlag(storage, WRAP_LINES_STORAGE_KEY);
}

export function writeWrapLines(storage: PreferenceStorage, wrap: boolean): void {
  writeItem(storage, WRAP_LINES_STORAGE_KEY, String(wrap));
}

/**
 * Whether the commit band is open.
 *
 * It opens shut, because most of what the band is for reads from its one
 * collapsed row, and one rule beats two defaults that depend on how the run
 * was started.
 */
export function readSpineExpanded(storage: PreferenceStorage): boolean {
  return readFlag(storage, SPINE_EXPANDED_STORAGE_KEY);
}

/** Remember that choice, so a reviewer who works in the band keeps it open. */
export function writeSpineExpanded(storage: PreferenceStorage, expanded: boolean): void {
  writeItem(storage, SPINE_EXPANDED_STORAGE_KEY, String(expanded));
}

/** How tall the open commit band is, in pixels, as it was last dragged. */
export function readSpineHeight(storage: PreferenceStorage, fallback: number): number {
  return readBounded(storage, SPINE_HEIGHT_STORAGE_KEY, MIN_SPINE_HEIGHT, MAX_SPINE_HEIGHT, fallback);
}

export function writeSpineHeight(storage: PreferenceStorage, height: number): void {
  writeItem(storage, SPINE_HEIGHT_STORAGE_KEY, String(height));
}

/** Read validated display preferences without trusting arbitrary stored JSON. */
export function readPreferences(storage: PreferenceStorage): ViewPreferences | null {
  const encoded = readItem(storage, STORAGE_KEY);
  if (encoded === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(encoded);
  } catch {
    // Not JSON at all, so there is no preference here to read.
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const treeSort = TREE_SORTS.find((sort) => sort === candidate["treeSort"]);
  if (treeSort === undefined) return null;
  const measure = MEASURES.find((known) => known === candidate["measure"]);
  if (measure === undefined) return null;
  const aspect = ASPECTS.find((known) => known === candidate["aspect"]);
  if (aspect === undefined) return null;
  const rankMetric = RANK_METRICS.find((known) => known === candidate["rankMetric"]);
  if (rankMetric === undefined) return null;
  return { treeSort, measure, aspect, rankMetric };
}

/** Store only durable display choices, leaving navigation and filters linkable. */
export function writePreferences(storage: PreferenceStorage, request: ViewRequest): void {
  const preferences: ViewPreferences = {
    treeSort: request.treeSort,
    measure: request.measure,
    aspect: request.aspect,
    rankMetric: request.rank.metric,
  };
  writeItem(storage, STORAGE_KEY, JSON.stringify(preferences));
}

/**
 * The agent the reader asked last, or `null` when they have asked nobody.
 *
 * Which agent is not checked here: the host decides what it can run, and a
 * name it no longer offers is discarded by the page that draws the menu.
 */
export function readAskAgent(storage: PreferenceStorage): string | null {
  return readItem(storage, ASK_AGENT_STORAGE_KEY);
}

export function writeAskAgent(storage: PreferenceStorage, agentId: string): void {
  writeItem(storage, ASK_AGENT_STORAGE_KEY, agentId);
}

/** The application the reader opened last, or Cursor before they choose one. */
export function readOpenInApplication(storage: PreferenceStorage): OpenInApplication {
  const stored = readItem(storage, OPEN_IN_APPLICATION_STORAGE_KEY);
  return OPEN_IN_APPLICATIONS.find((application) => application === stored) ?? "cursor";
}

export function writeOpenInApplication(storage: PreferenceStorage, application: OpenInApplication): void {
  writeItem(storage, OPEN_IN_APPLICATION_STORAGE_KEY, application);
}
