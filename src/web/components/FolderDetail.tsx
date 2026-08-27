import { useEffect, useRef, useState } from "react";
import type { Aspect, DetailView, Measure, RankMetric } from "../../shared/api.ts";
import { ASPECTS, MEASURES } from "../../shared/api.ts";
import {
  aspectFigure, count, countOf, measureHeading, percent, weightAbbreviation, weightCount, weightHeading, weightName,
} from "../format.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { FileTable } from "./FileTable.tsx";
import { FlavorBar } from "./FlavorBar.tsx";
import { Readout } from "./Readout.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  detail: DetailView | null;
  /** The measure the figures are in, taken from the response rather than the pending request. */
  measure: Measure;
  /** The side of the change the figures describe. */
  aspect: Aspect;
  isDiff: boolean;
  /** Sorted column of the file table, shared with the ranking panel below. */
  sort: RankMetric;
  onSortChange: (metric: RankMetric) => void;
  /** The selected folder: the path the copy control hands over, and the root that file names shorten against. */
  path: string;
  onSelectFolder: (path: string) => void;
  /** Whether the panel describes a folder's own files rather than its subtree. */
  directFilesOnly: boolean;
  canDrill: boolean;
  onDrill: () => void;
  onOpenSource: (path: string) => void;
  /** Reports how many tiles fit across the panel, so the server can plan the grid. */
  onCapacityChange: (cardColumns: number) => void;
}

/** Narrower than this and a tile can no longer hold its name and figures. */
const CARD_MIN_WIDTH = 210;
const CARD_GAP = 8;
const CARD_PADDING = 40;
const MAX_COLUMNS = 6;

/**
 * Every aspect figure of a folder, in the active measure.
 *
 * The server sends the two sides in that measure, and the two identities give
 * the rest, so the head states all five sides whichever one the switch selects
 * and the reader never has to change the switch to see a neighbour.
 */
function aspectTotals(detail: DetailView, measure: Measure): Record<Aspect, number> {
  return {
    added: detail.added,
    removed: detail.removed,
    net: detail.added - detail.removed,
    churn: detail.added + detail.removed,
    after: detail[measure],
  };
}

