import type { Aspect, ChangeStatus, FileRow, Flavor, Measure, WeightField } from "../shared/api.ts";
import { weightField } from "../shared/api.ts";
import type { FolderNode, ScanIndex } from "../scanner/scan.ts";
import { byMagnitude, flavorOf } from "./aggregate.ts";

/**
 * The unit names the command line accepts, and the measure each one is.
 *
 * `loc` is what the page calls `codeLines`, so the flag speaks the page's
 * language while the code keeps the name every other file searches for.
 */
export const REPORT_UNITS: Readonly<Record<string, Measure>> = {
  tokens: "tokens",
  lines: "lines",
  loc: "codeLines",
};

export const DEFAULT_REPORT_THRESHOLD = 3;

export interface ReportOptions {
  measure: Measure;
  /** `after` for a scan. A scan has one content, so no other aspect exists. */
  aspect: Aspect;
  /** Percent of a section's total at which a node is expanded. */
  threshold: number;
}

const UNIT_LABELS: Readonly<Record<Measure, string>> = { tokens: "tokens", lines: "lines", codeLines: "loc" };

/**
 * A row's trailer names a comment share only from here up.
 *
 * Every file has some commentary. The trailer exists to flag the ones where
 * commentary is a large part of the weight, and below a fifth it is not.
 */
const COMMENT_SHARE_NOTED = 0.2;

/** How many files a one-line section names. */
const NAMED_FILES = 3;

const STATUS_LETTERS: Readonly<Record<ChangeStatus, string>> = {
  added: "A", modified: "M", deleted: "D", renamed: "R", unchanged: " ",
};

/**
 * One section per flavor, in reading order.
 *
 * Code and tests are walked, because that is where an agent goes next. The
 * others are named in one line each, because their job in the report is to
 * say how much of the tree is not code and where it sits.
 */
interface Section {
  flavor: Flavor;
  heading: string;
  label: string;
  walk: boolean;
  /** Whether a file row carries its structure trailer. Tests are condensed. */
  trailers: boolean;
}

const SECTIONS: readonly Section[] = [
  { flavor: "code", heading: "CODE", label: "code", walk: true, trailers: true },
  { flavor: "test", heading: "TESTS", label: "tests", walk: true, trailers: false },
  { flavor: "text", heading: "DOCS", label: "docs", walk: false, trailers: false },
  { flavor: "i18n", heading: "I18N", label: "i18n", walk: false, trailers: false },
  { flavor: "data", heading: "DATA & CONFIG", label: "data", walk: false, trailers: false },
  { flavor: "other", heading: "OTHER", label: "other", walk: false, trailers: false },
  { flavor: "generated", heading: "GENERATED", label: "generated", walk: false, trailers: false },
];

interface ReportFields {
  /** The figure every row prints. Signed in `net`. */
  weight: WeightField;
  /** The denominator every share divides by. Churn when the weight is net, for the reason `aggregate.ts` gives. */
  baseline: WeightField;
  added: WeightField;
  removed: WeightField;
}

function resolveReportFields(measure: Measure, aspect: Aspect): ReportFields {
  return {
    weight: weightField(measure, aspect),
    baseline: weightField(measure, aspect === "net" ? "churn" : aspect),
    added: weightField(measure, "added"),
    removed: weightField(measure, "removed"),
  };
}

interface Totals {
  weight: number;
  baseline: number;
  added: number;
  removed: number;
  files: number;
  lines: number;
  commentLines: number;
  addedLines: number;
  addedCommentLines: number;
}

function emptyTotals(): Totals {
  return {
    weight: 0, baseline: 0, added: 0, removed: 0, files: 0,
    lines: 0, commentLines: 0, addedLines: 0, addedCommentLines: 0,
  };
}

function addFile(totals: Totals, file: FileRow, fields: ReportFields): void {
  totals.weight += file[fields.weight];
  totals.baseline += file[fields.baseline];
  totals.added += file[fields.added];
  totals.removed += file[fields.removed];
  totals.files += 1;
  totals.lines += file.lines;
  totals.commentLines += file.commentLines;
  totals.addedLines += file.addedLines;
  totals.addedCommentLines += file.addedCommentLines;
}

