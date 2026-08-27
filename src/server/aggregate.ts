import path from "node:path";
import type {
  Aspect, ChangeStatus, DetailView, FileRow, Flavor, FlavorSlice, FolderCard, Measure, PathCrumb,
  RankMetric, StatusSlice, SummaryView, TreeRow, ViewRequest, ViewResponse, WeightField,
} from "../shared/api.ts";
import {
  ASPECTS, CHANGE_STATUSES, FILE_KINDS, FLAVORS, MEASURES, RANK_METRICS, TREE_SORTS,
  defaultRankMetric, rankMetricsFor, weightField,
} from "../shared/api.ts";
import type { FolderNode, ScanIndex } from "../scanner/scan.ts";

/**
 * How the row holding a folder's own files is named.
 *
 * `.` is how a path already names the folder itself, so the row reads as part
 * of the tree rather than as a caption about it.
 */
const DIRECT_FILES_LABEL = ".";

/** Bounds on the column count the client may ask for. */
const MIN_CARD_COLUMNS = 1;
const MAX_CARD_COLUMNS = 6;
export function flavorOf(file: FileRow): Flavor {
  return file.generated ? "generated" : file.kind;
}

/**
 * The row fields one measure and one aspect resolve to.
 *
 * Resolved once for a request and then only indexed, so every aggregation is
 * an index expression rather than a decision repeated per file.
 */
interface ActiveFields {
  /** The number every bar, tile, and ranking is drawn from. Signed in `net`. */
  weight: WeightField;
  added: WeightField;
  removed: WeightField;
  /**
   * The denominator every share divides by.
   *
   * Net is signed, so a share against it would let a folder hold more than all
   * of its scope and would explode whenever adds and deletes nearly cancel.
   * Churn is always positive and always at least as large as the net, so it is
   * the honest whole.
   */
  baseline: WeightField;
  churnTokens: WeightField;
  churnLines: WeightField;
  churnCodeLines: WeightField;
}

function resolveFields(measure: Measure, aspect: Aspect): ActiveFields {
  return {
    weight: weightField(measure, aspect),
    added: weightField(measure, "added"),
    removed: weightField(measure, "removed"),
    baseline: weightField(measure, aspect === "net" ? "churn" : aspect),
    churnTokens: weightField("tokens", "churn"),
    churnLines: weightField("lines", "churn"),
    churnCodeLines: weightField("codeLines", "churn"),
  };
}

/**
 * Per-file totals for one scope, plus the breakdowns the bars need.
 *
 * Every measure is carried, not just the active one, because the detail panel
 * quotes the others as supporting figures. `weight` is the active measure and
 * aspect, and it is the only number the tree, the tiles, and the ribbon are
 * drawn from.
 */
interface Totals {
  weight: number;
  added: number;
  removed: number;
  tokens: number;
  lines: number;
  codeLines: number;
  churnTokens: number;
  churnLines: number;
  churnCodeLines: number;
  files: number;
  flavors: Map<Flavor, number>;
  statuses: Map<ChangeStatus, number>;
}

function emptyTotals(): Totals {
  return {
    weight: 0, added: 0, removed: 0,
    tokens: 0, lines: 0, codeLines: 0,
    churnTokens: 0, churnLines: 0, churnCodeLines: 0,
    files: 0, flavors: new Map(), statuses: new Map(),
  };
}

function addFile(totals: Totals, file: FileRow, fields: ActiveFields): void {
  const weight = file[fields.weight];
  totals.weight += weight;
  totals.added += file[fields.added];
  totals.removed += file[fields.removed];
  totals.tokens += file.tokens;
  totals.lines += file.lines;
  totals.codeLines += file.codeLines;
  totals.churnTokens += file[fields.churnTokens];
  totals.churnLines += file[fields.churnLines];
  totals.churnCodeLines += file[fields.churnCodeLines];
  totals.files += 1;
  // Slices are drawn from magnitude: a net of -400 is 400 of ink, and the sign
  // is carried by the figure beside the bar rather than folded into its width.
  const share = Math.abs(weight);
  const flavor = flavorOf(file);
  totals.flavors.set(flavor, (totals.flavors.get(flavor) ?? 0) + share);
  totals.statuses.set(file.status, (totals.statuses.get(file.status) ?? 0) + share);
}

