import path from "node:path";
import type {
  DetailView, FileRow, Flavor, FlavorSlice, FolderCard, RankMetric,
  SummaryView, TreeRow, ViewRequest, ViewResponse,
} from "../shared/api.ts";
import { FLAVORS, RANK_METRICS } from "../shared/api.ts";
import type { FolderNode, ScanIndex } from "../scanner/scan.ts";

/** Bounds on the tile count the client may ask for. */
const MIN_FOLDER_CARDS = 2;
const MAX_FOLDER_CARDS = 12;

function flavorOf(file: FileRow): Flavor {
  return file.generated ? "generated" : file.kind;
}

/** Per-file totals for one scope, plus the flavor breakdown the bars need. */
interface Totals {
  tokens: number;
  lines: number;
  codeLines: number;
  commentLines: number;
  files: number;
  flavors: Map<Flavor, number>;
}

function emptyTotals(): Totals {
  return { tokens: 0, lines: 0, codeLines: 0, commentLines: 0, files: 0, flavors: new Map() };
}

function addFile(totals: Totals, file: FileRow): void {
  totals.tokens += file.tokens;
  totals.lines += file.lines;
  totals.codeLines += file.codeLines;
  totals.commentLines += file.commentLines;
  totals.files += 1;
  const flavor = flavorOf(file);
  totals.flavors.set(flavor, (totals.flavors.get(flavor) ?? 0) + file.tokens);
}

function flavorSlices(totals: Totals): FlavorSlice[] {
  return FLAVORS
    .filter((flavor) => (totals.flavors.get(flavor) ?? 0) > 0)
    .map((flavor) => ({ flavor, tokens: totals.flavors.get(flavor)! }));
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
  /** Included totals per folder subtree. */
  subtree: Map<string, Totals>;
  /** Included totals for files sitting directly in a folder. */
  direct: Map<string, Totals>;
}

function aggregate(index: ScanIndex, request: ViewRequest): Aggregation {
  const categoryVisible = computeCategoryVisibility(index, request);
  const { excluded } = computeExclusions(index, request);
  const excludedDirectFiles = new Set(request.excludedDirectFiles);

  const included = new Uint8Array(index.files.length);
  for (const folder of index.folders) {
    const folderExcluded = excluded.has(folder.path);
    const directExcluded = folderExcluded || excludedDirectFiles.has(folder.path);
    if (directExcluded) continue;
    for (const fileIndex of folder.directFileIndices) {
      if (categoryVisible[fileIndex]) included[fileIndex] = 1;
    }
  }

  const direct = new Map<string, Totals>();
  const subtree = new Map<string, Totals>();
  const categoryCount = new Map<string, number>();

  // Bottom-up: a folder's subtree total is its direct files plus its children.
  for (let position = index.folders.length - 1; position >= 0; position -= 1) {
    const folder = index.folders[position]!;
    const directTotals = emptyTotals();
    for (const fileIndex of folder.directFileIndices) {
      if (included[fileIndex]) addFile(directTotals, index.files[fileIndex]!);
    }
    direct.set(folder.path, directTotals);

    const subtreeTotals = emptyTotals();
    mergeTotals(subtreeTotals, directTotals);
    let visibleBelow = 0;
    for (const fileIndex of folder.directFileIndices) {
      if (categoryVisible[fileIndex]) visibleBelow += 1;
    }
    for (const childPath of folder.childPaths) {
      const childTotals = subtree.get(childPath);
      if (childTotals) mergeTotals(subtreeTotals, childTotals);
      visibleBelow += categoryCount.get(childPath) ?? 0;
    }
    subtree.set(folder.path, subtreeTotals);
    categoryCount.set(folder.path, visibleBelow);
  }

  return { categoryVisible, included, categoryCount, subtree, direct };
}

function mergeTotals(target: Totals, source: Totals): void {
  target.tokens += source.tokens;
  target.lines += source.lines;
  target.codeLines += source.codeLines;
  target.commentLines += source.commentLines;
  target.files += source.files;
  for (const [flavor, tokens] of source.flavors) {
    target.flavors.set(flavor, (target.flavors.get(flavor) ?? 0) + tokens);
  }
}

/**
 * A folder's complete token weight, ignoring every active filter.
 *
 * Bars are normalised against this rather than against the visible total so
 * that switching a file kind on can only lengthen a bar. Normalising against
 * the filtered total would grow the denominator too, and a tile holding none
 * of the newly enabled kind would visibly shrink.
 */
function unfilteredTokens(index: ScanIndex, folderPath: string): number {
  const folder = index.folderByPath.get(folderPath);
  if (!folder) return 0;
  return index.tokenPrefix[folder.end]! - index.tokenPrefix[folder.start]!;
}