/** The selected folder: its weight, how its children divide it, and its own files. */
export function FolderDetail({ detail, measure, aspect, isDiff, sort, onSortChange, path, onSelectFolder, directFilesOnly, canDrill, onDrill, onOpenSource, onCapacityChange }: Props): React.JSX.Element {
  const panelRef = useRef<HTMLElement>(null);
  const [columns, setColumns] = useState(3);

  // Measure rather than guess: the panel is a fraction of a resizable window,
  // so the number of tiles that fit is not knowable from a breakpoint.
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const usable = width - CARD_PADDING + CARD_GAP;
      const fitted = Math.floor(usable / (CARD_MIN_WIDTH + CARD_GAP));
      setColumns(Math.max(1, Math.min(MAX_COLUMNS, fitted)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onCapacityChange(columns);
  }, [columns, onCapacityChange]);

  if (!detail) return <section ref={panelRef} className="panel detail" aria-label="Folder detail" />;

  // Inside a diff every supporting figure describes the change too, so the
  // comment share is the comment share of the churn rather than of the result.
  const commentBase = isDiff ? detail.churnLines : detail.lines;
  const commentPart = isDiff ? detail.churnCommentLines : detail.commentLines;
  const commentShare = commentBase > 0 ? commentPart / commentBase : 0;
  const totals = aspectTotals(detail, measure);
  // Net is signed, so its shares are drawn against churn. Every readout of one
  // says so, because a churn figure under a net label is a wrong figure.
  const shareNote = aspect === "net" ? "of the current scope's churn" : "of current scope";

  return (
    <section ref={panelRef} className="panel detail" aria-label="Folder detail">
      <header className="detail__head">
        <div className="detail__identity">
          <div className="detail__title-row">
            {/* The control is always drawn, muted when the folder is already the drill
                scope. A slot that empties would read as a heading that lost its icon. */}
            <button
              type="button"
              className="detail__tool detail__tool--drill"
              onClick={() => { if (canDrill) onDrill(); }}
              // `aria-disabled` rather than `disabled`: a disabled button gets no mouse
              // events, and the tooltip is the only thing that says why it is inert.
              aria-disabled={!canDrill}
              {...tooltipHandlers}
              aria-label="Drill down"
              aria-describedby="drill-tooltip"
            >
              <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                <path d="M4 4v4.5A3.5 3.5 0 0 0 7.5 12H16m-4-4 4 4-4 4" />
              </svg>
              <Tooltip id="drill-tooltip" compact>
                {canDrill
                  ? "Drill down"
                  : directFilesOnly ? "A folder's own files are not a scope" : "Already the drill scope"}
              </Tooltip>
            </button>
            {/* The trail and the name are one path, so the heading is read in a single pass
                and a bare "." lands where a path would put it rather than standing alone. */}
            <h2>
              {detail.trail.map((crumb) => (
                <span key={crumb.path} className="detail__step">
                  <button type="button" className="detail__ancestor" onClick={() => onSelectFolder(crumb.path)}>
                    {crumb.name}
                  </button>
                  <span className="detail__separator" aria-hidden="true">/</span>
                </span>
              ))}
              {detail.title}
            </h2>
            {path ? <CopyPathButton path={path} /> : null}
          </div>

          {/* One strip in both modes and in every aspect: the switch above moves
              the emphasis along it and never changes its shape, so the panel
              keeps its height and the reader keeps their place. */}
          <div className="readouts detail__readouts">
            {isDiff
              ? ASPECTS.map((candidate) => {
                const figure = aspectFigure(candidate, totals[candidate]);
                return (
                  <Readout
                    key={candidate}
                    label={weightHeading(measure, candidate, true)}
                    value={figure.text}
                    sign={figure.sign}
                    emphasis={candidate === aspect}
                  />
                );
              })
              : MEASURES.map((candidate) => (
                <Readout
                  key={candidate}
                  label={measureHeading(candidate)}
                  value={count(detail[candidate])}
                  emphasis={candidate === measure}
                />
              ))}
            <Readout label={isDiff ? "comment of churn" : "comment share"} value={percent(commentShare)} />
            <Readout label="files" value={count(detail.files)} />
          </div>
        </div>
        <div className="detail__actions">
          <p className="detail__share" {...tooltipHandlers}>
            {percent(detail.shareOfScope)}
            <Tooltip>
              {aspect === "net"
                ? "Share of the current scope's churn, measured before any filter. Net is signed, so churn is the whole it is drawn against."
                : "Share of the current scope, measured before any filter"}
            </Tooltip>
          </p>
        </div>
      </header>

      {detail.cards.length > 0 ? (
        <div className="cards" style={{ "--card-columns": detail.cardColumns } as React.CSSProperties}>
          {detail.cards.map((card, index) => {
            const added = aspectFigure("added", card.added);
            const removed = aspectFigure("removed", card.removed);
            const body = (
              <>
                <span className="card__head">
                  <span className="card__name">{card.name}</span>
                  <span className="card__files">{countOf(card.files, "file")}</span>
                </span>
                {/* The figure names its own side: the switch that chose it is
                    at the top of the page, and a tile is read on its own. */}
                <span className="card__row">
                  <span className="card__weight">
                    {weightCount(card.weight, aspect)}
                    <span className="card__unit">{weightAbbreviation(measure, aspect, isDiff)}</span>
                  </span>
                  <span className="card__share">{percent(card.shareOfScope)}</span>
                </span>
                {/* The two sides, whatever the switch selects, because a tile
                    showing one figure hides a rewrite behind a small number. */}
                {isDiff ? (
                  <span className="card__split">
                    <span data-sign={added.sign}>{added.text}</span>
                    <span data-sign={removed.sign}>{removed.text}</span>
                  </span>
                ) : null}
                <FlavorBar
                  slices={card.flavors}
                  statuses={card.statuses}
                  measure={measure}
                  aspect={aspect}
                  isDiff={isDiff}
                  scale={card.shareOfScope}
                />
              </>
            );
            return card.path === null ? (
              <div key={`aggregate-${index}`} className="card card--aggregate">{body}</div>
            ) : (
              <button
                key={card.path}
                type="button"
                className="card"
                // Spelled out, because the tile states each figure as a column
                // of its own and a reader who cannot see the layout gets none
                // of what the columns carry.
                aria-label={
                  `${card.name}, ${weightCount(card.weight, aspect)} ${weightName(measure, aspect, isDiff)}, `
                  + `${countOf(card.files, "file")}, ${percent(card.shareOfScope)} ${shareNote}`
                }
                onClick={() => onSelectFolder(card.path!)}
              >
                {body}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* No caption: the heading already names the subject, and the table's own
          columns say what the rows are. */}
      <FileTable
        files={detail.directFiles}
        measure={measure}
        aspect={aspect}
        isDiff={isDiff}
        sort={sort}
        onSortChange={onSortChange}
        displayRoot={path}
        prefixRelativePaths={false}
        onOpenSource={onOpenSource}
        emptyMessage="No files sit directly in this folder under the current filters."
      />
    </section>
  );
}