function flavorSlices(totals: Totals): FlavorSlice[] {
  return FLAVORS
    .filter((flavor) => (totals.flavors.get(flavor) ?? 0) > 0)
    .map((flavor) => ({ flavor, weight: totals.flavors.get(flavor)! }));
}

function statusSlices(totals: Totals, isDiff: boolean): StatusSlice[] {
  if (!isDiff) return [];
  return CHANGE_STATUSES
    .filter((status) => (totals.statuses.get(status) ?? 0) > 0)
    .map((status) => ({ status, weight: totals.statuses.get(status)! }));
}

/** 0-1 magnitude of `part` against a whole that is never negative. */
function share(part: number, whole: number): number {
  return whole > 0 ? Math.min(1, Math.abs(part) / whole) : 0;
}

/** Heaviest first, where "heavy" is magnitude, because net weight is signed. */
export function byMagnitude(left: number, right: number): number {
  return Math.abs(right) - Math.abs(left);
}

/** Every numeric `FileRow` field a sorted column can read. */
type ColumnField = WeightField | "commentLines" | "functions" | "branches";

/**
 * The row field one sorted column reads.
 *
 * The aspect columns carry the active measure with them, which is what makes
 * "Added" and "Net" mean the same unit as the heading of the tree beside them.
 */
function columnField(metric: RankMetric, measure: Measure): ColumnField {
  switch (metric) {
    case "added": case "removed": case "churn": case "net": case "after":
      return weightField(measure, metric);
    default:
      return metric;
  }
}

/**
 * Resolve which files survive the visibility switches and the search box.
 *
 * This is the "category" pass: it decides which rows the tree shows at all,
 * independently of the scope checkboxes, which only change the numbers.
 */
function computeCategoryVisibility(index: ScanIndex, request: ViewRequest): Uint8Array {
  const kinds = new Set(request.kinds);
  const query = request.query.trim().toLowerCase();
  const visible = new Uint8Array(index.files.length);
  for (const [position, file] of index.files.entries()) {
    const passesKind = file.generated ? request.showGenerated : kinds.has(file.kind);
    if (!passesKind) continue;
    if (query && !file.path.toLowerCase().includes(query)) continue;
    visible[position] = 1;
  }
  return visible;
}

interface ExclusionState {
  /** Folder is excluded outright, by itself or by an ancestor. */
  excluded: Set<string>;
  /** Folder is included but something beneath it is not. */
  indeterminate: Set<string>;
  /** Folder is excluded only because an ancestor is, so it cannot be toggled alone. */
  disabled: Set<string>;
}

/**
 * Resolve checkbox state for every folder.
 *
 * Exclusions inherit downward, so the pass runs top-down for inheritance and
 * bottom-up for the partial-selection marker.
 */
function computeExclusions(index: ScanIndex, request: ViewRequest): ExclusionState {
  const excludedFolders = new Set(request.excludedFolders);
  const excludedDirectFiles = new Set(request.excludedDirectFiles);
  const excluded = new Set<string>();
  const disabled = new Set<string>();

  // Folders are path-sorted, so every parent is visited before its children.
  for (const folder of index.folders) {
    const inheritedExclusion = folder.parentPath !== null && excluded.has(folder.parentPath);
    if (inheritedExclusion || excludedFolders.has(folder.path)) excluded.add(folder.path);
    if (inheritedExclusion && !excludedFolders.has(folder.path)) disabled.add(folder.path);
  }

  const subtreeExclusion = new Set<string>();
  for (let position = index.folders.length - 1; position >= 0; position -= 1) {
    const folder = index.folders[position]!;
    const hasExclusionBelow =
      excludedDirectFiles.has(folder.path) ||
      folder.childPaths.some((child) => excludedFolders.has(child) || subtreeExclusion.has(child));
    if (hasExclusionBelow) subtreeExclusion.add(folder.path);
  }

  const indeterminate = new Set<string>();
  for (const folder of index.folders) {
    if (!excluded.has(folder.path) && subtreeExclusion.has(folder.path)) indeterminate.add(folder.path);
  }

  return { excluded, indeterminate, disabled };
}

