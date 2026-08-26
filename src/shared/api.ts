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
 * The quantity every total, bar, and ranking is expressed in.
 *
 * This is orthogonal to the filters: it changes the unit, never which files are
 * counted. Each name is also a numeric `FileRow` field, so a measure is applied
 * by indexing a row rather than by a switch statement.
 */
export type Measure = "tokens" | "lines" | "codeLines";

export const MEASURES: readonly Measure[] = ["tokens", "lines", "codeLines"];

export type RankMetric =
  | "tokens"
  | "lines"
  | "codeLines"
  | "commentLines"
  | "functions"
  | "classes"
  | "branches";

export const RANK_METRICS: readonly RankMetric[] = [
  "tokens", "lines", "codeLines", "commentLines", "functions", "classes", "branches",
];

/** One measured file. Paths are POSIX-style and relative to the scan root. */
export interface FileRow {
  path: string;
  name: string;
  kind: FileKind;
  generated: boolean;
  tokens: number;
  /** Lines with content: code plus comment, excluding blank lines. */
  lines: number;
  /** Non-blank lines that are not comment-only. */
  codeLines: number;
  /** Non-blank lines whose entire content is comment. */
  commentLines: number;
  blankLines: number;
  functions: number;
  classes: number;
  branches: number;
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
  /** Subtree total in the active measure. */
  weight: number;
  /** 0-1 share of the active drill scope's unfiltered weight. */
  shareOfScope: number;
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
  /** Folder total in the active measure. */
  weight: number;
  files: number;
  shareOfProject: number;
  /** 0-1 share of the active drill scope's unfiltered weight. */
  shareOfScope: number;
  flavors: FlavorSlice[];
}

export interface FlavorSlice {
  flavor: Flavor;
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
  /** Folder total in the active measure. */
  weight: number;
  files: number;
  tokens: number;
  lines: number;
  codeLines: number;
  commentLines: number;
  shareOfProject: number;
  /** 0-1 share of the active drill scope's unfiltered weight. */
  shareOfScope: number;
  cards: FolderCard[];
  /** Fixed column capacity measured from the panel width. */
  cardColumns: number;
  directFiles: FileRow[];
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
  selectedFiles: number;
  selectedTokens: number;
  selectedLines: number;
  selectedCodeLines: number;
  selectedCommentLines: number;
  /** Top-level segments of the drill scope's proportion ribbon. */
  ribbon: FolderCard[];
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
  /** Whether the file list came from `git ls-files`. */
  gitTracked: boolean;
  /** Whether `.gitignore` rules were applied to the file list. */
  respectsGitignore: boolean;
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
  showGenerated: boolean;
  query: string;
  excludedFolders: string[];
  excludedDirectFiles: string[];
  expanded: string[];
  treeSort: TreeSort;
  /** Folder that replaces the project root in the main workspace widgets. */
  drillPath: string;
  selected: { rowKind: "folder" | "files"; path: string };
  /** `minWeight` is a floor in the active measure, not always in tokens. */
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
   * The measure these figures are in.
   *
   * Echoed rather than assumed, so a label never disagrees with the numbers
   * beside it while a newer request is still in flight.
   */
  measure: Measure;
  summary: SummaryView;
  tree: TreeRow[];
  detail: DetailView;
  ranked: FileRow[];
  /** Total matches before `rank.limit` was applied. */
  rankedTotal: number;
  /** The subtree the ranking covers, for labelling the panel. */
  rankScope: string;
  /** Every folder the current filters leave visible, so the client can expand all. */
  expandableFolderPaths: string[];
}

/** Replace the scan root while retaining the caller's display preferences. */
export interface OpenRootRequest {
  /** Absolute directory path on the machine running the Slopsplorer server. */
  root: string;
  view: ViewRequest;
}

export interface SourceResponse {
  path: string;
  content: string;
  truncated: boolean;
  totalBytes: number;
  language: string | null;
}

/** Instructions for installing the bundled agent skill, resolved by the server. */
export interface SkillInstallResponse {
  skillName: string;
  /** Copy-pasteable shell command that performs the install. */
  command: string;
  /** Canonical install location, shared across agent tools. */
  targetPath: string;
  /** Symlink pointing at `targetPath` for Claude Code's user-level skills. */
  linkPath: string;
}
