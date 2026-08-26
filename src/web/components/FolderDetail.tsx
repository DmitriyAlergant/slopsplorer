import { useEffect, useRef, useState } from "react";
import type { DetailView, Measure } from "../../shared/api.ts";
import { count, measureAbbreviation, measureName, percent } from "../format.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { FileTable } from "./FileTable.tsx";
import { FlavorBar } from "./FlavorBar.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  detail: DetailView | null;
  /** The measure the figures are in, taken from the response rather than the pending request. */
  measure: Measure;
  /** The selected folder: the path the copy control hands over, and the root that file names shorten against. */
  path: string;
  onSelectFolder: (path: string) => void;
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
export function FolderDetail({ detail, measure, path, onSelectFolder, canDrill, onDrill, onOpenSource, onCapacityChange }: Props): React.JSX.Element {
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

  const commentShare = detail.lines > 0 ? detail.commentLines / detail.lines : 0;
  const directFileCount = detail.directFiles.length;
  // Tokens are the cross-reference when they are not the headline themselves,
  // so the line always states the weight in two units.
  const stats = [
    `${count(detail.weight)} ${measureName(measure)}`,
    `${count(detail.files)} files`,
    measure === "tokens" ? `${count(detail.lines)} lines` : `${count(detail.tokens)} tokens`,
    `${percent(commentShare)} comment`,
  ];

  return (
    <section ref={panelRef} className="panel detail" aria-label="Folder detail">
      <header className="detail__head">
        <div className="detail__identity">
          <div className="detail__title-row">
            {canDrill ? (
              <button type="button" className="detail__tool detail__tool--drill" onClick={onDrill} {...tooltipHandlers} aria-label="Drill down" aria-describedby="drill-tooltip">
                <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                  <path d="M4 4v4.5A3.5 3.5 0 0 0 7.5 12H16m-4-4 4 4-4 4" />
                </svg>
                <Tooltip id="drill-tooltip" compact>Drill down</Tooltip>
              </button>
            ) : (
              // The slot stays open, so the heading does not jump left when a folder
              // cannot be drilled into.
              <span className="detail__tool detail__tool--absent" aria-hidden="true" />
            )}
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
          <p className="detail__stats">{stats.join(" · ")}</p>
        </div>
        <div className="detail__actions">
          <p className="detail__share" title="Share of the current scope, measured before any filter">
            {percent(detail.shareOfScope)}
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
                  {count(card.weight)} {measureAbbreviation(measure)} · {count(card.files)} files ·{" "}
                  {percent(card.shareOfScope)} of current scope
                </span>
                <FlavorBar slices={card.flavors} measure={measure} scale={card.shareOfScope} />
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

      <p className="detail__caption">
        {count(directFileCount)} file{directFileCount === 1 ? "" : "s"} directly in this folder
      </p>
      <FileTable
        files={detail.directFiles}
        measure={measure}
        displayRoot={path}
        prefixRelativePaths={false}
        onOpenSource={onOpenSource}
        emptyMessage="No files sit directly in this folder under the current filters."
      />
    </section>
  );
}
