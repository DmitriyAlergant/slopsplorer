/**
 * Wire contract between the scanner/server and the browser client.
 *
 * The server owns every aggregation. The client sends the scope it wants to
 * look at and renders exactly what comes back, so a large repository never
 * ships its full file list to the browser.
 */

export type FileKind = "code" | "test" | "text" | "i18n" | "data" | "other";

/** A file kind, or `generated` - which overrides kind for display purposes. */
export type Flavor = FileKind | "generated";

export const FILE_KINDS: readonly FileKind[] = ["code", "test", "text", "i18n", "data", "other"];

export const FLAVORS: readonly Flavor[] = [...FILE_KINDS, "generated"];

export type TreeSort = "name" | "weight";

export const TREE_SORTS: readonly TreeSort[] = ["name", "weight"];

/**
 * What a comparison did to one file.
 *
 * `unchanged` exists because a scan is the degenerate diff: every file is
 * present and nothing moved, so one status field describes both producers.
 */
export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "unchanged";

export const CHANGE_STATUSES: readonly ChangeStatus[] = [
  "added", "modified", "deleted", "renamed", "unchanged",
];

/**
 * The quantity every total, bar, and ranking is expressed in.
 *
 * This is orthogonal to the filters: it changes the unit, never which files are
 * counted. A measure names a numeric `FileRow` field once it is paired with an
 * aspect, so applying one is an index expression rather than a switch.
 */
export type Measure = "tokens" | "lines" | "codeLines";

export const MEASURES: readonly Measure[] = ["tokens", "lines", "codeLines"];

/**
 * Which side of a change the measure describes.
 *
 * A scanned file has one content, so only `after` means anything. A changed
 * file has two, and every measure splits into what the change added and what
 * it removed. Churn is their sum and is never negative; net is their
 * difference and is signed.
 */
export type Aspect = "added" | "removed" | "churn" | "net" | "after";

/**
 * Ordered as the change reads: what it put in, what it took out, what that
 * leaves, what it cost, and what the file is now.
 *
 * The switch in the filter bar and the aspect columns of the file tables both
 * follow this order, so the page presents the five sides in one order only.
 */
export const ASPECTS: readonly Aspect[] = ["added", "removed", "net", "churn", "after"];

/**
 * A numeric `FileRow` field a weight can be read from.
 *
 * Every name appears whole here and whole in `FileRow`, so one search finds
 * both. `weightField` is the only way to reach one, and it never assembles a
 * name from fragments.
 */
export type WeightField =
  | "tokens" | "lines" | "codeLines"
  | "addedTokens" | "removedTokens" | "churnTokens" | "netTokens"
  | "addedLines" | "removedLines" | "churnLines" | "netLines"
  | "addedCodeLines" | "removedCodeLines" | "churnCodeLines" | "netCodeLines";

const WEIGHT_FIELDS: Readonly<Record<Measure, Readonly<Record<Aspect, WeightField>>>> = {
  tokens: {
    added: "addedTokens", removed: "removedTokens", churn: "churnTokens", net: "netTokens", after: "tokens",
  },
  lines: {
    added: "addedLines", removed: "removedLines", churn: "churnLines", net: "netLines", after: "lines",
  },
  codeLines: {
    added: "addedCodeLines", removed: "removedCodeLines", churn: "churnCodeLines", net: "netCodeLines", after: "codeLines",
  },
};

/** The `FileRow` field one measure and one aspect resolve to. */
export function weightField(measure: Measure, aspect: Aspect): WeightField {
  return WEIGHT_FIELDS[measure][aspect];
}

/**
 * The two sides of a change, and the after-image in each measure.
 *
 * `DetailView` and `SummaryView` both carry these, which is what lets one
 * function state every aspect of either of them.
 */
export interface MeasuredSides {
  added: number;
  removed: number;
  tokens: number;
  lines: number;
  codeLines: number;
}

/**
 * Every aspect figure of one scope, in one measure.
 *
 * The two identities in the `Aspect` docstring are applied here and nowhere
 * else, so a strip that states all five sides at once cannot disagree with the
 * server about what net and churn are.
 */
export function aspectTotals(sides: MeasuredSides, measure: Measure): Record<Aspect, number> {
  return {
    added: sides.added,
    removed: sides.removed,
    net: sides.added - sides.removed,
    churn: sides.added + sides.removed,
    after: sides[measure],
  };
}

/** Every weight field, so the scanner can build one prefix sum for each. */
export const WEIGHT_FIELD_NAMES: readonly WeightField[] =
  MEASURES.flatMap((measure) => ASPECTS.map((aspect) => weightField(measure, aspect)));

