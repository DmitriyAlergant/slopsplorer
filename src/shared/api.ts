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

interface FileKindDetails {
  label: string;
  description: string;
}

/**
 * The words every surface uses for a flavor, and what each one holds.
 *
 * Beside the wire values they name, and shared for the same reason the unit
 * names are: the brief an ask sends has to call a flavor what the switch the
 * reader clicked calls it.
 */
export const FILE_KIND_DETAILS: Readonly<Record<FileKind, FileKindDetails>> = {
  code: { label: "Code", description: "Source and application code." },
  test: { label: "Tests", description: "Test code: source files in a test folder, plus anything named by a test convention. Fixtures keep the flavor of their own format." },
  text: { label: "Docs", description: "Markdown and other prose documentation." },
  i18n: { label: "i18n", description: "Translation catalogues and locale files, including source files that are almost entirely translated strings." },
  data: { label: "Data & Config", description: "Structured data and configuration formats such as JSON, YAML, TOML, XML, CSV, and dependency manifests, plus source files that are almost entirely string literals." },
  other: { label: "Other", description: "Scannable text files that do not fit another flavor, such as HTML." },
};

export type TreeSort = "name" | "weight";

export const TREE_SORTS: readonly TreeSort[] = ["name", "weight"];

/**
 * What a comparison did to one file.
 *
 * `unchanged` exists because a scan is the degenerate diff: every file is
 * present and nothing moved, so one status field describes both producers.
 */
export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "unchanged";

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

/**
 * How each measure is named in prose, in a heading, and in a tight cell.
 *
 * One table rather than three, so a new measure cannot arrive with a label
 * missing from one surface and present in another. Here rather than in the
 * client, because the page is not the only reader: the brief an ask hands to a
 * local agent has to name the unit exactly as the panel the reader sees does.
 */
const MEASURE_NAMES: Record<Measure, { prose: string; heading: string; abbreviation: string }> = {
  tokens: { prose: "tokens", heading: "Tokens", abbreviation: "tok" },
  lines: { prose: "lines", heading: "Lines", abbreviation: "lines" },
  codeLines: { prose: "LOC", heading: "LOC", abbreviation: "LOC" },
};

/** Title-case name for a control, a button, or a column heading. */
export function measureHeading(measure: Measure): string {
  return MEASURE_NAMES[measure].heading;
}

/** Shortest form, for a tile caption where the number matters more than the unit. */
export function measureAbbreviation(measure: Measure): string {
  return MEASURE_NAMES[measure].abbreviation;
}

/**
 * How each aspect is named beside a unit and explained in the menu.
 *
 * One table for all three surfaces, so a new aspect cannot arrive with a label
 * on one of them and nothing on the others.
 */
const ASPECT_NAMES: Record<Aspect, { heading: string; prose: string; description: string }> = {
  churn: {
    heading: "Churn",
    prose: "churn",
    description: "Added plus removed. The volume of the change, and never negative.",
  },
  net: {
    heading: "Net",
    prose: "net",
    description: "Added minus removed. What the change leaves behind, and signed.",
  },
  added: { heading: "Added", prose: "added", description: "Only the lines the change introduced." },
  removed: { heading: "Removed", prose: "removed", description: "Only the lines the change took away." },
  after: {
    heading: "After",
    prose: "after",
    description: "The whole file as the change leaves it, the same figure a scan reports.",
  },
};

export function aspectHeading(aspect: Aspect): string {
  return ASPECT_NAMES[aspect].heading;
}

export function aspectDescription(aspect: Aspect): string {
  return ASPECT_NAMES[aspect].description;
}

/**
 * Name the numbers column, which is one unit in a scan and a unit and a side
 * in a diff.
 */
export function weightHeading(measure: Measure, aspect: Aspect, isDiff: boolean): string {
  return isDiff
    ? `${ASPECT_NAMES[aspect].heading} ${MEASURE_NAMES[measure].abbreviation}`
    : MEASURE_NAMES[measure].heading;
}

/** Name for running text: "42,000 churn tokens", "1,200 LOC". */
export function weightName(measure: Measure, aspect: Aspect, isDiff: boolean): string {
  return isDiff && aspect !== "after"
    ? `${ASPECT_NAMES[aspect].prose} ${MEASURE_NAMES[measure].prose}`
    : MEASURE_NAMES[measure].prose;
}

/**
 * Shortest form that still says which side it is: "net tok", "removed lines".
 *
 * A tile states one figure, and the switch that chose it is at the top of the
 * page, so the figure has to name its own side or it means nothing on its own.
 */
