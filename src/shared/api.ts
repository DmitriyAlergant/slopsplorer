/**
 * Wire contract between the scanner/server and the browser client.
 *
 * The server owns every aggregation. The client sends the scope it wants to
 * look at and renders exactly what comes back, so a large repository never
 * ships its full file list to the browser.
 */

export type FileKind = "code" | "test" | "text" | "i18n" | "data" | "other";

/** A file kind, or `generated` — which overrides kind for display purposes. */
export type Flavor = FileKind | "generated";

export const FILE_KINDS: readonly FileKind[] = ["code", "test", "text", "i18n", "data", "other"];

export const FLAVORS: readonly Flavor[] = [...FILE_KINDS, "generated"];

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
  bytes: number;
  functions: number;
  classes: number;
  branches: number;
  /** tree-sitter grammar used for structure metrics, or null when unparsed. */
  language: string | null;
}

/** One rendered row of the source tree, already filtered and aggregated. */
export interface TreeRow {
  /** Folder path; `""` is the scan root. */
  path: string;
  name: string;
  depth: number;
  /** `files` is the pseudo-row grouping files sitting directly in a folder. */
  rowKind: "folder" | "files";
  tokens: number;
  /** 0–1 share of the parent row's tokens, for the inline mass bar. */
  shareOfParent: number;
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
  tokens: number;
  files: number;
  shareOfProject: number;
  shareOfParent: number;
  flavors: FlavorSlice[];
}

export interface FlavorSlice {
  flavor: Flavor;
  tokens: number;
}

export interface DetailView {
  title: string;
  breadcrumb: string;
  tokens: number;
  files: number;
  lines: number;
  codeLines: number;
  commentLines: number;
  shareOfProject: number;
  cards: FolderCard[];
  directFiles: FileRow[];
  directFileCount: number;
}

export interface SummaryView {
  projectTokens: number;
  selectedTokens: number;
  selectedFiles: number;
  selectedLines: number;
  selectedCodeLines: number;
  selectedCommentLines: number;
  /** Top-level segments of the whole-project proportion ribbon. */
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
  showGenerated: boolean;
  query: string;
  excludedFolders: string[];
  excludedDirectFiles: string[];
  expanded: string[];
  selected: { rowKind: "folder" | "files"; path: string };
  rank: { metric: RankMetric; minTokens: number; limit: number };
}

export interface ViewResponse {
  meta: ScanMeta;
  summary: SummaryView;
  tree: TreeRow[];
  detail: DetailView;
  ranked: FileRow[];
  /** Total matches before `rank.limit` was applied. */
  rankedTotal: number;
  /** Every folder the current filters leave visible, so the client can expand all. */
  expandableFolderPaths: string[];
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