function mergeTotals(target: Totals, source: Totals): void {
  target.weight += source.weight;
  target.baseline += source.baseline;
  target.added += source.added;
  target.removed += source.removed;
  target.files += source.files;
  target.lines += source.lines;
  target.commentLines += source.commentLines;
  target.addedLines += source.addedLines;
  target.addedCommentLines += source.addedCommentLines;
}

/**
 * Subtree totals of one flavor for every folder, keyed by folder path.
 *
 * Folders are sorted by path, so a child follows its parent and a reverse
 * pass sees every child before the parent that sums it.
 */
function sectionTotals(index: ScanIndex, fields: ReportFields, flavor: Flavor): Map<string, Totals> {
  const subtree = new Map<string, Totals>();
  for (let position = index.folders.length - 1; position >= 0; position -= 1) {
    const folder = index.folders[position]!;
    const totals = emptyTotals();
    for (const fileIndex of folder.directFileIndices) {
      const file = index.files[fileIndex]!;
      if (flavorOf(file) === flavor) addFile(totals, file, fields);
    }
    for (const childPath of folder.childPaths) mergeTotals(totals, subtree.get(childPath)!);
    subtree.set(folder.path, totals);
  }
  return subtree;
}

/**
 * A count with three or four significant characters.
 *
 * `61,678` costs a reader of the report four tokens where `62k` costs one, and
 * the last three digits carry nothing a share of the tree needs.
 */
export function formatCompact(value: number): string {
  const magnitude = Math.abs(value);
  let text: string;
  if (magnitude < 1000) text = String(magnitude);
  else if (magnitude < 1_000_000) text = scaled(magnitude / 1000, "k");
  else text = scaled(magnitude / 1_000_000, "M");
  return value < 0 ? `-${text}` : text;
}

/** One decimal below ten, none above, and 9.96 rounds to `10` rather than to `10.0`. */
function scaled(value: number, suffix: string): string {
  return value < 9.95 ? `${value.toFixed(1)}${suffix}` : `${Math.round(value)}${suffix}`;
}

/** Signed, so a net figure reads as what the change did rather than as a size. */
function formatSigned(value: number): string {
  if (value === 0) return "0";
  return `${value < 0 ? "-" : "+"}${formatCompact(Math.abs(value))}`;
}

function formatShare(share: number): string {
  const percent = share * 100;
  if (percent >= 99.5) return "100%";
  if (percent < 0.5) return share > 0 ? "<1%" : "0%";
  return `${Math.round(percent)}%`;
}

function formatFiles(count: number): string {
  return count === 1 ? "1 file" : `${formatCompact(count)} files`;
}

/** `+added -removed`, without a side the change did not touch. */
function formatChange(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`+${formatCompact(added)}`);
  if (removed > 0) parts.push(`-${formatCompact(removed)}`);
  return parts.join(" ");
}

interface Row {
  depth: number;
  label: string;
  weight: string;
  share: string;
  trailer: string;
}

function layoutRows(rows: readonly Row[]): string[] {
  const indent = (row: Row): string => `${"  ".repeat(row.depth)}${row.label}`;
  const labelWidth = Math.max(...rows.map((row) => indent(row).length));
  const weightWidth = Math.max(...rows.map((row) => row.weight.length));
  return rows.map((row) => {
    const head = `${indent(row).padEnd(labelWidth)}  ${row.weight.padStart(weightWidth)}  ${row.share.padStart(4)}`;
    return row.trailer ? `${head}  ${row.trailer}` : head;
  });
}

interface WalkContext {
  index: ScanIndex;
  fields: ReportFields;
  section: Section;
  totals: Map<string, Totals>;
  isDiff: boolean;
  measure: Measure;
  /** Section total the shares divide by. Magnitude, never signed. */
  baseline: number;
  threshold: number;
  formatWeight: (value: number) => string;
}

