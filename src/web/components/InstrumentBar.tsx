import { useEffect, useRef, useState } from "react";
import type { FileSource, ScanMeta } from "../../shared/api.ts";
import { count, since } from "../format.ts";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  meta: ScanMeta | null;
  rescanning: boolean;
  opening: boolean;
  onRescan: () => void;
  onOpen: (root: string) => void;
  onInstallSkill: () => void;
}

/** Where a file list came from, named in the reader's terms rather than ours. */
const FILE_SOURCE_LABELS: Readonly<Record<FileSource, string>> = {
  "git-index": "git index",
  "walk-gitignore": "walk + gitignore",
  "walk-all": "walk, all files",
  "git-diff": "git diff",
};

/** The fixed readout strip: what was scanned, how, and how long ago. */
export function InstrumentBar({ meta, rescanning, opening, onRescan, onOpen, onInstallSkill }: Props): React.JSX.Element {
  const [editingPath, setEditingPath] = useState(false);
  const [pathValue, setPathValue] = useState(meta?.rootPath ?? "");
  const pathInput = useRef<HTMLInputElement>(null);
  const scanning = rescanning || opening;

  useEffect(() => {
    if (!editingPath) setPathValue(meta?.rootPath ?? "");
  }, [editingPath, meta?.rootPath]);

  useEffect(() => {
    if (!editingPath) return;
    pathInput.current?.focus();
    pathInput.current?.select();
  }, [editingPath]);

  const cancelEditing = (): void => {
    setPathValue(meta?.rootPath ?? "");
    setEditingPath(false);
  };

  const submitPath = (event: React.FormEvent): void => {
    event.preventDefault();
    const root = pathValue.trim();
    if (!root || root === meta?.rootPath) {
      cancelEditing();
      return;
    }
    setEditingPath(false);
    onOpen(root);
  };

  return (
    <header className="instrument">
      <div className="instrument__identity">
        <h1 className="wordmark">Slopsplorer</h1>
        {editingPath ? (
          <form className="instrument__path-form" onSubmit={submitPath}>
            <label className="visually-hidden" htmlFor="scan-root">Absolute directory path</label>
            <input
              ref={pathInput}
              id="scan-root"
              className="instrument__path-input"
              value={pathValue}
              onChange={(event) => setPathValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") cancelEditing();
              }}
              disabled={scanning}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="instrument__path-hint">Enter to open / Esc to cancel</span>
          </form>
        ) : (
          <button
            type="button"
            className="instrument__path"
            onClick={() => setEditingPath(true)}
            disabled={!meta || scanning}
            {...tooltipHandlers}
          >
            {meta ? meta.rootPath : "Scanning the source tree"}
            <Tooltip compact>{meta ? `${meta.rootPath} - click to scan another folder` : "Scanning the source tree"}</Tooltip>
          </button>
        )}
      </div>

      <dl className="instrument__facts">
        <div className="fact">
          <dt>Tokenizer</dt>
          <dd>{meta?.tokenizer ?? "-"}</dd>
        </div>
        {/* The comparison replaces the file-list source in a diff: which two
            things were measured matters far more than how they were listed. */}
        {meta?.diff ? (
          <div className="fact fact--wide">
            <dt>Comparing</dt>
            <dd {...tooltipHandlers}>
              <span className="fact__rev">{meta.diff.base}</span>
              <span className="fact__arrow" aria-hidden="true">-&gt;</span>
              <span className="fact__rev">{meta.diff.target}</span>
              <Tooltip compact>
                {`${meta.diff.filesAdded} added, ${meta.diff.filesModified} modified, `
                  + `${meta.diff.filesDeleted} deleted, ${meta.diff.filesRenamed} renamed`}
              </Tooltip>
            </dd>
          </div>
        ) : (
          <div className="fact">
            <dt>Source</dt>
            <dd>{meta ? FILE_SOURCE_LABELS[meta.fileSource] : "-"}</dd>
          </div>
        )}
        <div className="fact">
          <dt>Grammars</dt>
          <dd>{meta && meta.languages.length > 0 ? meta.languages.length : "-"}</dd>
        </div>
        <div className="fact">
          <dt>Scanned</dt>
          <dd>{meta ? since(meta.scannedAt) : "-"}</dd>
        </div>
      </dl>

      <div className="instrument__actions">
        <button type="button" className="button" onClick={onRescan} disabled={scanning}>
          {rescanning ? (meta?.diff ? "Comparing" : "Rescanning") : (meta?.diff ? "Recompare" : "Rescan")}
        </button>
        <button type="button" className="button" onClick={onInstallSkill}>
          Install agent skill
        </button>
      </div>

      {meta && meta.skippedLargeFiles > 0 ? (
        <p className="instrument__note">
          {count(meta.skippedLargeFiles)} file{meta.skippedLargeFiles === 1 ? "" : "s"} skipped for exceeding the per-file size ceiling.
        </p>
      ) : null}
      {meta?.diff && meta.diff.cappedFiles > 0 ? (
        <p className="instrument__note">
          {count(meta.diff.cappedFiles)} file{meta.diff.cappedFiles === 1 ? "" : "s"} changed too widely to align line by line, counted as fully replaced.
        </p>
      ) : null}
    </header>
  );
}
