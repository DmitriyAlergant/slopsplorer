import { useEffect, useRef, useState } from "react";
import type { Aspect, DetailView, Measure, RankMetric } from "../../shared/api.ts";
import {
  count, countOf, measureAbbreviation, measureName, percent, sideCount, signed, weightCount, weightName,
} from "../format.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { FileTable } from "./FileTable.tsx";
import { FlavorBar } from "./FlavorBar.tsx";
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
  // Tokens are the cross-reference when they are not the headline themselves,
  // so the line always states the weight in two units.
  // In net the two sides and the net they come to are the whole subject of the
  // heading, so they replace the supporting line rather than sit under it.
  const splitFigures = isDiff && aspect === "net";
  const stats = isDiff
    ? [
      `${weightCount(detail.weight, aspect)} ${weightName(measure, aspect, isDiff)}`,
      countOf(detail.files, "file"),
      measure === "tokens" ? `${count(detail.churnLines)} lines churned` : `${count(detail.churnTokens)} tokens churned`,
    ]
    : [
      `${count(detail.weight)} ${measureName(measure)}`,
      countOf(detail.files, "file"),
      measure === "tokens" ? `${count(detail.lines)} lines` : `${count(detail.tokens)} tokens`,
      `${percent(commentShare)} comment`,
    ];

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
          {splitFigures ? null : <p className="detail__stats">{stats.join(" · ")}</p>}
          {splitFigures ? (
            <p className="detail__figures">
              <span className="detail__split">
                <span data-sign={detail.added === 0 ? "zero" : "positive"}>{sideCount(detail.added, "+")}</span>
                <span data-sign={detail.removed === 0 ? "zero" : "negative"}>{sideCount(detail.removed, "-")}</span>
              </span>
              <span className="detail__net">
                {weightCount(detail.weight, aspect)} {weightName(measure, aspect, isDiff)}
              </span>
            </p>
          ) : null}
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
            const body = (
              <>
                <span className="card__name">{card.name}</span>
                <span className="card__meta">
                  {splitFigures ? null : `${weightCount(card.weight, aspect)} ${measureAbbreviation(measure)} · `}
                  {countOf(card.files, "file")} · {percent(card.shareOfScope)} of current scope
                </span>
                {/* The two sides on the left and the net they come to on the
                    right, on one line of their own, because in net that line is
                    the card rather than a footnote to it. */}
                {splitFigures ? (
                  <span className="card__figures">
                    <span className="card__split">
                      <span data-sign={card.added === 0 ? "zero" : "positive"}>{sideCount(card.added, "+")}</span>
                      <span data-sign={card.removed === 0 ? "zero" : "negative"}>{sideCount(card.removed, "-")}</span>
                    </span>
                    <span className="card__net">
                      {weightCount(card.weight, aspect)} {measureAbbreviation(measure)}
                    </span>
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
              <button key={card.path} type="button" className="card" onClick={() => onSelectFolder(card.path!)}>
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