type Child =
  | { kind: "folder"; path: string; name: string; weight: number; files: number; added: number; removed: number }
  | { kind: "file"; file: FileRow; weight: number; files: number; added: number; removed: number };

function passes(context: WalkContext, weight: number): boolean {
  return context.baseline > 0 && Math.abs(weight) / context.baseline >= context.threshold / 100;
}

function shareOf(context: WalkContext, weight: number): string {
  return formatShare(context.baseline > 0 ? Math.abs(weight) / context.baseline : 0);
}

function folderTrailer(context: WalkContext, totals: Totals): string {
  const files = formatFiles(totals.files);
  if (!context.isDiff) return files;
  const change = formatChange(totals.added, totals.removed);
  return change ? `${files}  ${change}` : files;
}

function fileTrailer(context: WalkContext, file: FileRow): string {
  if (context.isDiff) {
    const parts = [STATUS_LETTERS[file.status]];
    const change = formatChange(file[context.fields.added], file[context.fields.removed]);
    if (change) parts.push(change);
    if (file.status === "renamed" && file.previousPath !== null) parts.push(`from ${file.previousPath}`);
    return parts.join("  ");
  }
  if (!context.section.trailers) return "";
  const parts: string[] = [];
  if (context.measure !== "codeLines") parts.push(`${formatCompact(file.codeLines)} loc`);
  if (file.lines > 0 && file.commentLines / file.lines >= COMMENT_SHARE_NOTED) {
    parts.push(`${formatShare(file.commentLines / file.lines)} comment`);
  }
  if (file.language !== null) parts.push(`${formatCompact(file.functions)} fn, ${formatCompact(file.branches)} br`);
  return parts.join(", ");
}

/**
 * The hierarchical walk, under one rule: a node is expanded when its weight
 * reaches the threshold share of its section.
 *
 * An expanded folder lists the children that pass the same test, then one
 * roll-up row for the rest, so every level is a partition of its parent. A
 * folder that passes but has no child that passes prints as a leaf. A chain of
 * folders that each hold one folder and no file of the section collapses into
 * one row, or a deep Java package would spend the report on rows at 100%.
 */
function walkSection(context: WalkContext): Row[] {
  const rows: Row[] = [];
  const { index, fields, section, totals } = context;

  const childrenOf = (folder: FolderNode): { folders: string[]; files: number[] } => ({
    folders: folder.childPaths.filter((childPath) => totals.get(childPath)!.files > 0),
    files: folder.directFileIndices.filter((fileIndex) => flavorOf(index.files[fileIndex]!) === section.flavor),
  });

  const renderFolder = (start: FolderNode, depth: number, segments: string[]): void => {
    let folder = start;
    let children = childrenOf(folder);
    while (children.folders.length === 1 && children.files.length === 0) {
      folder = index.folderByPath.get(children.folders[0]!)!;
      segments.push(folder.name);
      children = childrenOf(folder);
    }
    const folderTotals = totals.get(folder.path)!;
    const label = segments[0] === "." && segments.length > 1 ? segments.slice(1) : segments;
    rows.push({
      depth,
      label: `${label.join("/")}/`,
      weight: context.formatWeight(folderTotals.weight),
      share: shareOf(context, folderTotals.weight),
      trailer: folderTrailer(context, folderTotals),
    });

    const candidates: Child[] = [
      ...children.folders.map((childPath): Child => {
        const child = totals.get(childPath)!;
        return {
          kind: "folder", path: childPath, name: index.folderByPath.get(childPath)!.name,
          weight: child.weight, files: child.files, added: child.added, removed: child.removed,
        };
      }),
      ...children.files.map((fileIndex): Child => {
        const file = index.files[fileIndex]!;
        return {
          kind: "file", file, weight: file[fields.weight], files: 1,
          added: file[fields.added], removed: file[fields.removed],
        };
      }),
    ];
    candidates.sort((left, right) => byMagnitude(left.weight, right.weight) || nameOf(left).localeCompare(nameOf(right)));

    const shown = candidates.filter((child) => passes(context, child.weight));
    if (shown.length === 0) return;
    for (const child of shown) {
      if (child.kind === "folder") {
        renderFolder(index.folderByPath.get(child.path)!, depth + 1, [child.name]);
      } else {
        rows.push({
          depth: depth + 1,
          label: child.file.name,
          weight: context.formatWeight(child.weight),
          share: shareOf(context, child.weight),
          trailer: fileTrailer(context, child.file),
        });
      }
    }

    const hidden = candidates.filter((child) => !passes(context, child.weight));
    if (hidden.length === 0) return;
    const rest = emptyTotals();
    for (const child of hidden) {
      rest.weight += child.weight;
      rest.files += child.files;
      rest.added += child.added;
      rest.removed += child.removed;
    }
    const change = context.isDiff ? formatChange(rest.added, rest.removed) : "";
    rows.push({
      depth: depth + 1,
      label: `... ${formatFiles(rest.files)}`,
      weight: context.formatWeight(rest.weight),
      share: shareOf(context, rest.weight),
      trailer: change,
    });
  };

  renderFolder(index.folderByPath.get("")!, 0, ["."]);
  return rows;
}

