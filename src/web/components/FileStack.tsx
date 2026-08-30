import { useEffect, useId, useRef, useState } from "react";
import type { FileRow, Measure, SourceResponse } from "../../shared/api.ts";
import { measureAbbreviation, weightField } from "../../shared/api.ts";
import { aspectFigure, count, messageOf, statusLetter, statusName } from "../format.ts";
import { Chevron } from "./Chevron.tsx";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { FilePreview } from "./FilePreview.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

/** How far outside the viewport a file starts loading, so scrolling meets it ready. */
const LOAD_MARGIN = "600px 0px";

interface VerticalScrollPosition {
  scrollTop: number;
}

interface PositionedElement {
  getBoundingClientRect: () => { top: number };
}

/** Keep the next file header where the collapsed file's header stood. */
export function alignNextFileAfterCollapse(
  scroll: VerticalScrollPosition,
  collapsedHeaderTop: number,
  nextHeader: PositionedElement,
): void {
  scroll.scrollTop += nextHeader.getBoundingClientRect().top - collapsedHeaderTop;
}

interface StackProps {
  /** The files the folder panel lists, in whatever order it ranked them. */
  rows: readonly FileRow[];
  /** The unit of the figure each file states, taken from the page it was opened from. */
  measure: Measure;
  isDiff: boolean;
  changedOnly: boolean;
  loadSource: (path: string) => Promise<SourceResponse>;
  /** Paths the reader folded away. The dialog holds it, because the control that folds them all sits in its header. */
  folded: ReadonlySet<string>;
  onToggleFile: (path: string) => void;
}

/**
 * A to Z by whole path, which is the only order this view is drawn in.
 *
 * The panel ranks by weight, and a ranked stack would put two files of one
 * folder at opposite ends of a long scroll. Reading a whole selection is a walk
 * of the tree, so the order is the tree's.
 */
export function inPathOrder(rows: readonly FileRow[]): FileRow[] {
  return [...rows].sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * What the one fold control does next.
 *
 * A stack that holds no fold closes, and any other stack opens, so a partly
 * folded stack takes one press to become a state the reader can see whole.
 */
export function foldedAfterFoldAll(
  rows: readonly FileRow[],
  folded: ReadonlySet<string>,
): ReadonlySet<string> {
  if (folded.size > 0) return new Set();
  return new Set(rows.map((row) => row.path));
}

/** Every listed file, one after another, in path order. */
export function FileStack({
  rows, measure, isDiff, changedOnly, loadSource, folded, onToggleFile,
}: StackProps): React.JSX.Element {
  return (
    <div className="stack">
      {inPathOrder(rows).map((row) => (
        <StackedFile
          key={row.path}
          row={row}
          measure={measure}
          isDiff={isDiff}
          changedOnly={changedOnly}
          loadSource={loadSource}
          open={!folded.has(row.path)}
          onToggle={() => onToggleFile(row.path)}
        />
      ))}
    </div>
  );
}

interface FileProps {
  row: FileRow;
  measure: Measure;
  isDiff: boolean;
  changedOnly: boolean;
  loadSource: (path: string) => Promise<SourceResponse>;
  open: boolean;
  onToggle: () => void;
}

/**
 * One file of the stack, read from the server when the reader approaches it.
 *
 * The stack holds as many files as the panel lists, and asking for all of them
 * at once would send a whole subtree to a browser that draws two screens of it.
 * A file that has been read stays read, so scrolling back is immediate, and a
 * file the reader folded away is never read at all. Which files are folded is
 * the dialog's, so one control there can fold them all.
 */
function StackedFile({
  row, measure, isDiff, changedOnly, loadSource, open, onToggle,
}: FileProps): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const bodyId = useId();
  const [wanted, setWanted] = useState(false);
  const [source, setSource] = useState<SourceResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const node = sectionRef.current;
    if (node === null || wanted) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) setWanted(true); },
      { rootMargin: LOAD_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [wanted]);

  useEffect(() => {
    if (!wanted || !open) return;
    let cancelled = false;
    loadSource(row.path)
      .then((loaded) => { if (!cancelled) setSource(loaded); })
      .catch((cause: unknown) => { if (!cancelled) setFailure(messageOf(cause)); });
    return () => { cancelled = true; };
  }, [wanted, open, row.path, loadSource]);

  // Both sides whatever the page's aspect switch selects, as the folder tiles
  // state them, because one figure would hide a rewrite behind a small number.
  const added = aspectFigure("added", row[weightField(measure, "added")]);
  const removed = aspectFigure("removed", row[weightField(measure, "removed")]);

  const toggleOpen = (): void => {
    if (!open) {
      onToggle();
      return;
    }

    const section = sectionRef.current;
    const currentHeader = section?.querySelector<HTMLElement>(".stack__head");
    const nextHeader = section?.nextElementSibling?.querySelector<HTMLElement>(".stack__head");
    const scroll = section?.closest<HTMLElement>(".viewer__body");
    const collapsedHeaderTop = currentHeader?.getBoundingClientRect().top;
    onToggle();
    if (scroll && collapsedHeaderTop !== undefined && nextHeader) {
      requestAnimationFrame(() => alignNextFileAfterCollapse(scroll, collapsedHeaderTop, nextHeader));
    }
  };

  return (
    <section className="stack__file" ref={sectionRef} aria-label={row.path}>
      {/* Sticky, because a flat list of files answers "which file am I reading"
          only while the name is on screen. */}
      <header className="stack__head">
        {isDiff ? (
          <span className="status" data-status={row.status} {...tooltipHandlers}>
            <span aria-hidden="true">{statusLetter(row.status)}</span>
            <span className="visually-hidden">{statusName(row.status)}</span>
            <Tooltip compact>
              {row.previousPath === null ? `File ${statusName(row.status)}` : `Renamed from ${row.previousPath}`}
            </Tooltip>
          </span>
        ) : null}
        {/* The name is the control that folds the file, as it is in the tree:
            a reader who has read a file wants the next one, not a second row of
            buttons to find. */}
        <h3 className="stack__path">
          <button
            type="button"
            className="stack__disclose"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggleOpen}
          >
            <Chevron open={open} />
            {row.path}
          </button>
        </h3>
        <CopyPathButton path={row.path} />
        <span className="stack__figures">
          {isDiff ? (
            <>
              <span data-sign={added.sign}>{added.text}</span>
              <span data-sign={removed.sign}>{removed.text}</span>
            </>
          ) : (
            <>
              <span>{count(row[weightField(measure, "after")])}</span>
              <span className="stack__unit">{measureAbbreviation(measure)}</span>
            </>
          )}
        </span>
      </header>
      {open ? (
        <div className="stack__body" id={bodyId} data-pending={source === null && failure === null}>
          <FilePreview source={source} failure={failure} changedOnly={changedOnly} />
        </div>
      ) : null}
    </section>
  );
}
