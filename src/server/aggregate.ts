import path from "node:path";
import type {
  DetailView, FileRow, Flavor, FlavorSlice, FolderCard, Measure, RankMetric,
  SummaryView, TreeRow, ViewRequest, ViewResponse,
} from "../shared/api.ts";
import { FILE_KINDS, FLAVORS, MEASURES, RANK_METRICS, TREE_SORTS } from "../shared/api.ts";
import type { FolderNode, ScanIndex } from "../scanner/scan.ts";

/** Bounds on the column count the client may ask for. */
const MIN_CARD_COLUMNS = 1;
const MAX_CARD_COLUMNS = 6;
/** Tiles are capped at two rows, however wide the panel gets. */
const CARD_ROWS = 2;

/**
 * Choose a fixed column count and cap the tile list at two rows.
 *
 * The measured capacity stays fixed even when only one child exists, so a lone
 * card retains the same width instead of stretching across the whole panel.
 * When more than two rows exist, the final card absorbs everything beyond the
 * visible individual cards.
 */
function planFolderCards(childCount: number, maxColumns: number): { columns: number; tiles: number } {
  return { columns: maxColumns, tiles: Math.min(childCount, maxColumns * CARD_ROWS) };
}

function flavorOf(file: FileRow): Flavor {
  return file.generated ? "generated" : file.kind;
}

/**
 * Per-file totals for one scope, plus the flavor breakdown the bars need.
 *
 * Every measure is carried, not just the active one, because the detail panel
 * quotes the others as supporting figures. `weight` is the active measure, and
 * it is the only number the tree, the tiles, and the ribbon are drawn from.
 */
interface Totals {
  weight: number;
  tokens: number;
  lines: number;
  codeLines: number;
  commentLines: number;
  files: number;
  flavors: Map<Flavor, number>;
}

function emptyTotals(): Totals {
  return { weight: 0, tokens: 0, lines: 0, codeLines: 0, commentLines: 0, files: 0, flavors: new Map() };
}

function addFile(totals: Totals, file: FileRow, measure: Measure): void {
  totals.weight += file[measure];
  totals.tokens += file.tokens;
  totals.lines += file.lines;
  totals.codeLines += file.codeLines;
  totals.commentLines += file.commentLines;
  totals.files += 1;
  const flavor = flavorOf(file);
  totals.flavors.set(flavor, (totals.flavors.get(flavor) ?? 0) + file[measure]);
}