function nameOf(child: Child): string {
  return child.kind === "folder" ? child.name : child.file.name;
}

/** Churn and net together, whatever the aspect, because a reader wants both headline figures. */
function describeChange(totals: Totals, unit: string): string {
  const churn = totals.added + totals.removed;
  const change = formatChange(totals.added, totals.removed);
  const churnText = change ? `churn ${formatCompact(churn)} ${unit} (${change})` : `churn 0 ${unit}`;
  return `${churnText}, net ${formatSigned(totals.added - totals.removed)}`;
}

/** The figures a section heading states, the same in every section. */
function describeTotals(totals: Totals, unit: string, isDiff: boolean): string {
  const size = isDiff ? describeChange(totals, unit) : `${formatCompact(totals.weight)} ${unit}`;
  return `${size}, ${formatFiles(totals.files)}`;
}

function commentShareText(lines: number, commentLines: number): string {
  return lines > 0 ? `${formatShare(commentLines / lines)} comment` : "0% comment";
}

function renderHeader(
  index: ScanIndex, options: ReportOptions, sections: readonly { section: Section; totals: Totals }[],
  formatWeight: (value: number) => string,
): string[] {
  const { meta } = index;
  const unit = UNIT_LABELS[options.measure];
  const lines: string[] = [`slopsplorer report  ${meta.rootPath}`];

  const whole = emptyTotals();
  for (const { totals } of sections) mergeTotals(whole, totals);

  if (meta.diff === null) {
    const sum = (field: WeightField): number => index.files.reduce((total, file) => total + file[field], 0);
    lines.push(
      `tree of ${formatFiles(meta.fileCount)}: ${formatCompact(sum("tokens"))} tokens (${meta.tokenizer}), `
        + `${formatCompact(sum("lines"))} lines, ${formatCompact(sum("codeLines"))} loc, `
        + commentShareText(whole.lines, whole.commentLines),
    );
  } else {
    const counts = [
      [meta.diff.filesAdded, "added"], [meta.diff.filesModified, "modified"],
      [meta.diff.filesDeleted, "deleted"], [meta.diff.filesRenamed, "renamed"],
    ] as const;
    const countText = counts.filter(([count]) => count > 0).map(([count, word]) => `${formatCompact(count)} ${word}`);
    lines.push(
      `compare ${meta.diff.spec}: ${[formatFiles(meta.fileCount), ...countText].join(", ")}`,
      `${describeChange(whole, unit)}, added is ${commentShareText(whole.addedLines, whole.addedCommentLines)}`,
    );
  }

  const aspectWord = meta.diff === null ? "" : `${options.aspect} `;
  const split = sections
    .filter(({ totals }) => totals.files > 0)
    .map(({ section, totals }) => {
      const share = whole.baseline > 0 ? Math.abs(totals.weight) / whole.baseline : 0;
      return `${section.label} ${formatWeight(totals.weight)} ${formatShare(share)}`;
    });
  lines.push(`${aspectWord}${unit} by flavor: ${split.join("  ")}`);

  const code = sections.find(({ section }) => section.flavor === "code")!.totals;
  const tests = sections.find(({ section }) => section.flavor === "test")!.totals;
  const sentences: string[] = [];
  if (meta.diff === null && code.weight > 0) {
    sentences.push(`Tests weigh ${formatShare(tests.weight / code.weight)} of code.`);
  }
  if (meta.diff !== null && code.added + code.removed > 0) {
    sentences.push(`Tests weigh ${formatShare((tests.added + tests.removed) / (code.added + code.removed))} of code churn.`);
  }
  sentences.push(`A node is expanded at >= ${options.threshold}% of its section.`);
  lines.push(sentences.join(" "));
  return lines;
}