/**
 * A sortable column of the file tables.
 *
 * Every metric here is a column both tables draw in the mode it belongs to,
 * and every numeric column they draw is a metric here. Sorting is the only way
 * to choose one, so a metric without a column would be unreachable.
 *
 * The aspect names are the diff-mode columns: their unit is the active measure,
 * so sorting one chooses the aspect the way sorting `tokens` chooses a measure.
 */
export type RankMetric =
  | "tokens"
  | "lines"
  | "codeLines"
  | "commentLines"
  | "functions"
  | "branches"
  | Aspect;

/** Columns a scan draws. Every one is a plain numeric field of `FileRow`. */
export const SCAN_RANK_METRICS: readonly RankMetric[] = [
  "tokens", "lines", "codeLines", "commentLines", "functions", "branches",
];

/** Columns a diff draws. The five aspect columns are `ASPECTS`, in its order. */
export const DIFF_RANK_METRICS: readonly RankMetric[] = [
  ...ASPECTS, "functions", "branches",
];

export const RANK_METRICS: readonly RankMetric[] = [...SCAN_RANK_METRICS, ...ASPECTS];

/** Which columns a table draws, decided by the producer of the index. */
export function rankMetricsFor(isDiff: boolean): readonly RankMetric[] {
  return isDiff ? DIFF_RANK_METRICS : SCAN_RANK_METRICS;
}

/**
 * What a table sorts by when the request names a column this mode cannot draw.
 *
 * Named rather than taken from the head of the column list, so reordering the
 * columns cannot quietly move the column every fresh page opens on. A diff
 * opens on net, which is the question a reader brings to a change: what does
 * this branch leave behind.
 */
export function defaultRankMetric(isDiff: boolean): RankMetric {
  return isDiff ? "net" : "tokens";
}

/** The aspect a diff column names, or `null` for a plain field column. */
export function aspectOfMetric(metric: RankMetric): Aspect | null {
  return ASPECTS.find((aspect) => aspect === metric) ?? null;
}

/**
 * One measured file. Paths are POSIX-style and relative to the scan root.
 *
 * A scan fills the after-image fields and leaves every diff field at zero,
 * which is exactly true of a file nothing changed. The fields are required
 * rather than optional so that `row[field]` is always a number and no reader
 * has to guard an index expression.
 */
export interface FileRow {
  path: string;
  name: string;
  kind: FileKind;
  generated: boolean;
  /** What the comparison did to this file. `unchanged` in a scan. */
  status: ChangeStatus;
  /** Where a renamed file came from, or `null`. */
  previousPath: string | null;
  tokens: number;
  /** Lines with content: code plus comment, excluding blank lines. */
  lines: number;
  /** Non-blank lines that are not comment-only. */
  codeLines: number;
  /** Non-blank lines whose entire content is comment. */
  commentLines: number;
  blankLines: number;
  addedTokens: number;
  removedTokens: number;
  churnTokens: number;
  netTokens: number;
  addedLines: number;
  removedLines: number;
  churnLines: number;
  netLines: number;
  addedCodeLines: number;
  removedCodeLines: number;
  churnCodeLines: number;
  netCodeLines: number;
  addedCommentLines: number;
  removedCommentLines: number;
  /** Physical lines the change touched, blank ones included. Matches `git diff --numstat`. */
  addedPhysicalLines: number;
  removedPhysicalLines: number;
  /** After-image structure counts. A whole-file fact, so it never splits by aspect. */
  functions: number;
  classes: number;
  branches: number;
  /** Before-image structure counts, so a row can state what the change did to them. */
  beforeFunctions: number;
  beforeClasses: number;
  beforeBranches: number;
  /** tree-sitter grammar used for structure metrics, or null when unparsed. */
  language: string | null;
}

/** One rendered row of the source tree, already filtered and aggregated. */
export interface TreeRow {
  /** Folder path. `""` is the scan root. */
  path: string;
  name: string;
  depth: number;
  /** `files` is the pseudo-row grouping files sitting directly in a folder. */
  rowKind: "folder" | "files";
  /** Subtree total in the active measure and aspect. Signed when the aspect is `net`. */
  weight: number;
  /** Subtree total of what the change added, in the active measure. */
  added: number;
  /** Subtree total of what the change removed, in the active measure. Never negative. */
  removed: number;
  /** 0-1 share of the active drill scope's unfiltered weight. Magnitude only. */
  shareOfScope: number;
  /**
   * 0-1 lengths of the two halves of the row's centre-axis band.
   *
   * Every band divides one whole, the churn the filters leave in the scope, so
   * a length means the same wherever the row sits. That whole is the filtered
   * one rather than the unfiltered baseline the percentages use, because a
   * code-only view of a large repository would draw every band at under a pixel.
   */
  shareAdded: number;
  shareRemoved: number;
  hasChildren: boolean;
  expanded: boolean;
  included: boolean;
  indeterminate: boolean;
  disabled: boolean;
  selected: boolean;
}

