import { useEffect, useState } from "react";
import { useModalDialog } from "../dialog.ts";
import type { SourceResponse } from "../../shared/api.ts";
import { fetchSkillSource, fetchSource } from "../api.ts";
import { count, messageOf } from "../format.ts";
import { highlightSource } from "../highlight.ts";
import {
  browserStorage, readChangedLinesOnly, readWrapLines, writeChangedLinesOnly, writeWrapLines,
} from "../preferences.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { DiffView } from "./DiffView.tsx";

/** What the preview draws: a file of the open index, or the bundled agent skill. */
export type Preview = { kind: "file"; path: string } | { kind: "skill" };

interface Props {
  preview: Preview | null;
  onClose: () => void;
  loadSource?: (path: string) => Promise<SourceResponse>;
}

/**
 * Read-only preview of one file, highlighted client-side.
 *
 * Inside a comparison the file has two contents, so the preview is the change,
 * drawn by {@link DiffView}. Showing the after-image alone would be a claim the
 * page cannot support.
 */
export function SourceDialog({ preview, onClose, loadSource = fetchSource }: Props): React.JSX.Element {
  const dialogRef = useModalDialog(preview !== null);
  const [source, setSource] = useState<SourceResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [changedOnly, setChangedOnly] = useState(() => readChangedLinesOnly(browserStorage()));
  const [wrap, setWrap] = useState(() => readWrapLines(browserStorage()));

  useEffect(() => {
    if (preview === null) return;
    setSource(null);
    setFailure(null);
    let cancelled = false;
    const loading = preview.kind === "skill" ? fetchSkillSource() : loadSource(preview.path);
    loading
      .then((loaded) => { if (!cancelled) setSource(loaded); })
      .catch((cause: unknown) => { if (!cancelled) setFailure(messageOf(cause)); });
    return () => { cancelled = true; };
  }, [loadSource, preview]);

  const toggleChangedOnly = (): void => {
    const changed = !changedOnly;
    setChangedOnly(changed);
    writeChangedLinesOnly(browserStorage(), changed);
  };

  const toggleWrap = (): void => {
    const wrapped = !wrap;
    setWrap(wrapped);
    writeWrapLines(browserStorage(), wrapped);
  };

  // A scanned file names itself before it loads; the skill is named by the server.
  const filePath = preview?.kind === "file" ? preview.path : null;
  const title = filePath ?? source?.path ?? "";

  return (
    <dialog ref={dialogRef} className="viewer" onClose={onClose} onCancel={onClose}>
      <header className="viewer__head">
        <div>
          <p className="eyebrow">{source?.mode === "diff" ? "File comparison" : "Read-only preview"}</p>
          <div className="viewer__title-row">
            <h2>{title}</h2>
            {filePath ? <CopyPathButton path={filePath} /> : null}
          </div>
        </div>
        <div className="viewer__actions">
          {source?.mode === "diff" ? (
            <label className="viewer__toggle" data-on={changedOnly}>
              <input type="checkbox" role="switch" checked={changedOnly} onChange={toggleChangedOnly} />
              Only changed lines
            </label>
          ) : null}
          {source ? (
            <label className="viewer__toggle" data-on={wrap}>
              <input type="checkbox" role="switch" checked={wrap} onChange={toggleWrap} />
              Wrap lines
            </label>
          ) : null}
          <button type="button" className="button button--quiet" onClick={onClose}>Close</button>
        </div>
      </header>
      <div className="viewer__body" data-wrap={wrap}>
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
