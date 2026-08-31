import { useEffect, useRef, useState } from "react";
import type { Aspect, DetailView, FileKind, FileRow, FileScope, Measure, RankMetric, RowKind, ViewRequest } from "../../shared/api.ts";
import {
  ASPECTS, FILE_SCOPES, FLAVOR_DETAILS, MAX_CARD_COLUMNS, MEASURES, MIN_CARD_COLUMNS, aspectTotals, measureHeading,
  weightAbbreviation, weightHeading, weightName,
} from "../../shared/api.ts";
import { aspectFigure, changePercent, count, countOf, figureWidth, percent, weightCount } from "../format.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { FileTable } from "./FileTable.tsx";
import { FlavorBar } from "./FlavorBar.tsx";
import { Readout } from "./Readout.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  detail: DetailView | null;
  /** One page of the selection's files, in the active rank order. */
  files: readonly FileRow[];
  /** How many files match across all pages. */
  filesTotal: number;
  /** Offset of the page the server returned. */
  filesOffset: number;
  /** The measure the figures are in, taken from the response rather than the pending request. */
  measure: Measure;
  /** The side of the change the figures describe. */
  aspect: Aspect;
  /** Widest figure the page can state, which the flavor controls reserve their digits from. */
  widestWeight: number;
  isDiff: boolean;
  /** Sorted column of the file table, shared with the ranking panel below. */
  sort: RankMetric;
  onSortChange: (metric: RankMetric) => void;
  /** The selected folder: the path the copy control hands over, and the root that file names shorten against. */
  path: string;
  /** Selects what a tile or an ancestor step names, which is a folder or a folder's own files. */
  onSelect: (rowKind: RowKind, path: string) => void;
  /** Whether the panel describes a folder's own files rather than its subtree. */
  directFilesOnly: boolean;
  /** How much of the selected folder the file list holds. */
  fileScope: FileScope;
  onFileScopeChange: (fileScope: FileScope) => void;
  onToggleKind: (kind: FileKind) => void;
  onToggleGenerated: () => void;
  canDrill: boolean;
  onDrill: () => void;
  rank: ViewRequest["rank"];
  onRankChange: (change: Partial<ViewRequest["rank"]>) => void;
  onOpenSource: (path: string) => void;
  /** Opens every listed file in one scrolling preview, in path order. */
  onOpenListed: () => void;
  /** Reports how many tiles fit across the panel, so the server can plan the grid. */
  onCapacityChange: (cardColumns: number) => void;
}

/** The width of every tile: narrower and a tile can no longer hold its name and figures. */
const CARD_WIDTH = 210;
const CARD_GAP = 8;
const CARD_PADDING = 40;

/** What each scope of the file list is called, and what it holds. */
const FILE_SCOPE_DETAILS: Record<FileScope, { label: string; description: string }> = {
  folder: {
    label: "This folder",
    description: "List only the files that sit directly in the selected folder.",
  },
  subtree: {
    label: "All below",
    description: "List every file of the selected folder and of the folders under it.",
  },
};

/** Kept as a one-line reversible frontend choice while folder-only scope remains supported by the request contract. */
const SHOW_FILE_SCOPE_CONTROL = false;