interface Aggregation {
  /** Files passing the category filters, before scope exclusions. */
  categoryVisible: Uint8Array;
  /** Files passing category filters *and* scope exclusions. */
  included: Uint8Array;
  /** Category-visible file count per folder subtree, keyed by folder path. */
  categoryCount: Map<string, number>;
  /** Category-visible weight per folder subtree, before scope exclusions. */
  categorySubtreeWeight: Map<string, number>;
  /** Category-visible weight for files sitting directly in a folder. */
  categoryDirectWeight: Map<string, number>;
  /** Included totals per folder subtree. */
  subtree: Map<string, Totals>;
  /** Included totals for files sitting directly in a folder. */
  direct: Map<string, Totals>;
}

function aggregate(
  index: ScanIndex, request: ViewRequest, exclusions: ExclusionState, fields: ActiveFields,
): Aggregation {
  const categoryVisible = computeCategoryVisibility(index, request);
  const excludedDirectFiles = new Set(request.excludedDirectFiles);

  const included = new Uint8Array(index.files.length);
  for (const folder of index.folders) {
    const folderExcluded = exclusions.excluded.has(folder.path);
    const directExcluded = folderExcluded || excludedDirectFiles.has(folder.path);
    if (directExcluded) continue;
    for (const fileIndex of folder.directFileIndices) {
      if (categoryVisible[fileIndex]) included[fileIndex] = 1;
    }
  }

  const direct = new Map<string, Totals>();
  const subtree = new Map<string, Totals>();
  const categoryCount = new Map<string, number>();
  const categorySubtreeWeight = new Map<string, number>();
  const categoryDirectWeight = new Map<string, number>();

  // Bottom-up: a folder's subtree total is its direct files plus its children.
  for (let position = index.folders.length - 1; position >= 0; position -= 1) {
    const folder = index.folders[position]!;
    const directTotals = emptyTotals();
    for (const fileIndex of folder.directFileIndices) {
      if (included[fileIndex]) addFile(directTotals, index.files[fileIndex]!, fields);
    }
    direct.set(folder.path, directTotals);

    const subtreeTotals = emptyTotals();
    mergeTotals(subtreeTotals, directTotals);
    let visibleBelow = 0;
    let visibleDirectWeight = 0;
    for (const fileIndex of folder.directFileIndices) {
      if (categoryVisible[fileIndex]) {
        visibleBelow += 1;
        visibleDirectWeight += Math.abs(index.files[fileIndex]![fields.weight]);
      }
    }
    let visibleSubtreeWeight = visibleDirectWeight;
    for (const childPath of folder.childPaths) {
      const childTotals = subtree.get(childPath);
      if (childTotals) mergeTotals(subtreeTotals, childTotals);
      visibleBelow += categoryCount.get(childPath) ?? 0;
      visibleSubtreeWeight += categorySubtreeWeight.get(childPath) ?? 0;
    }
    subtree.set(folder.path, subtreeTotals);
    categoryCount.set(folder.path, visibleBelow);
    categoryDirectWeight.set(folder.path, visibleDirectWeight);
    categorySubtreeWeight.set(folder.path, visibleSubtreeWeight);
  }

  return {
    categoryVisible,
    included,
    categoryCount,
    categorySubtreeWeight,
    categoryDirectWeight,
    subtree,
    direct,
  };
}

