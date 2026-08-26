import type { DetailView } from "../../shared/api.ts";
import { count, percent } from "../format.ts";
import { FileTable } from "./FileTable.tsx";
import { FlavorBar } from "./FlavorBar.tsx";

interface Props {
  detail: DetailView | null;
  onSelectFolder: (path: string) => void;
  onOpenSource: (path: string) => void;
}

/** The selected folder: its weight, how its children divide it, and its own files. */
export function FolderDetail({ detail, onSelectFolder, onOpenSource }: Props): React.JSX.Element {
  if (!detail) return <section className="panel detail" aria-label="Folder detail" />;

  const commentShare = detail.lines > 0 ? detail.commentLines / detail.lines : 0;

  return (
    <section className="panel detail" aria-label="Folder detail">
      <header className="detail__head">
        <div className="detail__identity">
          <p className="crumb">{detail.breadcrumb}</p>
          <h2>{detail.title}</h2>
          <p className="detail__stats">
            {count(detail.tokens)} tokens · {count(detail.files)} files · {count(detail.lines)} lines ·{" "}
            {percent(commentShare)} comment
          </p>
        </div>
        <p className="detail__share" title="Share of the project token baseline, excluding generated files">
          {percent(detail.shareOfProject)}
        </p>
      </header>

      {detail.cards.length > 0 ? (
        <div className="cards">
          {detail.cards.map((card, index) => {
            const body = (
              <>
                <span className="card__name">{card.name}</span>
                <span className="card__meta">
                  {count(card.tokens)} tok · {count(card.files)} files · {percent(card.shareOfParent)} here
                </span>
                <FlavorBar slices={card.flavors} scale={card.shareOfParent} />
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
        {count(detail.directFileCount)} file{detail.directFileCount === 1 ? "" : "s"} directly in this folder
      </p>
      <FileTable
        files={detail.directFiles}
        onOpenSource={onOpenSource}
        emptyMessage="No files sit directly in this folder under the current filters."
      />
    </section>
  );
}
