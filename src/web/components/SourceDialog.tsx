import { useEffect, useState } from "react";
import { useModalDialog } from "../dialog.ts";
import type { FileRow, Measure, SourceResponse } from "../../shared/api.ts";
import { fetchSkillSource, fetchSource } from "../api.ts";
import { count, countOf, messageOf } from "../format.ts";
import {
  browserStorage, readChangedLinesOnly, readWrapLines, writeChangedLinesOnly, writeWrapLines,
} from "../preferences.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { FilePreview } from "./FilePreview.tsx";
import { FileStack } from "./FileStack.tsx";

/**
 * What the preview draws: one file of the open index, every file the folder
 * panel lists, or the bundled agent skill.
 *
 * The `files` preview carries the rows it was opened with, and the measure they
 * were drawn in, so the list a reader is walking cannot change under them while
 * the page behind the dialog answers a later request.
 */
export type Preview =
  | { kind: "file"; path: string }
  | {
    kind: "files";
    /** The selection the rows come from: a folder path, or the project name at the root. */
    title: string;
    rows: readonly FileRow[];
    /** How many files matched before the panel's limit, so a curtailed stack can say so. */
    total: number;
    measure: Measure;
    isDiff: boolean;
  }
  | { kind: "skill" };

interface Props {
  preview: Preview | null;
  onClose: () => void;
  loadSource?: (path: string) => Promise<SourceResponse>;
}

/**
 * Read-only preview of one file or of a whole selection, highlighted client-side.
 *
 * Inside a comparison a file has two contents, so the preview is the change.
 * Showing the after-image alone would be a claim the page cannot support.
 */
export function SourceDialog({ preview, onClose, loadSource = fetchSource }: Props): React.JSX.Element {
  const dialogRef = useModalDialog(preview !== null);
  const [source, setSource] = useState<SourceResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [changedOnly, setChangedOnly] = useState(() => readChangedLinesOnly(browserStorage()));
  const [wrap, setWrap] = useState(() => readWrapLines(browserStorage()));

  const stack = preview?.kind === "files" ? preview : null;

  useEffect(() => {
    if (preview === null || preview.kind === "files") return;
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
  const title = stack ? stack.title : filePath ?? source?.path ?? "";
  const isDiff = stack ? stack.isDiff : source?.mode === "diff";
  // A stack is drawn from rows the page already holds, so its switches are
  // offered at once rather than after the first file arrives.
  const loaded = stack !== null || source !== null;

  return (
    <dialog ref={dialogRef} className="viewer" onClose={onClose} onCancel={onClose}>
      <header className="viewer__head">
        <div>
          <p className="eyebrow">
            {stack
              ? stack.rows.length < stack.total
                ? `${count(stack.rows.length)} of ${countOf(stack.total, "match")}, in path order`
                : `${countOf(stack.rows.length, "file")}, in path order`
              : isDiff ? "File comparison" : "Read-only preview"}
          </p>
          <div className="viewer__title-row">
            <h2>{title}</h2>
            {filePath ? <CopyPathButton path={filePath} /> : null}
          </div>
        </div>
        <div className="viewer__actions">
          {isDiff ? (
            <label className="viewer__toggle" data-on={changedOnly}>
              <input type="checkbox" role="switch" checked={changedOnly} onChange={toggleChangedOnly} />
              Only changed lines
            </label>
          ) : null}
          {loaded ? (
            <label className="viewer__toggle" data-on={wrap}>
              <input type="checkbox" role="switch" checked={wrap} onChange={toggleWrap} />
              Wrap lines
            </label>
          ) : null}
          <button type="button" className="button button--quiet" onClick={onClose}>Close</button>
        </div>
      </header>
      <div className="viewer__body" data-wrap={wrap}>
        {stack ? (
          <FileStack
            rows={stack.rows}
            measure={stack.measure}
            isDiff={stack.isDiff}
            changedOnly={changedOnly}
            loadSource={loadSource}
          />
        ) : (
          <FilePreview source={source} failure={failure} changedOnly={changedOnly} />
        )}
      </div>
    </dialog>
  );
}