function mergeTotals(target: Totals, source: Totals): void {
  target.weight += source.weight;
  target.added += source.added;
  target.removed += source.removed;
  target.tokens += source.tokens;
  target.lines += source.lines;
  target.codeLines += source.codeLines;
  target.churnTokens += source.churnTokens;
  target.churnLines += source.churnLines;
  target.churnCodeLines += source.churnCodeLines;
  target.files += source.files;
  for (const [flavor, weight] of source.flavors) {
    target.flavors.set(flavor, (target.flavors.get(flavor) ?? 0) + weight);
  }
  for (const [status, weight] of source.statuses) {
    target.statuses.set(status, (target.statuses.get(status) ?? 0) + weight);
  }
}

/**
 * A folder's complete weight in one measure, ignoring every active filter.
 *
 * The summary states this beside the visible weight, so the ribbon can say how
 * much of the tree the filters keep. No share divides by it: a percentage of a
 * whole the page is not drawing names a scope the reader cannot see.
 */
function unfilteredWeight(index: ScanIndex, folderPath: string, field: WeightField): number {
  const folder = index.folderByPath.get(folderPath);
  if (!folder) return 0;
  const prefix = index.weightPrefix[field];
  return prefix[folder.end]! - prefix[folder.start]!;
}

/** The unfiltered weight of the whole tree, which the ribbon states as `project`. */
function projectBaseline(index: ScanIndex, field: WeightField): number {
  return unfilteredWeight(index, "", field);
}

function buildTree(
  index: ScanIndex,
  request: ViewRequest,
  aggregation: Aggregation,
  exclusions: ExclusionState,
  scopeRoot: FolderNode,
  visibleScopeWeight: number,
  /** Churn the filters leave in the scope: the whole the two halves divide. */
  visibleChurn: number,
): TreeRow[] {
  const expanded = new Set(request.expanded);
  const queryActive = request.query.trim().length > 0;
  const excludedDirectFiles = new Set(request.excludedDirectFiles);
  const rows: TreeRow[] = [];

  const walk = (folder: FolderNode, depth: number): void => {
    if ((aggregation.categoryCount.get(folder.path) ?? 0) === 0) return;
    const totals = aggregation.subtree.get(folder.path) ?? emptyTotals();
    const directTotals = aggregation.direct.get(folder.path) ?? emptyTotals();
    const childFolders = folder.childPaths
      .map((childPath) => index.folderByPath.get(childPath))
      .filter((child): child is FolderNode => child !== undefined)
      .filter((child) => (aggregation.categoryCount.get(child.path) ?? 0) > 0);
    const hasVisibleDirectFiles = folder.directFileIndices.some((fileIndex) => aggregation.categoryVisible[fileIndex] === 1);
    const children: ({ rowKind: "folder"; folder: FolderNode; name: string; weight: number; sortWeight: number } | {
      rowKind: "files"; name: string; weight: number; sortWeight: number;
    })[] = childFolders.map((child) => ({
      rowKind: "folder",
      folder: child,
      name: child.name,
      weight: (aggregation.subtree.get(child.path) ?? emptyTotals()).weight,
      sortWeight: Math.abs(aggregation.categorySubtreeWeight.get(child.path) ?? 0),
    }));
    if (hasVisibleDirectFiles) {
      children.push({
        rowKind: "files",
        name: DIRECT_FILES_LABEL,
        weight: directTotals.weight,
        sortWeight: Math.abs(aggregation.categoryDirectWeight.get(folder.path) ?? 0),
      });
    }
    // The `.` row heads every level it appears in, whichever order the level is
    // sorted by: it is the one row that holds files rather than more folders, so
    // a reader looking for the folder's own contents always finds it in one place.
    children.sort((left, right) => {
      if (left.rowKind !== right.rowKind) return left.rowKind === "files" ? -1 : 1;
      return request.treeSort === "weight"
        ? right.sortWeight - left.sortWeight || left.name.localeCompare(right.name)
        : left.name.localeCompare(right.name);
    });
    const isExpanded = queryActive || expanded.has(folder.path);
    rows.push({
      path: folder.path,
      name: folder.name,
      depth,
      rowKind: "folder",
      weight: totals.weight,
      added: totals.added,
      removed: totals.removed,
      shareOfScope: share(totals.weight, visibleScopeWeight),
      shareAdded: share(totals.added, visibleChurn),
      shareRemoved: share(totals.removed, visibleChurn),
      hasChildren: children.length > 0,
      expanded: isExpanded,
      included: !exclusions.excluded.has(folder.path),
      indeterminate: exclusions.indeterminate.has(folder.path),
      disabled: exclusions.disabled.has(folder.path),
      selected: request.selected.rowKind === "folder" && request.selected.path === folder.path,
    });

    if (!isExpanded) return;

    for (const child of children) {
      if (child.rowKind === "folder") {
        walk(child.folder, depth + 1);
        continue;
      }
      const folderExcluded = exclusions.excluded.has(folder.path);
      rows.push({
        path: folder.path,
        name: child.name,
        depth: depth + 1,
        rowKind: child.rowKind,
        weight: child.weight,
        added: directTotals.added,
        removed: directTotals.removed,
        shareOfScope: share(child.weight, visibleScopeWeight),
        shareAdded: share(directTotals.added, visibleChurn),
        shareRemoved: share(directTotals.removed, visibleChurn),
        hasChildren: false,
        expanded: false,
        included: !folderExcluded && !excludedDirectFiles.has(folder.path),
        indeterminate: false,
        disabled: folderExcluded,
        selected: request.selected.rowKind === "files" && request.selected.path === folder.path,
      });
    }
  };

  walk(scopeRoot, 0);
  return rows;
}