export function weightAbbreviation(measure: Measure, aspect: Aspect, isDiff: boolean): string {
  return isDiff
    ? `${ASPECT_NAMES[aspect].prose} ${MEASURE_NAMES[measure].abbreviation}`
    : MEASURE_NAMES[measure].abbreviation;
}

/** Every weight field, so the scanner can build one prefix sum for each. */
export const WEIGHT_FIELD_NAMES: readonly WeightField[] =
  MEASURES.flatMap((measure) => ASPECTS.map((aspect) => weightField(measure, aspect)));

/**
 * A sortable column of the file tables.
 *
 * Every metric here is a column both tables draw in the mode it belongs to,
 * and every column they draw is a metric here. Sorting is the only way to
 * choose one, so a metric without a column would be unreachable.
 *
 * `name` is the file column, the one metric that is not a quantity. It orders
 * the rows A to Z, and it never decides which rows a curtailed list holds.
 *
 * The aspect names are the diff-mode columns: their unit is the active measure,
 * so sorting one chooses the aspect the way sorting `tokens` chooses a measure.
 */
export type RankMetric =
  | "name"
  | "tokens"
  | "lines"
  | "codeLines"
  | "commentLines"
  | "functions"
  | "branches"
  | Aspect;

/** Every sortable column that holds a figure, which is all of them but the file name. */
export type MeasuredMetric = Exclude<RankMetric, "name">;

/** Columns a scan draws. Every one is a plain numeric field of `FileRow`. */
export const SCAN_RANK_METRICS: readonly MeasuredMetric[] = [
  "tokens", "lines", "codeLines", "commentLines", "functions", "branches",
];

/** Columns a diff draws. The five aspect columns are `ASPECTS`, in its order. */
export const DIFF_RANK_METRICS: readonly MeasuredMetric[] = [
  ...ASPECTS, "functions", "branches",
];

export const RANK_METRICS: readonly RankMetric[] = ["name", ...SCAN_RANK_METRICS, ...ASPECTS];

/** Which measured columns a table draws, decided by the producer of the index. */
export function rankMetricsFor(isDiff: boolean): readonly MeasuredMetric[] {
  return isDiff ? DIFF_RANK_METRICS : SCAN_RANK_METRICS;
}

/**
 * Every column a table can be sorted on in this mode.
 *
 * The file column stands in both modes and holds no figure, so it is not in
 * either list of measured columns and is named here instead.
 */