function flavorSlices(totals: Totals): FlavorSlice[] {
  return FLAVORS
    .filter((flavor) => (totals.flavors.get(flavor) ?? 0) > 0)
    .map((flavor) => ({ flavor, weight: totals.flavors.get(flavor)! }));
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

function aggregate(index: ScanIndex, request: ViewRequest, exclusions: ExclusionState): Aggregation {
  const measure = request.measure;
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
      if (included[fileIndex]) addFile(directTotals, index.files[fileIndex]!, measure);
    }
    direct.set(folder.path, directTotals);

    const subtreeTotals = emptyTotals();
    mergeTotals(subtreeTotals, directTotals);
    let visibleBelow = 0;
    let visibleDirectWeight = 0;
    for (const fileIndex of folder.directFileIndices) {
      if (categoryVisible[fileIndex]) {
        visibleBelow += 1;
        visibleDirectWeight += index.files[fileIndex]![measure];
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
  target.tokens += source.tokens;
  target.lines += source.lines;
  target.codeLines += source.codeLines;
  target.commentLines += source.commentLines;
  target.files += source.files;
  for (const [flavor, weight] of source.flavors) {
    target.flavors.set(flavor, (target.flavors.get(flavor) ?? 0) + weight);
  }
}

/**
 * A folder's complete weight in one measure, ignoring every active filter.
 *
 * Bars are normalised against this rather than against the visible total so
 * that switching a file kind on can only lengthen a bar. Normalising against
 * the filtered total would grow the denominator too, and a tile holding none
 * of the newly enabled kind would visibly shrink.
 */
function unfilteredWeight(index: ScanIndex, folderPath: string, measure: Measure): number {
  const folder = index.folderByPath.get(folderPath);
  if (!folder) return 0;
  const prefix = index.weightPrefix[measure];
  return prefix[folder.end]! - prefix[folder.start]!;
}

/**
 * The denominator every project percentage is measured against.
 *
 * This is the unfiltered weight of the whole tree, so it does not move when a
 * visibility switch changes and the tile bars, the folder share, and the
 * summary all divide by the same number.
 */
function projectBaseline(index: ScanIndex, measure: Measure): number {
  return unfilteredWeight(index, "", measure);
}

function buildTree(
  index: ScanIndex,
  request: ViewRequest,
  aggregation: Aggregation,
  exclusions: ExclusionState,
  scopeRoot: FolderNode,
  scopeBaseline: number,
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
      sortWeight: aggregation.categorySubtreeWeight.get(child.path) ?? 0,
    }));
    if (hasVisibleDirectFiles) {
      children.push({
        rowKind: "files",
        name: "(files)",
        weight: directTotals.weight,
        sortWeight: aggregation.categoryDirectWeight.get(folder.path) ?? 0,
      });
    }
    children.sort((left, right) => request.treeSort === "weight"
      ? right.sortWeight - left.sortWeight || left.name.localeCompare(right.name)
      : left.name.localeCompare(right.name));
    const isExpanded = queryActive || expanded.has(folder.path);
    rows.push({
      path: folder.path,
      name: folder.name,
      depth,
      rowKind: "folder",
      weight: totals.weight,
      shareOfScope: scopeBaseline > 0 ? Math.min(1, totals.weight / scopeBaseline) : 0,
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
        shareOfScope: scopeBaseline > 0 ? Math.min(1, child.weight / scopeBaseline) : 0,
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
  baseline: number,
  scopeBaseline: number,
): FolderCard {
  return {
    path: folderPath,
    name,
    weight: totals.weight,
    files: totals.files,
    shareOfProject: baseline > 0 ? totals.weight / baseline : 0,
    shareOfScope: scopeBaseline > 0 ? Math.min(1, totals.weight / scopeBaseline) : 0,
    flavors: flavorSlices(totals),
  };
}

function buildDetail(
  index: ScanIndex,
  request: ViewRequest,
  aggregation: Aggregation,
  baseline: number,
  scopeBaseline: number,
): DetailView {
  const folder = index.folderByPath.get(request.selected.path) ?? index.folderByPath.get("")!;
  const directFilesOnly = request.selected.rowKind === "files";
  const totals = directFilesOnly
    ? aggregation.direct.get(folder.path) ?? emptyTotals()
    : aggregation.subtree.get(folder.path) ?? emptyTotals();

  const cards: FolderCard[] = [];
  let cardColumns = request.cardColumns;
  if (!directFilesOnly) {
    const children = folder.childPaths
      .map((childPath) => ({ node: index.folderByPath.get(childPath), totals: aggregation.subtree.get(childPath) }))
      .filter((entry): entry is { node: FolderNode; totals: Totals } => entry.node !== undefined && entry.totals !== undefined)
      .filter((entry) => entry.totals.files > 0)
      .sort((left, right) => right.totals.weight - left.totals.weight);

    const plan = planFolderCards(children.length, request.cardColumns);
    cardColumns = plan.columns;
    if (plan.tiles < children.length) {
      const shown = plan.tiles - 1;
      for (const entry of children.slice(0, shown)) {
        cards.push(buildFolderCard(entry.node.name, entry.node.path, entry.totals, baseline, scopeBaseline));
      }
      const rest = emptyTotals();
      for (const entry of children.slice(shown)) mergeTotals(rest, entry.totals);
      cards.push(buildFolderCard(`${children.length - shown} more folders`, null, rest, baseline, scopeBaseline));
    } else {
      for (const entry of children) {
        cards.push(buildFolderCard(entry.node.name, entry.node.path, entry.totals, baseline, scopeBaseline));
      }
    }
  }

  const measure = request.measure;
  const directFiles = folder.directFileIndices
    .filter((fileIndex) => aggregation.included[fileIndex] === 1)
    .map((fileIndex) => index.files[fileIndex]!)
    .sort((left, right) => right[measure] - left[measure] || left.path.localeCompare(right.path));

  // The heading already names the folder, so the trail stops at its parent.
  const segments = folder.path.split("/").filter(Boolean);
  const ancestors = directFilesOnly ? segments : segments.slice(0, -1);
  const breadcrumb = directFilesOnly || segments.length > 0
    ? [index.meta.rootName, ...ancestors].join("/")
    : "";

  return {
    title: directFilesOnly ? "(files)" : folder.name,
    breadcrumb,
    weight: totals.weight,
    files: totals.files,
    tokens: totals.tokens,
    lines: totals.lines,
    codeLines: totals.codeLines,
    commentLines: totals.commentLines,
    shareOfProject: baseline > 0 ? totals.weight / baseline : 0,
    shareOfScope: scopeBaseline > 0 ? Math.min(1, totals.weight / scopeBaseline) : 0,
    cards,
    cardColumns,
    directFiles,
  };
}

/**
 * Rank the heaviest files inside the selected folder.
 *
 * The ranking follows the tree selection, not just the visibility switches, so
 * selecting a folder narrows the list to that subtree. Selecting the `(files)`
 * row narrows it further to the files sitting directly in the folder. Because
 * descendants are contiguous in the path-sorted array, the subtree is a range
 * rather than a scan of the project.
 */
function rankFiles(index: ScanIndex, request: ViewRequest, aggregation: Aggregation): { rows: FileRow[]; total: number } {
  const metric: RankMetric = request.rank.metric;
  const folder = index.folderByPath.get(request.selected.path) ?? index.folderByPath.get("")!;
  const directFilesOnly = request.selected.rowKind === "files";
  const matches: FileRow[] = [];
  const consider = (position: number): void => {
    if (aggregation.included[position] !== 1) return;
    const file = index.files[position]!;
    if (file[request.measure] < request.rank.minWeight) return;
    matches.push(file);
  };
  if (directFilesOnly) {
    for (const position of folder.directFileIndices) consider(position);
  } else {
    for (let position = folder.start; position < folder.end; position += 1) consider(position);
  }
  matches.sort(
    (left, right) =>
      right[metric] - left[metric] ||
      right[request.measure] - left[request.measure] ||
      left.path.localeCompare(right.path),
  );
  return { rows: matches.slice(0, Math.max(0, request.rank.limit)), total: matches.length };
}

/**
 * Project-level headline figures under the active filters and tree checkboxes.
 *
 * Ordinary folder selection drives the detail and ranking panels only. Keeping
 * it out of this summary lets the top ribbon remain a project-level instrument.
 */
function buildSummary(
  index: ScanIndex,
  aggregation: Aggregation,
  baseline: number,
): SummaryView {
  const rootTotals = aggregation.subtree.get("") ?? emptyTotals();
  const root = index.folderByPath.get("");
  const ribbon: FolderCard[] = [];
  if (root) {
    const children = root.childPaths
      .map((childPath) => ({ node: index.folderByPath.get(childPath), totals: aggregation.subtree.get(childPath) }))
      .filter((entry): entry is { node: FolderNode; totals: Totals } => entry.node !== undefined && entry.totals !== undefined)
      .filter((entry) => entry.totals.weight > 0)
      .sort((left, right) => right.totals.weight - left.totals.weight);
    for (const entry of children) {
      ribbon.push(buildFolderCard(entry.node.name, entry.node.path, entry.totals, baseline, baseline));
    }
    const rootDirect = aggregation.direct.get("") ?? emptyTotals();
    if (rootDirect.weight > 0) {
      ribbon.push(buildFolderCard("(files)", null, rootDirect, baseline, baseline));
    }
  }
  return {
    projectWeight: baseline,
    selectedWeight: rootTotals.weight,
    selectedFiles: rootTotals.files,
    selectedTokens: rootTotals.tokens,
    selectedLines: rootTotals.lines,
    selectedCodeLines: rootTotals.codeLines,
    selectedCommentLines: rootTotals.commentLines,
    ribbon,
  };
}

/** Human-readable name of the subtree the ranking covers. */
function rankScopeLabel(index: ScanIndex, request: ViewRequest): string {
  const folder = index.folderByPath.get(request.selected.path) ?? index.folderByPath.get("")!;
  const base = folder.path || index.meta.rootName;
  return request.selected.rowKind === "files" ? `${base}/(files)` : base;
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
  const exclusions = computeExclusions(index, request);
  const aggregation = aggregate(index, request, exclusions);
  const baseline = projectBaseline(index, request.measure);
  const scopeBaseline = unfilteredWeight(index, scopeRoot.path, request.measure);
  const ranked = rankFiles(index, effectiveRequest, aggregation);
  return {
    meta: index.meta,
    measure: request.measure,
    summary: buildSummary(index, aggregation, baseline),
    tree: buildTree(index, effectiveRequest, aggregation, exclusions, scopeRoot, scopeBaseline),
    detail: buildDetail(index, effectiveRequest, aggregation, baseline, scopeBaseline),
    ranked: ranked.rows,
    rankedTotal: ranked.total,
    rankScope: rankScopeLabel(index, effectiveRequest),
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
  return {
    kinds: FILE_KINDS.filter((kind) => stringArray(raw["kinds"]).includes(kind)),
    measure,
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