/** Token baseline the percentages are measured against: everything not generated. */
function projectBaseline(index: ScanIndex): number {
  let total = 0;
  for (const file of index.files) if (!file.generated) total += file.tokens;
  return total;
}

function buildTree(
  index: ScanIndex,
  request: ViewRequest,
  aggregation: Aggregation,
  exclusions: ExclusionState,
): TreeRow[] {
  const expanded = new Set(request.expanded);
  const queryActive = request.query.trim().length > 0;
  const excludedDirectFiles = new Set(request.excludedDirectFiles);
  const rows: TreeRow[] = [];

  const walk = (folder: FolderNode, depth: number, parentTotal: number): void => {
    if ((aggregation.categoryCount.get(folder.path) ?? 0) === 0) return;
    const totals = aggregation.subtree.get(folder.path) ?? emptyTotals();
    const directTotals = aggregation.direct.get(folder.path) ?? emptyTotals();
    const childFolders = folder.childPaths
      .map((childPath) => index.folderByPath.get(childPath))
      .filter((child): child is FolderNode => child !== undefined)
      .filter((child) => (aggregation.categoryCount.get(child.path) ?? 0) > 0);
    const hasVisibleDirectFiles = folder.directFileIndices.some((fileIndex) => aggregation.categoryVisible[fileIndex] === 1);
    const isExpanded = queryActive || expanded.has(folder.path);
    const folderTotal = unfilteredTokens(index, folder.path);

    rows.push({
      path: folder.path,
      name: folder.name,
      depth,
      rowKind: "folder",
      tokens: totals.tokens,
      shareOfParent: parentTotal > 0 ? Math.min(1, totals.tokens / parentTotal) : 0,
      hasChildren: childFolders.length > 0 || hasVisibleDirectFiles,
      expanded: isExpanded,
      included: !exclusions.excluded.has(folder.path),
      indeterminate: exclusions.indeterminate.has(folder.path),
      disabled: exclusions.disabled.has(folder.path),
      selected: request.selected.rowKind === "folder" && request.selected.path === folder.path,
    });

    if (!isExpanded) return;

    if (hasVisibleDirectFiles) {
      const folderExcluded = exclusions.excluded.has(folder.path);
      rows.push({
        path: folder.path,
        name: "(files)",
        depth: depth + 1,
        rowKind: "files",
        tokens: directTotals.tokens,
        shareOfParent: folderTotal > 0 ? Math.min(1, directTotals.tokens / folderTotal) : 0,
        hasChildren: false,
        expanded: false,
        included: !folderExcluded && !excludedDirectFiles.has(folder.path),
        indeterminate: false,
        disabled: folderExcluded,
        selected: request.selected.rowKind === "files" && request.selected.path === folder.path,
      });
    }

    for (const child of childFolders) walk(child, depth + 1, folderTotal);
  };

  const root = index.folderByPath.get("");
  if (root) walk(root, 0, unfilteredTokens(index, ""));
  return rows;
}

function buildFolderCard(
  name: string,
  folderPath: string | null,
  totals: Totals,
  baseline: number,
  scopeTotal: number,
): FolderCard {
  return {
    path: folderPath,
    name,
    tokens: totals.tokens,
    files: totals.files,
    shareOfProject: baseline > 0 ? totals.tokens / baseline : 0,
    shareOfParent: scopeTotal > 0 ? Math.min(1, totals.tokens / scopeTotal) : 0,
    flavors: flavorSlices(totals),
  };
}