function renderOneLine(
  index: ScanIndex, fields: ReportFields, section: Section, totals: Totals, unit: string, isDiff: boolean,
  formatWeight: (value: number) => string,
): string {
  const named = index.files
    .filter((file) => flavorOf(file) === section.flavor)
    .sort((left, right) => byMagnitude(left[fields.weight], right[fields.weight]) || left.path.localeCompare(right.path))
    .slice(0, NAMED_FILES)
    .map((file) => `${file.path} ${formatWeight(file[fields.weight])}`);
  const excluded = section.flavor === "generated" ? ", excluded above" : "";
  return `${section.heading}  ${describeTotals(totals, unit, isDiff)}${excluded}: ${named.join(", ")}`;
}

/**
 * The whole report as text, for a reader that cannot open the page.
 *
 * Every figure comes from the same `ScanIndex` the page reads, so the report
 * and the page can never describe two different trees.
 */
export function buildReport(index: ScanIndex, options: ReportOptions): string {
  const isDiff = index.meta.diff !== null;
  if (!isDiff && options.aspect !== "after") {
    throw new Error("a scanned file has one content, so a scan report has no aspect but after");
  }
  if (!(options.threshold >= 0 && options.threshold <= 100)) {
    throw new Error(`threshold is a percent between 0 and 100, got ${options.threshold}`);
  }

  const fields = resolveReportFields(options.measure, options.aspect);
  const unit = UNIT_LABELS[options.measure];
  const formatWeight = options.aspect === "net" ? formatSigned : formatCompact;
  const sections = SECTIONS.map((section) => {
    const totals = sectionTotals(index, fields, section.flavor);
    return { section, totals: totals.get("")!, byFolder: totals };
  });

  const output = renderHeader(index, options, sections, formatWeight);

  for (const { section, totals, byFolder } of sections.filter(({ section }) => section.walk)) {
    output.push("");
    if (totals.files === 0) {
      output.push(`${section.heading}  none`);
      continue;
    }
    const heading = `${section.heading}  ${describeTotals(totals, unit, isDiff)}`;
    const comment = section.flavor === "code"
      ? isDiff
        ? totals.addedLines > 0 ? `, added is ${commentShareText(totals.addedLines, totals.addedCommentLines)}` : ""
        : `, ${commentShareText(totals.lines, totals.commentLines)}`
      : "";
    output.push(`${heading}${comment}`);
    const context: WalkContext = {
      index, fields, section, totals: byFolder, isDiff, measure: options.measure,
      baseline: totals.baseline, threshold: options.threshold, formatWeight,
    };
    output.push(...layoutRows(walkSection(context)));
  }

  const oneLiners = sections.filter(({ section, totals }) => !section.walk && totals.files > 0);
  if (oneLiners.length > 0) output.push("");
  for (const { section, totals } of oneLiners) {
    output.push(renderOneLine(index, fields, section, totals, unit, isDiff, formatWeight));
  }

  return `${output.join("\n")}\n`;
}