function buildFolderCard(
  name: string,
  folderPath: string | null,
  totals: Totals,
  visibleScopeWeight: number,
  isDiff: boolean,
): FolderCard {
  return {
    path: folderPath,
    name,
    weight: totals.weight,
    added: totals.added,
    removed: totals.removed,
    files: totals.files,
    shareOfScope: share(totals.weight, visibleScopeWeight),
    flavors: flavorSlices(totals),
    statuses: statusSlices(totals, isDiff),
  };
}

/**
 * The panel for whatever the tree has selected.
 *
 * A `.` row is its own subject rather than a second way to name its folder: it
 * drops the child-folder tiles that belong to the subtree, and puts the folder
 * itself into the heading trail. The file list beside the tiles is `rankFiles`,
 * which narrows to the folder's own files for the same reason.
 */
function buildDetail(
  index: ScanIndex,
  request: ViewRequest,
  aggregation: Aggregation,
  visibleScopeWeight: number,
): DetailView {
  const isDiff = index.meta.diff !== null;
  const directFilesOnly = request.selected.rowKind === "files";
  const folder = index.folderByPath.get(request.selected.path) ?? index.folderByPath.get("")!;
  const totals = (directFilesOnly ? aggregation.direct : aggregation.subtree).get(folder.path) ?? emptyTotals();

  const cards: FolderCard[] = [];
  const cardColumns = request.cardColumns;
  const children = directFilesOnly ? [] : folder.childPaths
    .map((childPath) => ({ node: index.folderByPath.get(childPath), totals: aggregation.subtree.get(childPath) }))
    .filter((entry): entry is { node: FolderNode; totals: Totals } => entry.node !== undefined && entry.totals !== undefined)
    .filter((entry) => entry.totals.files > 0)
    .sort((left, right) => byMagnitude(left.totals.weight, right.totals.weight));

  // One row, so the tiles take a fixed height whatever the folder holds and the
  // table below them starts in the same place. The measured capacity stays fixed
  // even when one child exists, so a lone card keeps the width of a full row's
  // tile instead of stretching across the panel. The last tile absorbs whatever
  // does not fit.
  const tiles = Math.min(children.length, cardColumns);
  if (tiles < children.length) {
    const shown = tiles - 1;
    for (const entry of children.slice(0, shown)) {
      cards.push(buildFolderCard(entry.node.name, entry.node.path, entry.totals, visibleScopeWeight, isDiff));
    }
    const rest = emptyTotals();
    for (const entry of children.slice(shown)) mergeTotals(rest, entry.totals);
    cards.push(buildFolderCard(`${children.length - shown} more folders`, null, rest, visibleScopeWeight, isDiff));
  } else {
    for (const entry of children) {
      cards.push(buildFolderCard(entry.node.name, entry.node.path, entry.totals, visibleScopeWeight, isDiff));
    }
  }

  // The heading already names its own subject, so the trail stops one step
  // short of it: at the folder's parent, or at the folder itself for a `.`.
  const segments = folder.path.split("/").filter(Boolean);
  const trailSegments = directFilesOnly ? segments : segments.slice(0, -1);
  const trail: PathCrumb[] = [];
  if (directFilesOnly || segments.length > 0) {
    trail.push({ name: index.meta.rootName, path: "" });
    let ancestorPath = "";
    for (const segment of trailSegments) {
      ancestorPath = ancestorPath ? `${ancestorPath}/${segment}` : segment;
      trail.push({ name: segment, path: ancestorPath });
    }
  }

  return {
    title: directFilesOnly ? DIRECT_FILES_LABEL : folder.name,
    trail,
    weight: totals.weight,
    added: totals.added,
    removed: totals.removed,
    files: totals.files,
    tokens: totals.tokens,
    lines: totals.lines,
    codeLines: totals.codeLines,
    churnTokens: totals.churnTokens,
    churnLines: totals.churnLines,
    churnCodeLines: totals.churnCodeLines,
    shareOfScope: share(totals.weight, visibleScopeWeight),
    cards,
    cardColumns,
  };
}