/** A child folder summarised as a card, or the aggregate "other folders" tile. */
export interface FolderCard {
  /** null marks the aggregate tile, which is not navigable. */
  path: string | null;
  name: string;
  /** Folder total in the active measure and aspect. */
  weight: number;
  added: number;
  removed: number;
  files: number;
  /** 0-1 share of the drill scope as the filters leave it. Magnitude only. */
  shareOfScope: number;
  flavors: FlavorSlice[];
  /** How the change divides, for a diff. Empty for a scan. */
  statuses: StatusSlice[];
}

export interface FlavorSlice {
  flavor: Flavor;
  weight: number;
}

export interface StatusSlice {
  status: ChangeStatus;
  weight: number;
}

/** One navigable step of the folder heading's path. */
export interface PathCrumb {
  name: string;
  /** Folder path this step selects. `""` is the scan root. */
  path: string;
}

export interface DetailView {
  title: string;
  /**
   * Ancestors of the heading, nearest last, each one selectable.
   *
   * Sent as steps rather than as a joined string, so the client never has to
   * take a path apart to know where a segment leads.
   */
  trail: PathCrumb[];
  /** Folder total in the active measure and aspect. */
  weight: number;
  added: number;
  removed: number;
  files: number;
  tokens: number;
  lines: number;
  codeLines: number;
  churnTokens: number;
  churnLines: number;
  churnCodeLines: number;
  /**
   * 0-1 share of the drill scope as the filters leave it. Magnitude only.
   *
   * In the net aspect the whole is the scope's churn, because a signed quantity
   * cannot be its own whole. The page draws it there and states no figure from
   * it, so a length stays a length and never becomes a claim.
   */
  shareOfScope: number;
  cards: FolderCard[];
  /** Fixed column capacity measured from the panel width. */
  cardColumns: number;
}

export interface SummaryView {
  /** Unfiltered weight of the whole scanned tree, the fixed percentage baseline. */
  projectWeight: number;
  /**
   * Folder these figures describe, echoed from the request's drill path.
   *
   * `""` is the scan root. Echoed rather than assumed, so a label cannot name
   * one scope while the numbers beside it still describe another.
   */
  scopePath: string;
  /** Unfiltered weight of the drill scope, the denominator of "of scope". */
  scopeWeight: number;
  /** Drill-scope weight under the active visibility and inclusion switches. */
  selectedWeight: number;
  selectedAdded: number;
  selectedRemoved: number;
  selectedFiles: number;
  selectedTokens: number;
  selectedLines: number;
  selectedCodeLines: number;
  selectedChurnTokens: number;
  selectedChurnLines: number;
  selectedChurnCodeLines: number;
  /** Top-level segments of the drill scope's proportion ribbon. */
  ribbon: FolderCard[];
}

/** Where a scan's file list came from. A diff never runs a walk. */
export type FileSource = "git-index" | "walk-gitignore" | "walk-all" | "git-diff";

/** What a diff compared, resolved once and echoed on every response. */
export interface DiffMeta {
  /** How the comparison was named on the command line. */
  spec: string;
  /** What was asked for, so the picker opens on the comparison being drawn. */
  request: ComparisonRequest;
  /** Human label for the before side, such as a short commit or "HEAD". */
  base: string;
  /** Human label for the after side, such as "working tree" or a short commit. */
  target: string;
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  filesRenamed: number;
  /** Files whose line diff hit the size cap and therefore count as fully replaced. */
  cappedFiles: number;
}

export interface ScanMeta {
  rootPath: string;
  rootName: string;
  tokenizer: string;
  fileCount: number;
  folderCount: number;
  /** ISO-8601 timestamp of the scan that produced the current index. */
  scannedAt: string;
  durationMs: number;
  /** Where the file list came from. */
  fileSource: FileSource;
  /** What was compared, or `null` when the index is a plain scan. */
  diff: DiffMeta | null;
  /** Files skipped for exceeding the per-file byte ceiling. */
  skippedLargeFiles: number;
  /** Grammars that produced structure metrics in this scan. */
  languages: string[];
}

