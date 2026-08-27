import { useEffect, useRef, useState } from "react";
import type { SourceResponse } from "../../shared/api.ts";
import { fetchSource } from "../api.ts";
import { count } from "../format.ts";
import { highlightSource } from "../highlight.ts";
import { readChangedLinesOnly, writeChangedLinesOnly } from "../preferences.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { DiffView } from "./DiffView.tsx";

interface Props {
  path: string | null;
  onClose: () => void;
}

function changedLinesOnlyFromStorage(): boolean {
  try {
    return readChangedLinesOnly(window.localStorage);
  } catch {
    return false;
  }
}

/**
 * Read-only preview of one file, highlighted client-side.
 *
 * Inside a comparison the file has two contents, so the preview is the change,
 * drawn by {@link DiffView}. Showing the after-image alone would be a claim the
 * page cannot support.
 */
export function SourceDialog({ path, onClose }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<SourceResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [changedOnly, setChangedOnly] = useState(changedLinesOnlyFromStorage);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (path === null) {
      if (dialog.open) dialog.close();
      return;
    }
    setSource(null);
    setFailure(null);
    if (!dialog.open) dialog.showModal();
    let cancelled = false;
    fetchSource(path)
      .then((loaded) => { if (!cancelled) setSource(loaded); })
      .catch((cause: unknown) => { if (!cancelled) setFailure(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [path]);

  const toggleChangedOnly = (): void => {
    const changed = !changedOnly;
    setChangedOnly(changed);
    writeChangedLinesOnly(window.localStorage, changed);
  };

  return (
    <dialog ref={dialogRef} className="viewer" onClose={onClose} onCancel={onClose}>
      <header className="viewer__head">
        <div>
          <p className="eyebrow">{source?.mode === "diff" ? "File comparison" : "Read-only preview"}</p>
          <div className="viewer__title-row">
            <h2>{path ?? ""}</h2>
            {path ? <CopyPathButton path={path} /> : null}
          </div>
        </div>
        <div className="viewer__actions">
          {source?.mode === "diff" ? (
            <label className="viewer__toggle" data-on={changedOnly}>
              <input type="checkbox" checked={changedOnly} onChange={toggleChangedOnly} />
              Only changed lines
            </label>
          ) : null}
          <button type="button" className="button button--quiet" onClick={onClose}>Close</button>
        </div>
      </header>
      <div className="viewer__body">
        {failure ? <p className="empty">{failure}</p> : null}
        {!failure && !source ? <p className="empty">Loading source</p> : null}
        {source?.mode === "diff" && source.lines.every((line) => line.marker === " ") ? (
          <p className="empty">This comparison reports no textual change for the file.</p>
        ) : null}
        {source?.mode === "diff" && source.lines.some((line) => line.marker !== " ") ? (
          <DiffView path={source.path} lines={source.lines} changedOnly={changedOnly} />
        ) : null}
        {source?.mode === "source" ? (
          <pre className="viewer__code">
            <code dangerouslySetInnerHTML={{ __html: highlightSource(source.path, source.content) }} />
          </pre>
        ) : null}
        {source?.truncated ? (
          <p className="viewer__note">
            Preview truncated at 512 KiB of {count(source.totalBytes)} bytes.
          </p>
        ) : null}
      </div>
    </dialog>
  );
}
