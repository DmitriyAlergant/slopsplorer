import { useEffect, useRef, useState } from "react";
import type { DetailView } from "../../shared/api.ts";
import { count, percent } from "../format.ts";
import { FileTable } from "./FileTable.tsx";
import { FlavorBar } from "./FlavorBar.tsx";

interface Props {
  detail: DetailView | null;
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
export function FolderDetail({ detail, path, onSelectFolder, canDrill, onDrill, onOpenSource, onCapacityChange }: Props): React.JSX.Element {
  const panelRef = useRef<HTMLElement>(null);
  const [columns, setColumns] = useState(3);
  const [copied, setCopied] = useState(false);

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

  // The confirmation lives on the button itself, so it has to reset when the
  // selection moves on rather than linger over a different folder's path.
  useEffect(() => {
    setCopied(false);
  }, [path]);

  const copyPath = (): void => {
    void navigator.clipboard.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  if (!detail) return <section ref={panelRef} className="panel detail" aria-label="Folder detail" />;

  const commentShare = detail.lines > 0 ? detail.commentLines / detail.lines : 0;
  const directFileCount = detail.directFiles.length;

  return (
    <section ref={panelRef} className="panel detail" aria-label="Folder detail">
      <header className="detail__head">
        <div className="detail__identity">
          {detail.breadcrumb ? <p className="crumb">{detail.breadcrumb}</p> : null}
          <div className="detail__title-row">
            {canDrill ? (
              <button type="button" className="detail__tool detail__tool--drill" onClick={onDrill} aria-label="Drill down" aria-describedby="drill-tooltip">
                <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                  <path d="M4 4v4.5A3.5 3.5 0 0 0 7.5 12H16m-4-4 4 4-4 4" />
                </svg>
                <span className="detail__tooltip" id="drill-tooltip" role="tooltip">Drill down</span>
              </button>
            ) : null}
            <h2>{detail.title}</h2>
            {path ? (
              <button
                type="button"
                className="detail__tool detail__tool--copy"
                onClick={copyPath}
                aria-label={copied ? "Path copied" : "Copy path"}
                aria-describedby="copy-path-tooltip"
              >
                <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                  {copied ? (
                    <path d="m4 10.5 4 4 8-9" />
                  ) : (
                    <>
                      <rect x="7" y="7" width="9.5" height="9.5" rx="1.8" />
                      <path d="M4.6 12.5H4A1.5 1.5 0 0 1 2.5 11V5A1.5 1.5 0 0 1 4 3.5h6A1.5 1.5 0 0 1 11.5 5v.6" />
                    </>
                  )}
                </svg>
                <span className="detail__tooltip" id="copy-path-tooltip" role="tooltip">
                  {copied ? "Copied" : "Copy path"}
                </span>
              </button>
            ) : null}
          </div>
          <p className="detail__stats">
            {count(detail.tokens)} tokens · {count(detail.files)} files · {count(detail.lines)} lines ·{" "}
            {percent(commentShare)} comment
          </p>
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
        displayRoot={path}
        onOpenSource={onOpenSource}
        emptyMessage="No files sit directly in this folder under the current filters."
      />
    </section>
  );
}
