import { useEffect, useState } from "react";
import { useModalDialog } from "../dialog.ts";
import type { FileListResponse, Measure, SourceResponse, ViewRequest } from "../../shared/api.ts";
import { fetchSkillSource, fetchSource } from "../api.ts";
import { countOf, messageOf } from "../format.ts";
import {
  browserStorage, readChangedLinesOnly, readWrapLines, writeChangedLinesOnly, writeWrapLines,
} from "../preferences.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { FilePreview } from "./FilePreview.tsx";
import { FileStack, foldedAfterFoldAll } from "./FileStack.tsx";

/**
 * What the preview draws: one file of the open index, every file the folder
 * panel lists, or the bundled agent skill.
 *
 * The `files` preview carries the request it was opened with and loads the
 * complete matching list inside the modal. A later table page cannot change it.
 */
export type Preview =
  | { kind: "file"; path: string }
  | {
    kind: "files";
    /** The selection the rows come from: a folder path, or the project name at the root. */
    title: string;
    /** The view that defines the complete matching selection. */
    request: ViewRequest;
    /** Match count shown while the modal loads the complete list. */
    total: number;
    measure: Measure;
    isDiff: boolean;
  }
  | { kind: "skill" };

interface Props {
  preview: Preview | null;
  onClose: () => void;
  loadSource?: (path: string) => Promise<SourceResponse>;
  loadFileList: (request: ViewRequest, signal?: AbortSignal) => Promise<FileListResponse>;
}

/** The same set with one path folded, or unfolded when it was already folded. */
function toggledPath(folded: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(folded);
  if (!next.delete(path)) next.add(path);
  return next;
}

/**
 * Read-only preview of one file or of a whole selection, highlighted client-side.
 *
 * Inside a comparison a file has two contents, so the preview is the change.
 * Showing the after-image alone would be a claim the page cannot support.
 */
export function SourceDialog({ preview, onClose, loadSource = fetchSource, loadFileList }: Props): React.JSX.Element {
  const dialogRef = useModalDialog(preview !== null);
  const [source, setSource] = useState<SourceResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stackRows, setStackRows] = useState<FileListResponse["rows"] | null>(null);
  /** Paths folded away in the open stack. A new selection arrives with every file open. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
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

  useEffect(() => {
    if (stack === null) return;
    const controller = new AbortController();
    setStackRows(null);
    setFailure(null);
    setFolded(new Set());
    loadFileList(stack.request, controller.signal)
      .then((loaded) => setStackRows(loaded.rows))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setFailure(messageOf(cause));
      });
    return () => controller.abort();
  }, [loadFileList, stack]);

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
  // The request already states the mode, so the stack switch appears before
  // the complete file list arrives.
  const loaded = stack !== null ? stackRows !== null : source !== null;

  return (
    <dialog ref={dialogRef} className="viewer" onClose={onClose} onCancel={onClose}>
      <header className="viewer__head">
        <div>
          <p className="eyebrow">
            {stack
              ? `${countOf(stack.total, "file")}, in path order`
              : isDiff ? "File comparison" : "Read-only preview"}
          </p>
          <div className="viewer__title-row">
            <h2>{title}</h2>
            {filePath ? <CopyPathButton path={filePath} /> : null}
          </div>
        </div>
        <div className="viewer__actions">
          {/* One control for the whole stack, beside the two that also act on
              every file it draws. A file folds by its own name, as it does in
              the tree. */}
          {stackRows ? (
            <button
              type="button"
              className="button"
              onClick={() => setFolded(foldedAfterFoldAll(stackRows, folded))}
            >
              {folded.size > 0 ? "Expand all" : "Collapse all"}
            </button>
          ) : null}
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
          <button type="button" className="button" onClick={onClose}>Close</button>
        </div>
      </header>
      <div className="viewer__body" data-wrap={wrap}>
        {stack && stackRows ? (
          <FileStack
            rows={stackRows}
            measure={stack.measure}
            isDiff={stack.isDiff}
            changedOnly={changedOnly}
            loadSource={loadSource}
            folded={folded}
            onToggleFile={(path) => setFolded(toggledPath(folded, path))}
          />
        ) : stack ? (
          <FilePreview source={null} failure={failure} changedOnly={changedOnly} />
        ) : (
          <FilePreview source={source} failure={failure} changedOnly={changedOnly} />
        )}
      </div>
    </dialog>
  );
}