/**
 * Order files by the sorted column, breaking ties on the active measure.
 *
 * Both file tables use it, so a folder's own files and the ranking beneath
 * them can never disagree about what one sorted column means.
 */
function byMetric(
  metric: RankMetric, measure: Measure, fields: ActiveFields,
): (left: FileRow, right: FileRow) => number {
  const sorted = columnField(metric, measure);
  return (left, right) =>
    byMagnitude(left[sorted], right[sorted])
    || byMagnitude(left[fields.weight], right[fields.weight])
    || left.path.localeCompare(right.path);
}

/**
 * Rank the heaviest files inside the selected folder.
 *
 * This is the file list of the folder panel, and the only one the page draws.
 * It follows the tree selection, not just the visibility switches, so selecting
 * a folder narrows the list to that subtree. Selecting the `.` row narrows it
 * further to the files sitting directly in the folder. Because descendants are
 * contiguous in the path-sorted array, the subtree is a range rather than a
 * scan of the project.
 */
function rankFiles(
  index: ScanIndex, request: ViewRequest, aggregation: Aggregation, fields: ActiveFields,
): { rows: FileRow[]; total: number } {
  const folder = index.folderByPath.get(request.selected.path) ?? index.folderByPath.get("")!;
  const directFilesOnly = request.selected.rowKind === "files";
  const matches: FileRow[] = [];
  const consider = (position: number): void => {
    if (aggregation.included[position] !== 1) return;
    const file = index.files[position]!;
    // A floor on the magnitude: in net, a file at -900 is a large change, and
    // comparing it signed would drop every deletion.
    if (Math.abs(file[fields.weight]) < request.rank.minWeight) return;
    matches.push(file);
  };
  if (directFilesOnly) {
    for (const position of folder.directFileIndices) consider(position);
  } else {
    for (let position = folder.start; position < folder.end; position += 1) consider(position);
  }
  matches.sort(byMetric(request.rank.metric, request.measure, fields));
  return { rows: matches.slice(0, Math.max(0, request.rank.limit)), total: matches.length };
}