export function sortMetricsFor(isDiff: boolean): readonly RankMetric[] {
  return ["name", ...rankMetricsFor(isDiff)];
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

/**
 * What a row, a tile, or a selection names.
 *
 * `files` is the pseudo-row grouping the files that sit directly in a folder,
 * which the tree, the tiles, and the ribbon all draw as `.`.
 */
export type RowKind = "folder" | "files";

/**
 * How much of the selected folder the file list holds.
 *
 * Only the list moves. The tiles, the headline figures, and the tree keep
 * describing the whole selection, so this answers "what sits here" without
 * making the reader leave the subtree the panel is about.
 */
export type FileScope = "folder" | "subtree";

/** Narrow first, then wide, which is the order the switch that sets it reads. */
export const FILE_SCOPES: readonly FileScope[] = ["folder", "subtree"];

/** One rendered row of the source tree, already filtered and aggregated. */
export interface TreeRow {
  /** Folder path. `""` is the scan root. */
  path: string;
  name: string;
  depth: number;
  rowKind: RowKind;
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

/**
 * One part of a folder as a card: a child folder, its own files, or the
 * aggregate tile that holds whatever did not fit the row.
 */
export interface FolderCard {
  /** null marks the aggregate tile, which is not navigable. */
  path: string | null;
  name: string;
  /** What the card names, and what selecting it selects. */
  rowKind: RowKind;
  /** Folder total in the active measure and aspect. */
  weight: number;
  added: number;
  removed: number;
  files: number;
  /** 0-1 share of the drill scope as the filters leave it. Magnitude only. */
  shareOfScope: number;
  /** What the folder is made of. Magnitudes, against `DetailView.flavorBaseline`. */
  flavors: FlavorSlice[];
}

/**
 * One flavor's part of a folder, in the active measure and aspect.
 *
 * Generated files are never in one: the bar these draw states what the source
 * of a folder is made of, and a lockfile is not part of that answer.
 */
export interface FlavorSlice {
  flavor: FileKind;
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
  /**
   * The whole every tile's bar divides, so all the tiles share one scale.
   *
   * The drill scope as the tree's own checkboxes and the path filter leave it,
   * with every flavor in it and generated files out of it. The flavor chips
   * are deliberately not applied: they take slices out of the bars, so turning
   * one off shortens every bar rather than stretching the rest to fill it.
   */
  flavorBaseline: number;
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

/** The review page a static snapshot can return its reader to. */
export interface SnapshotBacklink {
  label: string;
  url: string;
}

/** Data embedded in the static entry page before its client starts. */
export interface SnapshotContext {
  backlink: SnapshotBacklink | null;
}

/** Bounds on the tile row, applied by the panel that measures it and by the server. */
export const MIN_CARD_COLUMNS = 1;
export const MAX_CARD_COLUMNS = 6;

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
  selected: { rowKind: RowKind; path: string };
  /** How much of the selection the file list holds. A `.` selection is its own files already. */
  fileScope: FileScope;
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
   * The client measures this and holds it to {@link MIN_CARD_COLUMNS} and
   * {@link MAX_CARD_COLUMNS}, and the server holds an untrusted body to the
   * same pair. The server decides the actual column and tile count from it,
   * because only the server knows how many child folders there are. Purely a
   * layout concern, so it is not part of the linkable state.
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

/**
 * One commit of a comparison's spine, and what it changed.
 *
 * The figures are the commit against its own first parent, with generated
 * files left out and no filter applied, because the spine is the frame a
 * review happens inside and has to state the same thing however the page
 * below it is narrowed. Every field is named as `FileRow` names it, so one
 * search finds both.
 */
export interface SpineEntry {
  sha: string;
  shortSha: string;
  /**
   * First parent, and Git's empty tree for a commit that has none.
   *
   * It is the side the row's figures were measured against, and it is the base
   * a span starting at this commit compares from, so the band and the page it
   * opens can never describe different changes.
   */
  parent: string;
  subject: string;
  /** The message under the subject, trimmed. Empty when the commit has none. */
  body: string;
  /** Where the commit can be read on the forge, or `null` when there is none. */
  url: string | null;
  author: string;
  /** ISO-8601 author date. */
  date: string;
  /** Files the commit changed, generated ones left out. */
  files: number;
  addedTokens: number;
  removedTokens: number;
  addedLines: number;
  removedLines: number;
  addedCodeLines: number;
  removedCodeLines: number;
}

/**
 * The commits a comparison spans, oldest first.
 *
 * A span over this list is a comparison of its own, which is how one control
 * covers the whole change, one commit, and any run of commits between them.
 */
export interface CommitSpine {
  /** The comparison this spine was built for, so the page can return to it whole. */
  range: ComparisonRequest;
  commits: SpineEntry[];
  /** Commits the range holds beyond the ones listed. */
  omitted: number;
}

/** A run of commits inside a spine, by index, both ends included. */
export interface Span {
  start: number;
  end: number;
}

/**
 * Every field of a comparison in one string.
 *
 * A revision name holds no space, so the kind and its revisions read back
 * unambiguously. Written as one value, so comparing two comparisons needs no
 * cast to reach the fields only one of the five branches has.
 */
function comparisonKey(request: ComparisonRequest): string {
  switch (request.kind) {
    case "workingTree": case "staged": return request.kind;
    case "revisionToWorkingTree": return `${request.kind} ${request.rev}`;
    case "revisionPair": case "mergeBase": return `${request.kind} ${request.base} ${request.target}`;
  }
}

/** Whether two requests name the same comparison. */
export function sameComparisonRequest(one: ComparisonRequest, other: ComparisonRequest): boolean {
  return comparisonKey(one) === comparisonKey(other);
}

/**
 * The comparison a span asks for.
 *
 * A span compares from the parent of the commit it starts at, so one control
 * expresses a single commit, a run of them, and everything from the start of
 * the range, without a mode to switch between them. The parent rather than the
 * commit listed before it: a range holds every commit a merge brought in, so
 * the list is not always a chain, and the neighbour of a merged-in commit is on
 * another line of history.
 */
export function requestForSpan(spine: CommitSpine, span: Span): ComparisonRequest {
  return {
    kind: "revisionPair",
    base: spine.commits[span.start]!.parent,
    target: spine.commits[span.end]!.sha,
  };
}

/**
 * Whether every commit of a run follows the one before it.
 *
 * A run that crosses a break is not a comparison of what it selects: its two
 * endpoints sit on different lines of history, so the change between them holds
 * everything the other line carried. Only a chain is offered, which is why a
 * drag stops at a break and a window will not step over one.
 */
export function chainedSpan(spine: CommitSpine, span: Span): boolean {
  for (let index = span.start + 1; index <= span.end; index += 1) {
    if (spine.commits[index]!.parent !== spine.commits[index - 1]!.sha) return false;
  }
  return true;
}

/**
 * The span a comparison is, or `null` when it is not one of this spine's.
 *
 * The whole range is not a span: it is the range itself, so a spine whose list
 * was capped, or whose target is a merge, never claims to cover more than it
 * lists.
 */
export function spanOf(spine: CommitSpine, request: ComparisonRequest): Span | null {
  if (request.kind !== "revisionPair") return null;
  const end = spine.commits.findIndex((commit) => commit.sha === request.target);
  if (end < 0) return null;
  const start = spine.commits.findIndex((commit) => commit.parent === request.base);
  if (start < 0 || start > end) return null;
  const span = { start, end };
  return chainedSpan(spine, span) ? span : null;
}

/**
 * Whether a comparison is still inside the range this spine was built for.
 *
 * Both sides ask this. The page asks it to keep the band it is drawing, and the
 * server asks it so that a reload in the middle of a walk still answers with
 * the range being reviewed rather than with the one commit that is open.
 */
export function spansRequest(spine: CommitSpine, request: ComparisonRequest): boolean {
  return sameComparisonRequest(request, spine.range) || spanOf(spine, request) !== null;
}

/**
 * Slide a span by whole commits, keeping its width.
 *
 * `null` when it cannot move that far, which is also what disables the step
 * that would do it. One control steps a single commit and slides a window,
 * because a window of one is a single commit.
 */
export function slideSpan(spine: CommitSpine, span: Span, delta: number): Span | null {
  const width = span.end - span.start;
  const start = span.start + delta;
  if (start < 0 || start + width > spine.commits.length - 1) return null;
  const next = { start, end: start + width };
  return chainedSpan(spine, next) ? next : null;
}

/**
 * Extend a span from its anchor to a commit, which is what a shift-click asks
 * for, and stop it at the first break in the chain.
 */
export function spanBetween(spine: CommitSpine, anchor: number, reached: number): Span {
  const step = reached < anchor ? -1 : 1;
  let end = anchor;
  while (end !== reached) {
    const next = end + step;
    const child = step > 0 ? next : end;
    if (spine.commits[child]!.parent !== spine.commits[child - 1]!.sha) break;
    end = next;
  }
  return anchor <= end ? { start: anchor, end } : { start: end, end: anchor };
}

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

/**
 * One `data/sources/<index>.json` record of a static snapshot.
 *
 * A file the exporter could not read is stored as the same refusal the live
 * source route would send, so one unreadable file never blocks an export
 * and its preview fails on the page exactly as it would against the server.
 */
export type SnapshotSourceRecord = SourceResponse | { error: string };

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

/**
 * A coding agent installed on this machine, and what its sign-in probe said.
 *
 * The page offers what the host proved it can run. A tool that reports no
 * sign-in is still offered, marked, and askable: the probe reads what the tool
 * says about itself, and the reader is the one who knows whether it is right.
 */
export interface AgentTool {
  /** Stable name of the tool, also the id an ask names. */
  id: string;
  /** How the tool calls itself, for the menu. */
  label: string;
  /** Whether the tool reported that it can reach a model. */
  signedIn: boolean;
}

export interface AgentsResponse {
  agents: AgentTool[];
}

/** Ask one of the discovered agents a question about what the page is showing. */
export interface AskRequest {
  agentId: string;
  /**
   * The reader's own question. May be empty.
   *
   * The brief alone already names a subject, so an empty question asks the
   * agent to describe what the reader is looking at.
   */
  question: string;
  /** The state of the page, which the server turns into the brief the agent reads. */
  view: ViewRequest;
  /** Last file the reader opened in the preview, or `null` when they opened none. */
  lastViewedPath: string | null;
}

/**
 * Where one ask has got to.
 *
 * There is no cancelled state: dismissing a running ask stops the process and
 * drops the task, because the `x` on the floater means "I am done with this".
 */
export type AskState = "running" | "answered" | "failed";

/** One ask, as the floater and the answer dialog draw it. */
export interface AskTask {
  id: string;
  agentId: string;
  agentLabel: string;
  /** The question as it was typed, empty when the reader asked none. */
  question: string;
  /** Everything the agent was given, so the page can show exactly what was asked. */
  brief: string;
  state: AskState;
  /** ISO-8601 timestamp of the moment the agent process started. */
  startedAt: string;
  finishedAt: string | null;
  /** The agent's answer in Markdown, once the state is `answered`. */
  answer: string | null;
  /** Why the run failed, once the state is `failed`. */
  failure: string | null;
  /** What the run cost, when the tool reports it. */
  costUsd: number | null;
}

/**
 * Every ask this server run holds, newest first.
 *
 * One list is the whole client state, so a reload finds the asks still running
 * and the answers already back.
 */
export interface AskListResponse {
  tasks: AskTask[];
}

/** Stop an ask if it still runs, and drop it from the list either way. */
export interface DismissAskRequest {
  id: string;
}