/** Everything the client controls, sent on every view request. */
export interface ViewRequest {
  kinds: FileKind[];
  /** Unit every aggregation is expressed in. Independent of every filter. */
  measure: Measure;
  /** Side of the change the unit describes. Ignored unless the index is a diff. */
  aspect: Aspect;
  showGenerated: boolean;
  query: string;
  excludedFolders: string[];
  excludedDirectFiles: string[];
  expanded: string[];
  treeSort: TreeSort;
  /** Folder that replaces the project root in the main workspace widgets. */
  drillPath: string;
  selected: { rowKind: "folder" | "files"; path: string };
  /**
   * The sorted column of both file tables, and the ranking's order.
   *
   * `minWeight` is a floor on the magnitude in the active measure and aspect,
   * not always in tokens.
   */
  rank: { metric: RankMetric; minWeight: number; limit: number };
  /**
   * How many tiles fit across the panel at its current width.
   *
   * The client measures this. The server decides the actual column count and
   * tile count from it, because only the server knows how many child folders
   * there are. Purely a layout concern, so it is not part of the linkable state.
   */
  cardColumns: number;
}

export interface ViewResponse {
  meta: ScanMeta;
  /**
   * The measure and aspect these figures are in.
   *
   * Echoed rather than assumed, so a label never disagrees with the numbers
   * beside it while a newer request is still in flight, and so a client cannot
   * draw a churn heading over a scan the server measured whole.
   */
  measure: Measure;
  aspect: Aspect;
  /** The sorted column the server actually applied, after clamping to the mode. */
  rankMetric: RankMetric;
  summary: SummaryView;
  tree: TreeRow[];
  detail: DetailView;
  /**
   * The folder panel's file list: every file of the selection, ranked.
   *
   * A folder selection covers its whole subtree, and a `.` selection covers the
   * files sitting directly in the folder. The panel draws these under the child
   * folder tiles, so the tiles and the rows divide one subject between them.
   */
  ranked: FileRow[];
  /** Total matches before `rank.limit` was applied. */
  rankedTotal: number;
  /** Every folder the current filters leave visible, so the client can expand all. */
  expandableFolderPaths: string[];
}

/** Replace the scan root while retaining the caller's display preferences. */
export interface OpenRootRequest {
  /** Absolute directory path on the machine running the Slopsplorer server. */
  root: string;
  view: ViewRequest;
}

/**
 * Two revisions, and which of the two ways they are compared.
 *
 * `revisionPair` is `git diff A B`. `mergeBase` is `git diff A...B`, which
 * compares B to where it left A, and is what a pull request shows.
 */
export type RevisionRange =
  | { kind: "revisionPair"; base: string; target: string }
  | { kind: "mergeBase"; base: string; target: string };

/**
 * What to compare, before it is resolved against a repository.
 *
 * The command line parses argument text into one of these, and the comparison
 * picker builds one directly, so neither has to write the other's grammar.
 */
export type ComparisonRequest =
  | { kind: "workingTree" }
  | { kind: "staged" }
  | { kind: "revisionToWorkingTree"; rev: string }
  | RevisionRange;

/** A ref the page can offer as a side of a comparison. */
export interface GitRef {
  /** Name as Git resolves it: `main`, `origin/main`, `v1.2.0`. */
  name: string;
  kind: "branch" | "remote" | "tag";
  /** Short commit the ref points at, so two names on one commit read as one place. */
  shortSha: string;
}

/** What the comparison picker builds a comparison from. */
export interface RepositoryRefs {
  /** Branch HEAD is on, or `null` when HEAD is detached. */
  headBranch: string | null;
  headSha: string;
  refs: GitRef[];
}

/** Replace the active comparison, keeping the repository and the preferences. */
export interface CompareRequest {
  comparison: ComparisonRequest;
  view: ViewRequest;
}

/** One line of one file's change, as the preview draws it. */
export interface DiffLine {
  marker: " " | "-" | "+";
  text: string;
  /** 1-based number on the base side, or null when the line was added. */
  beforeLine: number | null;
  /** 1-based number on the target side, or null when the line was removed. */
  afterLine: number | null;
}

interface SourceResponseBase {
  path: string;
  truncated: boolean;
  totalBytes: number;
  language: string | null;
}

/**
 * One file for the preview: its text in a scan, its change in a comparison.
 *
 * A compared file has two contents, so showing either one alone would be a
 * claim the page cannot support. It is sent whole rather than as hunks,
 * because the reader chooses whether to see the unchanged lines.
 */
export type SourceResponse =
  | (SourceResponseBase & { mode: "source"; content: string })
  | (SourceResponseBase & { mode: "diff"; lines: DiffLine[] });

/** One directory the install command writes a copy of the skill into. */
export interface SkillInstallTarget {
  /** The agent tool that reads the directory. */
  tool: string;
  path: string;
}

/** Instructions for installing the bundled agent skill, resolved by the server. */
export interface SkillInstallResponse {
  skillName: string;
  /** Copy-pasteable command, written for the shell of the machine the server runs on. */
  command: string;
  /** Every directory the command copies the skill into. */
  targets: SkillInstallTarget[];
}
