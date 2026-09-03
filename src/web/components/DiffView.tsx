import { useMemo } from "react";
import type { DiffLine } from "../../shared/api.ts";
import { countOf } from "../format.ts";
import { highlightToLines } from "../highlight.ts";

/** Unchanged lines kept on each side of a change while the rest is hidden. */
const CONTEXT_LINES = 3;

/** Which image of a compared file the preview draws. */
export type PreviewSide = "before" | "diff" | "after";

interface Props {
  path: string;
  lines: DiffLine[];
  /** Hide every line further than the context from a change. Only the change has lines to hide. */
  changedOnly: boolean;
  /** The change, or the file as it stood on one side of it. */
  side: PreviewSide;
}

const MARKER_NAMES: Readonly<Record<DiffLine["marker"], string>> = {
  " ": "context", "+": "added", "-": "removed",
};

type Entry =
  | { kind: "line"; line: DiffLine; html: string; index: number }
  | { kind: "gap"; hidden: number; index: number };

/** The file as one side held it: the lines that side has, in its own order. */
export function linesOfSide(lines: readonly DiffLine[], side: "before" | "after"): DiffLine[] {
  const absent = side === "before" ? "+" : "-";
  return lines.filter((line) => line.marker !== absent);
}

/** A gutter wide enough for the highest line number it will hold. */
function gutterWidth(lines: readonly DiffLine[]): string {
  const widest = lines.reduce(
    (widest, line) => Math.max(widest, line.beforeLine ?? 0, line.afterLine ?? 0), 0);
  return `${Math.max(2, String(widest).length)}ch`;
}

/**
 * Highlight both sides whole, then hand each row the line that belongs to it.
 *
 * A removed line reads in the language of the before-image and an added one in
 * the language of the after-image, so a construct that only exists on one side
 * still colours correctly.
 */
function highlightRows(path: string, lines: readonly DiffLine[]): string[] {
  const textOf = (skip: DiffLine["marker"]): string =>
    lines.filter((line) => line.marker !== skip).map((line) => line.text).join("\n");
  const before = highlightToLines(path, textOf("+"));
  const after = highlightToLines(path, textOf("-"));
  let beforeCursor = 0;
  let afterCursor = 0;
  return lines.map((line) => {
    if (line.marker === "-") return before[beforeCursor++] ?? "";
    if (line.marker === " ") beforeCursor += 1;
    return after[afterCursor++] ?? "";
  });
}

/** Drop the unchanged lines that sit further than the context from any change. */
function collapse(lines: readonly DiffLine[], html: readonly string[]): Entry[] {
  const near = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.marker === " ") return;
    const last = Math.min(lines.length - 1, index + CONTEXT_LINES);
    for (let reach = Math.max(0, index - CONTEXT_LINES); reach <= last; reach += 1) near[reach] = true;
  });

  const entries: Entry[] = [];
  let index = 0;
  while (index < lines.length) {
    if (near[index]) {
      entries.push({ kind: "line", line: lines[index]!, html: html[index] ?? "", index });
      index += 1;
      continue;
    }
    const start = index;
    while (index < lines.length && !near[index]) index += 1;
    entries.push({ kind: "gap", hidden: index - start, index: start });
  }
  return entries;
}

/**
 * One file's change, line by line, in the language of the file.
 *
 * A diff grammar would colour the markers and leave the code grey, so the row
 * carries the marker and the code keeps the highlighting it has in a scan. The
 * two gutters are what says where a passage sits, and how far apart two
 * changes are.
 */
function ChangeView({ path, lines, changedOnly }: Omit<Props, "side">): React.JSX.Element {
  const html = useMemo(() => highlightRows(path, lines), [path, lines]);
  const entries = useMemo(
    () => changedOnly
      ? collapse(lines, html)
      : lines.map((line, index) => ({ kind: "line", line, html: html[index] ?? "", index }) as Entry),
    [lines, html, changedOnly],
  );

  return (
    <div className="diff" style={{ "--diff-gutter": gutterWidth(lines) } as React.CSSProperties}>
      {entries.map((entry) => entry.kind === "gap" ? (
        <div className="diff__gap" key={`gap-${entry.index}`}>
          <span>{countOf(entry.hidden, "unchanged line")}</span>
        </div>
      ) : (
        <div className="diff__line" data-marker={MARKER_NAMES[entry.line.marker]} key={entry.index}>
          <span className="diff__gutter">
            <span className="diff__number">{entry.line.beforeLine ?? ""}</span>
            <span className="diff__number">{entry.line.afterLine ?? ""}</span>
            <span className="diff__marker" aria-hidden="true">{entry.line.marker}</span>
          </span>
          <code className="diff__text" dangerouslySetInnerHTML={{ __html: entry.html }} />
        </div>
      ))}
    </div>
  );
}

/**
 * The file as one side of the comparison held it, whole.
 *
 * One gutter and no marker column, because a single image has one set of line
 * numbers. The side's colour washes the whole body, blank lines and the space
 * under the last line included, so the view reads as one image of the file and
 * not as the hunks of a diff. Where the change sits is the Diff view's answer.
 */
function SideView({ path, lines, side }: { path: string; lines: DiffLine[]; side: "before" | "after" }): React.JSX.Element {
  const rows = useMemo(() => linesOfSide(lines, side), [lines, side]);
  const html = useMemo(
    () => highlightToLines(path, rows.map((line) => line.text).join("\n")), [path, rows]);

  if (rows.length === 0) return <p className="empty">The {side} image of this file is empty.</p>;

  return (
    <div
      className="diff diff--side"
      data-side={side}
      style={{ "--diff-gutter": gutterWidth(rows) } as React.CSSProperties}
    >
      {rows.map((line, index) => (
        <div className="diff__line" key={index}>
          <span className="diff__gutter">
            <span className="diff__number">{(side === "before" ? line.beforeLine : line.afterLine) ?? ""}</span>
          </span>
          <code className="diff__text" dangerouslySetInnerHTML={{ __html: html[index] ?? "" }} />
        </div>
      ))}
    </div>
  );
}

/** The change, or one side of it, for the file the preview holds. */
export function DiffView({ path, lines, changedOnly, side }: Props): React.JSX.Element {
  return side === "diff"
    ? <ChangeView path={path} lines={lines} changedOnly={changedOnly} />
    : <SideView path={path} lines={lines} side={side} />;
}
