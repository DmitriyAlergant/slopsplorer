import { useEffect, useRef, useState } from "react";
import type { ScanMeta } from "../../shared/api.ts";
import { count, since } from "../format.ts";

interface Props {
  meta: ScanMeta | null;
  rescanning: boolean;
  opening: boolean;
  onRescan: () => void;
  onOpen: (root: string) => void;
  onInstallSkill: () => void;
}

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
            title={meta?.rootPath ?? ""}
            onClick={() => setEditingPath(true)}
            disabled={!meta || scanning}
          >
            {meta ? meta.rootPath : "Scanning the source tree"}
          </button>
        )}
      </div>

      <dl className="instrument__facts">
        <div className="fact">
          <dt>Tokenizer</dt>
          <dd>{meta?.tokenizer ?? "-"}</dd>
        </div>
        <div className="fact">
          <dt>Source</dt>
          <dd>{meta ? (meta.gitTracked ? "git index" : meta.respectsGitignore ? "walk + gitignore" : "walk, all files") : "-"}</dd>
        </div>
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
        <button type="button" className="button" onClick={() => setEditingPath(true)} disabled={!meta || scanning}>
          {opening ? "Opening" : "Open"}
        </button>
        <button type="button" className="button" onClick={onRescan} disabled={scanning}>
          {rescanning ? "Rescanning" : "Rescan"}
        </button>
        <button type="button" className="button button--quiet" onClick={onInstallSkill}>
          Install agent skill
        </button>
      </div>

      {meta && meta.skippedLargeFiles > 0 ? (
        <p className="instrument__note">
          {count(meta.skippedLargeFiles)} file{meta.skippedLargeFiles === 1 ? "" : "s"} skipped for exceeding the per-file size ceiling.
        </p>
      ) : null}
    </header>
  );
}