/**
 * Headline figures for the drill scope under the active filters and checkboxes.
 *
 * Drilling is a move of the whole viewport, so this strip re-roots along with
 * the tree beside it and the bar always splits the scope the tree is showing.
 * Ordinary folder selection is navigation inside that scope and deliberately
 * leaves these figures alone, so clicking through the detail panel cannot make
 * the headline totals jump.
 */
function buildSummary(
  index: ScanIndex,
  aggregation: Aggregation,
  baseline: number,
  scopeRoot: FolderNode,
  scopeBaseline: number,
  visibleScopeWeight: number,
): SummaryView {
  const isDiff = index.meta.diff !== null;
  const scopeTotals = aggregation.subtree.get(scopeRoot.path) ?? emptyTotals();
  const ribbon: FolderCard[] = [];
  const children = scopeRoot.childPaths
    .map((childPath) => ({ node: index.folderByPath.get(childPath), totals: aggregation.subtree.get(childPath) }))
    .filter((entry): entry is { node: FolderNode; totals: Totals } => entry.node !== undefined && entry.totals !== undefined)
    .filter((entry) => entry.totals.weight !== 0)
    .sort((left, right) => byMagnitude(left.totals.weight, right.totals.weight));
  for (const entry of children) {
    ribbon.push(buildFolderCard(entry.node.name, entry.node.path, entry.totals, visibleScopeWeight, isDiff));
  }
  const scopeDirect = aggregation.direct.get(scopeRoot.path) ?? emptyTotals();
  if (scopeDirect.weight !== 0) {
    ribbon.push(buildFolderCard(DIRECT_FILES_LABEL, null, scopeDirect, visibleScopeWeight, isDiff));
  }
  return {
    projectWeight: baseline,
    scopePath: scopeRoot.path,
    scopeWeight: scopeBaseline,
    selectedWeight: scopeTotals.weight,
    selectedAdded: scopeTotals.added,
    selectedRemoved: scopeTotals.removed,
    selectedFiles: scopeTotals.files,
    selectedTokens: scopeTotals.tokens,
    selectedLines: scopeTotals.lines,
    selectedCodeLines: scopeTotals.codeLines,
    selectedChurnTokens: scopeTotals.churnTokens,
    selectedChurnLines: scopeTotals.churnLines,
    selectedChurnCodeLines: scopeTotals.churnCodeLines,
    ribbon,
  };
}

