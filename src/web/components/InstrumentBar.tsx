import { useEffect, useRef, useState } from "react";
import type { ComparisonRequest, FileSource, ScanMeta } from "../../shared/api.ts";
import { countOf, since } from "../format.ts";
import { ComparisonPicker } from "./ComparisonPicker.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  meta: ScanMeta | null;
  rescanning: boolean;
  /** A measurement is running, so nothing may start another one. */
  scanning: boolean;
  onRescan: () => void;
  onOpen: (root: string) => void;
  onCompare: (comparison: ComparisonRequest) => void;
  onInstallSkill: () => void;
}

/** Where a file list came from, named in the reader's terms rather than ours. */
const FILE_SOURCE_LABELS: Readonly<Record<FileSource, string>> = {
  "git-index": "git index",
  "walk-gitignore": "walk + gitignore",
  "walk-all": "walk, all files",
  "git-diff": "git diff",
};

/** The fixed readout strip: what was measured, how, and how long ago. */
export function InstrumentBar({ meta, rescanning, scanning, onRescan, onOpen, onCompare, onInstallSkill }: Props): React.JSX.Element {
  const [editingPath, setEditingPath] = useState(false);
  const [pathValue, setPathValue] = useState(meta?.rootPath ?? "");
  const pathInput = useRef<HTMLInputElement>(null);
  const diff = meta?.diff ?? null;

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
        <div className="instrument__title">
          {/* The wordmark says which of the two questions the page answers,
              because every figure below it means something different in each. */}
          <h1 className="wordmark">{diff ? "Slopsplorer diff" : "Slopsplorer"}</h1>
          {/* What is compared outranks every other fact in the strip, so it
              sits beside the wordmark rather than among them. */}
          {diff ? <ComparisonPicker diff={diff} disabled={scanning} onCompare={onCompare} /> : null}
        </div>

        {/* A comparison belongs to one repository, so only a scan can be
            re-aimed at another folder. */}
        {diff ? (
          <p className="instrument__root">{meta ? meta.rootPath : ""}</p>
        ) : editingPath ? (
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
        <div className="fact">
          <dt>Source</dt>
          <dd>{meta ? FILE_SOURCE_LABELS[meta.fileSource] : "-"}</dd>
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
        <button type="button" className="button" onClick={onRescan} disabled={scanning}>
          {rescanning ? (diff ? "Comparing" : "Rescanning") : (diff ? "Recompare" : "Rescan")}
        </button>
        <button type="button" className="button" onClick={onInstallSkill}>
          Install agent skill
        </button>
      </div>

      {meta && meta.skippedLargeFiles > 0 ? (
        <p className="instrument__note">
          {countOf(meta.skippedLargeFiles, "file")} skipped for exceeding the per-file size ceiling.
        </p>
      ) : null}
    </header>
  );
}