function buildDetail(
  index: ScanIndex,
  request: ViewRequest,
  aggregation: Aggregation,
  baseline: number,
): DetailView {
  const folder = index.folderByPath.get(request.selected.path) ?? index.folderByPath.get("")!;
  const directFilesOnly = request.selected.rowKind === "files";
  const totals = directFilesOnly
    ? aggregation.direct.get(folder.path) ?? emptyTotals()
    : aggregation.subtree.get(folder.path) ?? emptyTotals();

  const scopeTotal = unfilteredTokens(index, folder.path);
  const cards: FolderCard[] = [];
  if (!directFilesOnly) {
    const children = folder.childPaths
      .map((childPath) => ({ node: index.folderByPath.get(childPath), totals: aggregation.subtree.get(childPath) }))
      .filter((entry): entry is { node: FolderNode; totals: Totals } => entry.node !== undefined && entry.totals !== undefined)
      .filter((entry) => entry.totals.files > 0)
      .sort((left, right) => right.totals.tokens - left.totals.tokens);

    // Showing the aggregate tile costs a slot, so it only pays for itself when
    // it stands in for more than one folder.
    const limit = request.cardLimit;
    if (children.length > limit) {
      const shown = limit - 1;
      for (const entry of children.slice(0, shown)) {
        cards.push(buildFolderCard(entry.node.name, entry.node.path, entry.totals, baseline, scopeTotal));
      }
      const rest = emptyTotals();
      for (const entry of children.slice(shown)) mergeTotals(rest, entry.totals);
      cards.push(buildFolderCard(`${children.length - shown} more folders`, null, rest, baseline, scopeTotal));
    } else {
      for (const entry of children) {
        cards.push(buildFolderCard(entry.node.name, entry.node.path, entry.totals, baseline, scopeTotal));
      }
    }
  }

  const directFiles = folder.directFileIndices
    .filter((fileIndex) => aggregation.included[fileIndex] === 1)
    .map((fileIndex) => index.files[fileIndex]!)
    .sort((left, right) => right.tokens - left.tokens);

  return {
    title: directFilesOnly ? "(files)" : folder.name,
    breadcrumb: `${folder.path || index.meta.rootName}${directFilesOnly ? "/(files)" : ""}`,
    tokens: totals.tokens,
    files: totals.files,
    lines: totals.lines,
    codeLines: totals.codeLines,
    commentLines: totals.commentLines,
    shareOfProject: baseline > 0 ? totals.tokens / baseline : 0,
    cards,
    directFiles,
    directFileCount: directFiles.length,
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
  const positions = directFilesOnly
    ? folder.directFileIndices
    : Array.from({ length: folder.end - folder.start }, (_unused, offset) => folder.start + offset);

  const matches: FileRow[] = [];
  for (const position of positions) {
    if (aggregation.included[position] !== 1) continue;
    const file = index.files[position]!;
    if (file.tokens < request.rank.minTokens) continue;
    matches.push(file);
  }
  matches.sort(
    (left, right) =>
      right[metric] - left[metric] ||
      right.tokens - left.tokens ||
      left.path.localeCompare(right.path),
  );
  return { rows: matches.slice(0, Math.max(0, request.rank.limit)), total: matches.length };
}

function buildSummary(index: ScanIndex, aggregation: Aggregation, baseline: number): SummaryView {
  const rootTotals = aggregation.subtree.get("") ?? emptyTotals();
  const root = index.folderByPath.get("");
  const ribbon: FolderCard[] = [];
  if (root) {
    const children = root.childPaths
      .map((childPath) => ({ node: index.folderByPath.get(childPath), totals: aggregation.subtree.get(childPath) }))
      .filter((entry): entry is { node: FolderNode; totals: Totals } => entry.node !== undefined && entry.totals !== undefined)
      .filter((entry) => entry.totals.tokens > 0)
      .sort((left, right) => right.totals.tokens - left.totals.tokens);
    for (const entry of children) {
      ribbon.push(buildFolderCard(entry.node.name, entry.node.path, entry.totals, baseline, unfilteredTokens(index, "")));
    }
    const rootDirect = aggregation.direct.get("") ?? emptyTotals();
    if (rootDirect.tokens > 0) {
      ribbon.push(buildFolderCard("(files)", null, rootDirect, baseline, unfilteredTokens(index, "")));
    }
  }
  return {
    projectTokens: baseline,
    selectedTokens: rootTotals.tokens,
    selectedFiles: rootTotals.files,
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
  const aggregation = aggregate(index, request);
  const exclusions = computeExclusions(index, request);
  const baseline = projectBaseline(index);
  const ranked = rankFiles(index, request, aggregation);
  return {
    meta: index.meta,
    summary: buildSummary(index, aggregation, baseline),
    tree: buildTree(index, request, aggregation, exclusions),
    detail: buildDetail(index, request, aggregation, baseline),
    ranked: ranked.rows,
    rankedTotal: ranked.total,
    rankScope: rankScopeLabel(index, request),
    expandableFolderPaths: index.folders
      .filter((folder) => (aggregation.categoryCount.get(folder.path) ?? 0) > 0)
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
  return {
    kinds: stringArray(raw["kinds"]) as ViewRequest["kinds"],
    showGenerated: raw["showGenerated"] === true,
    query: typeof raw["query"] === "string" ? raw["query"] : "",
    excludedFolders: stringArray(raw["excludedFolders"]),
    excludedDirectFiles: stringArray(raw["excludedDirectFiles"]),
    expanded: stringArray(raw["expanded"]),
    selected: {
      rowKind: selected["rowKind"] === "files" ? "files" : "folder",
      path: typeof selected["path"] === "string" ? selected["path"] : "",
    },
    rank: {
      metric,
      minTokens: Number.isFinite(rank["minTokens"]) ? Math.max(0, Number(rank["minTokens"])) : 0,
      limit: Number.isFinite(rank["limit"]) ? Math.min(1000, Math.max(1, Number(rank["limit"]))) : 100,
    },
    cardLimit: Number.isFinite(raw["cardLimit"])
      ? Math.min(MAX_FOLDER_CARDS, Math.max(MIN_FOLDER_CARDS, Math.trunc(Number(raw["cardLimit"]))))
      : 6,
  };
}