/** The selected folder: its weight, how its children divide it, and its own files. */
export function FolderDetail({
  detail, files, filesTotal, filesOffset, measure, aspect, widestWeight, isDiff, sort, onSortChange, path, onSelect,
  directFilesOnly, fileScope, onFileScopeChange, onToggleKind, onToggleGenerated, canDrill, onDrill, rank, onRankChange,
  onOpenSource, onOpenListed, onCapacityChange,
}: Props): React.JSX.Element {
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
      const fitted = Math.floor(usable / (CARD_WIDTH + CARD_GAP));
      setColumns(Math.max(MIN_CARD_COLUMNS, Math.min(MAX_CARD_COLUMNS, fitted)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onCapacityChange(columns);
  }, [columns, onCapacityChange]);

  if (!detail) return <section ref={panelRef} className="panel detail" aria-label="Folder detail" />;

  // The head states all four aspects whichever one the switch selects, so the
  // reader never has to move the switch to see a neighbour.
  const totals = aspectTotals(detail, measure);
  const before = {
    tokens: detail.beforeTokens,
    lines: detail.beforeLines,
    codeLines: detail.beforeCodeLines,
  }[measure];
  const unit = weightName(measure, aspect, isDiff);
  // Net is signed, so no whole divides it into an honest percentage. The bands
  // still scale against churn, and the page states no share of them.
  const showsShare = aspect !== "net";
  // A `.` selection is a folder's own files already, so the panel is narrowed
  // to them whatever the switch says, and the switch is not drawn.
  const listsFolderOnly = directFilesOnly || fileScope === "folder";
  const hasPreviousPage = filesOffset > 0;
  const hasNextPage = filesOffset + files.length < filesTotal;

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
                  <button type="button" className="detail__ancestor" onClick={() => onSelect("folder", crumb.path)}>
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
              }).concat(
                <Readout key="churn-percent" label="churn %" value={changePercent("churn", totals.churn, before)} />,
                <Readout key="net-percent" label="net %" value={changePercent("net", totals.net, before)} />,
              )
              : MEASURES.map((candidate) => (
                <Readout
                  key={candidate}
                  label={measureHeading(candidate)}
                  value={count(detail[candidate])}
                  emphasis={candidate === measure}
                />
              ))}
          </div>
        </div>
        {/* Drawn in every aspect, and empty in net where the page states no
            share: a slot that came and went would move the strip beside it. */}
        <div className="detail__actions">
          <p className="detail__share" {...tooltipHandlers}>
            {showsShare ? percent(detail.shareOfScope) : null}
            {showsShare ? <Tooltip>Share of the current scope, under the active filters</Tooltip> : null}
          </p>
        </div>
      </header>

      {/* Always drawn, one row high, so the table below starts in the same place
          whether the folder has children or not. A folder's own files are one of
          the tiles, so a folder without subfolders still has a row to draw. */}
      <div
        className="cards"
        style={{ "--card-columns": detail.cardColumns, "--card-width": `${CARD_WIDTH}px` } as React.CSSProperties}
      >
        {detail.cards.map((card, index) => {
          const added = aspectFigure("added", card.added);
          const removed = aspectFigure("removed", card.removed);
          // Only the hue: the unit beside the headline already names the side,
          // so the figure reads as a count and still matches the strip above.
          const headline = aspectFigure(aspect, card.weight);
          const body = (
            <>
              <span className="card__head">
                <span className="card__name">{card.name}</span>
                <span className="card__files">{countOf(card.files, "file")}</span>
              </span>
              {/* The figure names its own side: the switch that chose it is
                  at the top of the page, and a tile is read on its own. */}
              <span className="card__row">
                <span className="card__weight" data-sign={headline.sign}>
                  {weightCount(card.weight, aspect)}
                  <span className="card__unit">{weightAbbreviation(measure, aspect, isDiff)}</span>
                </span>
                {showsShare ? <span className="card__share">{percent(card.shareOfScope)}</span> : null}
              </span>
              {/* The two sides, whatever the switch selects, because a tile
                  showing one figure hides a rewrite behind a small number. */}
              {isDiff ? (
                <span className="card__split">
                  <span>{added.text}</span>
                  <span>{removed.text}</span>
                </span>
              ) : null}
              <FlavorBar
                slices={card.flavors}
                measure={measure}
                aspect={aspect}
                isDiff={isDiff}
                baseline={detail.flavorBaseline}
              />
            </>
          );
          const cardPath = card.path;
          return cardPath === null ? (
            <div key={`aggregate-${index}`} className="card card--aggregate">{body}</div>
          ) : (
            <button
              key={`${card.rowKind}:${cardPath}`}
              type="button"
              className="card"
              data-kind={card.rowKind}
              // Spelled out, because the tile states each figure as a column
              // of its own and a reader who cannot see the layout gets none
              // of what the columns carry.
              aria-label={
                `${card.rowKind === "files" ? "Files directly in this folder" : card.name}, `
                + `${weightCount(card.weight, aspect)} ${weightName(measure, aspect, isDiff)}, `
                + `${countOf(card.files, "file")}`
                + (showsShare ? `, ${percent(card.shareOfScope)} of current scope` : "")
              }
              onClick={() => onSelect(card.rowKind, cardPath)}
            >
              {body}
            </button>
          );
        })}
      </div>

      {/* The tiles divide the subject by folder and the rows divide it by file.
          The flavor and scope controls stand with the rows they change. */}
      <div className="detail__files-head">
        {/* Every figure here is reserved the digits of the project's widest and,
            in a comparison, a column for the sign, so neither walking the tree
            nor changing the unit or the side resizes the controls. */}
        <div
          className="chips detail__flavor-stats"
          role="group"
          aria-label="Available weight by flavor"
          style={{ "--figure-width": `${figureWidth(widestWeight, isDiff)}ch` } as React.CSSProperties}
        >
          {detail.flavorStats.map((stat) => {
            const { label: fullLabel, description } = FLAVOR_DETAILS[stat.flavor];
            return (
              <label
                key={stat.flavor}
                className="chip detail__flavor-stat"
                data-flavor={stat.flavor}
                data-on={stat.enabled}
                {...tooltipHandlers}
              >
                <input
                  type="checkbox"
                  checked={stat.enabled}
                  aria-label={fullLabel}
                  onChange={() => (stat.flavor === "generated" ? onToggleGenerated() : onToggleKind(stat.flavor))}
                />
                <span className="detail__flavor-copy">
                  <span>{fullLabel}</span>
                  <span className="detail__flavor-weight">{weightCount(stat.weight, aspect)}</span>
                </span>
                <Tooltip>{`${description} ${count(stat.weight)} ${unit} available in this scope.`}</Tooltip>
              </label>
            );
          })}
        </div>
        <div className="detail__files-controls">
          <div className="detail__pager" role="group" aria-label="File table pages">
            <button
              type="button"
              className="detail__page"
              aria-label="Previous file page"
              aria-disabled={!hasPreviousPage}
              onClick={() => { if (hasPreviousPage) onRankChange({ offset: filesOffset - rank.limit }); }}
              {...tooltipHandlers}
            >
              &lt;
              <Tooltip compact>Previous {count(rank.limit)} files</Tooltip>
            </button>
            <span className="detail__file-range">
              {files.length === 0
                ? "0"
                : `${count(filesOffset + 1)}-${count(filesOffset + files.length)}`}
            </span>
            <button
              type="button"
              className="detail__page"
              aria-label="Next file page"
              aria-disabled={!hasNextPage}
              onClick={() => { if (hasNextPage) onRankChange({ offset: filesOffset + rank.limit }); }}
              {...tooltipHandlers}
            >
              &gt;
              <Tooltip compact>Next {count(rank.limit)} files</Tooltip>
            </button>
            <span className="detail__file-count">{`of ${count(detail.shownFiles)} files`}</span>
          </div>
          <span className="detail__file-total">total {count(detail.availableFiles)} files scanned</span>
          {/* Not drawn for a `.` row: that selection is the folder's own files,
              and a switch offering the subtree would contradict every figure
              above it. */}
          {!SHOW_FILE_SCOPE_CONTROL || directFilesOnly ? null : (
            <div className="switch switch--compact" role="group" aria-label="How much of the folder the file list holds">
              {FILE_SCOPES.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className="switch__option"
                  aria-pressed={candidate === fileScope}
                  onClick={() => onFileScopeChange(candidate)}
                  {...tooltipHandlers}
                >
                  {FILE_SCOPE_DETAILS[candidate].label}
                  <Tooltip>{FILE_SCOPE_DETAILS[candidate].description}</Tooltip>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <FileTable
        files={files}
        measure={measure}
        aspect={aspect}
        isDiff={isDiff}
        sort={sort}
        onSortChange={onSortChange}
        displayRoot={path}
        onOpenSource={onOpenSource}
        onOpenListed={onOpenListed}
        emptyMessage={
          listsFolderOnly
            ? "No files sit directly in this folder under the current filters."
            : "No files match the current filters and scope."
        }
      />
    </section>
  );
}
