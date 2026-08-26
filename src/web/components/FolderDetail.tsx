import { useEffect, useRef, useState } from "react";
import type { DetailView } from "../../shared/api.ts";
import { count, percent } from "../format.ts";
import { FileTable } from "./FileTable.tsx";
import { FlavorBar } from "./FlavorBar.tsx";

interface Props {
  detail: DetailView | null;
  filePathRoot: string;
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
export function FolderDetail({ detail, filePathRoot, onSelectFolder, canDrill, onDrill, onOpenSource, onCapacityChange }: Props): React.JSX.Element {
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

  return (
    <section ref={panelRef} className="panel detail" aria-label="Folder detail">
      <header className="detail__head">
        <div className="detail__identity">
          {detail.breadcrumb ? <p className="crumb">{detail.breadcrumb}</p> : null}
          <h2>{detail.title}</h2>
          <p className="detail__stats">
            {count(detail.tokens)} tokens · {count(detail.files)} files · {count(detail.lines)} lines ·{" "}
            {percent(commentShare)} comment
          </p>
        </div>
        <div className="detail__actions">
          <p className="detail__share" title="Share of the current scope, measured before any filter">
            {percent(detail.shareOfScope)}
          </p>
          {canDrill ? (
            <button type="button" className="button button--tiny" onClick={onDrill}>Drill down</button>
          ) : null}
        </div>
      </header>

      {detail.cards.length > 0 ? (
        <div className="cards" style={{ "--card-columns": detail.cardColumns } as React.CSSProperties}>
          {detail.cards.map((card, index) => {
            const body = (
              <>
                <span className="card__name">{card.name}</span>
                <span className="card__meta">
                  {count(card.tokens)} tok · {count(card.files)} files · {percent(card.shareOfScope)} of current scope
                </span>
                <FlavorBar slices={card.flavors} scale={card.shareOfScope} />
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
        displayRoot={filePathRoot}
        onOpenSource={onOpenSource}
        emptyMessage="No files sit directly in this folder under the current filters."
      />
    </section>
  );
}
