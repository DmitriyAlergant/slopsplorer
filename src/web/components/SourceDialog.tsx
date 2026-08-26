import { useEffect, useRef, useState } from "react";
import type { SourceResponse } from "../../shared/api.ts";
import { fetchSource } from "../api.ts";
import { count } from "../format.ts";
import { highlightSource } from "../highlight.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";

interface Props {
  path: string | null;
  onClose: () => void;
}

/** Read-only preview of one file from the scan, highlighted client-side. */
export function SourceDialog({ path, onClose }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<SourceResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

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

  return (
    <dialog ref={dialogRef} className="viewer" onClose={onClose} onCancel={onClose}>
      <header className="viewer__head">
        <div>
          <p className="eyebrow">Read-only preview</p>
          <div className="viewer__title-row">
            <h2>{path ?? ""}</h2>
            {path ? <CopyPathButton path={path} /> : null}
          </div>
        </div>
        <button type="button" className="button button--quiet" onClick={onClose}>Close</button>
      </header>
      <div className="viewer__body">
        {failure ? <p className="empty">{failure}</p> : null}
        {!failure && !source ? <p className="empty">Loading source</p> : null}
        {source ? (
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