/** Build every surface the client renders, for one scope request. */
export function buildView(index: ScanIndex, request: ViewRequest): ViewResponse {
  const projectRoot = index.folderByPath.get("")!;
  const scopeRoot = index.folderByPath.get(request.drillPath) ?? projectRoot;
  const selectedFolder = index.folderByPath.get(request.selected.path);
  const scopePrefix = scopeRoot.path ? `${scopeRoot.path}/` : "";
  const selectionInsideScope = selectedFolder !== undefined && (
    selectedFolder.path === scopeRoot.path || scopePrefix === "" || selectedFolder.path.startsWith(scopePrefix)
  );
  const effectiveRequest: ViewRequest = selectionInsideScope
    ? request
    : { ...request, selected: { rowKind: "folder", path: scopeRoot.path } };
  // A scan has one content per file, so only the after-image aspect means
  // anything there. Clamping here is what keeps a pasted link from asking a
  // scan for churn and getting a page of zeroes.
  const isDiff = index.meta.diff !== null;
  const aspect: Aspect = isDiff ? request.aspect : "after";
  const rankMetric = rankMetricsFor(isDiff).includes(request.rank.metric)
    ? request.rank.metric
    : defaultRankMetric(isDiff);
  const fields = resolveFields(request.measure, aspect);
  const modeRequest: ViewRequest = { ...effectiveRequest, aspect, rank: { ...effectiveRequest.rank, metric: rankMetric } };
  const exclusions = computeExclusions(index, request);
  const aggregation = aggregate(index, request, exclusions, fields);
  const baseline = projectBaseline(index, fields.baseline);
  const scopeBaseline = unfilteredWeight(index, scopeRoot.path, fields.baseline);
  const scopeTotals = aggregation.subtree.get(scopeRoot.path) ?? emptyTotals();
  // One scale for every band, so a row's length means the same wherever it sits
  // in the tree. It is the churn the filters leave rather than the unfiltered
  // whole, because a code-only view of a large repository holds a small part of
  // the project's churn and would draw every band at under a pixel.
  const visibleChurn = scopeTotals.added + scopeTotals.removed;
  // The whole every folder share divides by: the drill scope as the filters
  // leave it, so a share names the tree the reader is looking at. Net is signed
  // and cannot be its own whole, so in that aspect the shares scale bands only
  // and the page states no percentage of them.
  const visibleScopeWeight = aspect === "net" ? visibleChurn : scopeTotals.weight;
  const ranked = rankFiles(index, modeRequest, aggregation, fields);
  return {
    meta: index.meta,
    measure: request.measure,
    aspect,
    rankMetric,
    summary: buildSummary(index, aggregation, baseline, scopeRoot, scopeBaseline, visibleScopeWeight),
    tree: buildTree(index, modeRequest, aggregation, exclusions, scopeRoot, visibleScopeWeight, visibleChurn),
    detail: buildDetail(index, modeRequest, aggregation, visibleScopeWeight),
    ranked: ranked.rows,
    rankedTotal: ranked.total,
    expandableFolderPaths: index.folders
      .filter((folder) => (
        folder.path === scopeRoot.path || scopePrefix === "" || folder.path.startsWith(scopePrefix)
      ) && (aggregation.categoryCount.get(folder.path) ?? 0) > 0)
      .map((folder) => folder.path),
  };
}

/** Normalise untrusted request bodies into a complete, safe `ViewRequest`. */
export function parseViewRequest(body: unknown): ViewRequest {
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const stringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const rank = (typeof raw["rank"] === "object" && raw["rank"] !== null ? raw["rank"] : {}) as Record<string, unknown>;
  const selected = (typeof raw["selected"] === "object" && raw["selected"] !== null ? raw["selected"] : {}) as Record<string, unknown>;
  const metric = RANK_METRICS.find((candidate) => candidate === rank["metric"]) ?? "tokens";
  const treeSort = TREE_SORTS.find((candidate) => candidate === raw["treeSort"]) ?? "name";
  const measure = MEASURES.find((candidate) => candidate === raw["measure"]) ?? "tokens";
  const aspect = ASPECTS.find((candidate) => candidate === raw["aspect"]) ?? "net";
  return {
    kinds: FILE_KINDS.filter((kind) => stringArray(raw["kinds"]).includes(kind)),
    measure,
    aspect,
    showGenerated: raw["showGenerated"] === true,
    query: typeof raw["query"] === "string" ? raw["query"] : "",
    excludedFolders: stringArray(raw["excludedFolders"]),
    excludedDirectFiles: stringArray(raw["excludedDirectFiles"]),
    expanded: stringArray(raw["expanded"]),
    treeSort,
    drillPath: typeof raw["drillPath"] === "string" ? raw["drillPath"] : "",
    selected: {
      rowKind: selected["rowKind"] === "files" ? "files" : "folder",
      path: typeof selected["path"] === "string" ? selected["path"] : "",
    },
    rank: {
      metric,
      minWeight: Number.isFinite(rank["minWeight"]) ? Math.max(0, Number(rank["minWeight"])) : 0,
      limit: Number.isFinite(rank["limit"]) ? Math.min(1000, Math.max(1, Number(rank["limit"]))) : 100,
    },
    cardColumns: Number.isFinite(raw["cardColumns"])
      ? Math.min(MAX_CARD_COLUMNS, Math.max(MIN_CARD_COLUMNS, Math.trunc(Number(raw["cardColumns"]))))
      : 3,
  };
}
