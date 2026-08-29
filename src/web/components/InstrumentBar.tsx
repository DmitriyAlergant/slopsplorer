import { useEffect, useRef, useState } from "react";
import type {
  AgentTool, ComparisonRequest, FileSource, ReviewMode, ScanMeta, SnapshotBacklink,
} from "../../shared/api.ts";
import { countOf, since } from "../format.ts";
import { AgentPicker } from "./AgentPicker.tsx";
import { ComparisonPicker } from "./ComparisonPicker.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  meta: ScanMeta | null;
  /** A frozen public artifact has no source-machine operations. */
  staticSnapshot?: boolean;
  /** Review page that supplied the comparison, when one was named by URL. */
  backlink?: SnapshotBacklink | null;
  rescanning: boolean;
  /** A measurement is running, so nothing may start another one. */
  scanning: boolean;
  onRescan: () => void;
  onOpen: (root: string) => void;
  onCompare: (comparison: ComparisonRequest) => void;
  onReviewMode: (mode: ReviewMode) => void;
  /** Agents this host can run. No agent, no control: there is nothing to ask. */
  agents: readonly AgentTool[];
  agentId: string;
  onChooseAgent: (agentId: string) => void;
  onAsk: () => void;
}

/** Where a file list came from, named in the reader's terms rather than ours. */
const FILE_SOURCE_LABELS: Readonly<Record<FileSource, string>> = {
  "git-index": "git index",
  "git-tree": "git tree",
  "walk-gitignore": "walk + gitignore",
  "walk-all": "walk, all files",
  "git-diff": "git diff",
};

/** The fixed readout strip: what was measured, how, and how long ago. */
export function InstrumentBar({
  meta, staticSnapshot = false, backlink = null, rescanning, scanning,
  onRescan, onOpen, onCompare, onReviewMode, agents, agentId, onChooseAgent, onAsk,
}: Props): React.JSX.Element {
  const [editingPath, setEditingPath] = useState(false);
  const [pathValue, setPathValue] = useState(meta?.rootPath ?? "");
  const pathInput = useRef<HTMLInputElement>(null);
  const diff = meta?.diff ?? null;
  const review = meta?.review ?? null;

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
      <img
        className="instrument__mark"
        src={staticSnapshot ? "./hero.jpg" : "/hero.jpg"}
        alt=""
        width={59}
        height={64}
      />

      <div className="instrument__identity">
        <div className="instrument__title">
          {/* The wordmark says which of the two questions the page answers,
              because every figure below it means something different in each. */}
          <h1 className="wordmark">{diff ? "Slopsplorer diff" : "Slopsplorer"}</h1>
          {staticSnapshot ? <span className="instrument__snapshot">Static snapshot</span> : null}
          {staticSnapshot && backlink ? (
            <a
              className="instrument__backlink"
              href={backlink.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${backlink.label}`}
            >
              <span>{backlink.label}</span>
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M6 3h7v7M13 3 6 10M11 9v4H3V5h4" />
              </svg>
            </a>
          ) : null}
          {/* What is compared outranks every other fact in the strip, so it
              sits beside the wordmark rather than among them. */}
          {review ? (
            staticSnapshot
              ? <span className="instrument__comparison">{review.base} &rarr; {review.target}</span>
              : <ComparisonPicker comparison={review} disabled={scanning} onCompare={onCompare} />
          ) : null}
          {!staticSnapshot && review ? (
            <div className="switch switch--compact instrument__review-switch" role="group" aria-label="Review view">
              {(["before", "diff", "after"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="switch__option"
                  aria-pressed={review.mode === mode}
                  disabled={scanning}
                  onClick={() => onReviewMode(mode)}
                >
                  {mode === "diff" ? "Diff" : mode === "before" ? "Before" : "After"}
                </button>
              ))}
            </div>
          ) : null}
          {/* Measuring again is the same act on either side of what it re-reads,
              so it stays beside what it would re-read rather than across the bar. */}
          {staticSnapshot ? null : <button
            type="button"
            className="instrument__remeasure"
            onClick={onRescan}
            disabled={scanning}
            aria-label={diff ? "Recompare" : "Rescan"}
            {...tooltipHandlers}
          >
            <svg
              className={rescanning ? "spinning" : undefined}
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
            <Tooltip compact>
              {rescanning ? (diff ? "Comparing" : "Rescanning") : (diff ? "Recompare" : "Rescan")}
            </Tooltip>
          </button>}
        </div>

        {/* A comparison belongs to one repository, so only a scan can be
            re-aimed at another folder. */}
        {staticSnapshot ? (
          <p className="instrument__root">{meta?.rootName ?? "Static source tree"}</p>
        ) : review ? (
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

      <div className="instrument__right">
        {/* Beside the facts about the measurement, because asking is an act on
            the whole page rather than on any one panel of it. */}
        {agents.length > 0 ? (
          <AgentPicker agents={agents} agentId={agentId} onChoose={onChooseAgent} onAsk={onAsk} />
        ) : null}
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
            <dt>Scanned</dt>
            <dd>{meta ? since(meta.scannedAt) : "-"}</dd>
          </div>
        </dl>
      </div>

      {meta && meta.skippedLargeFiles > 0 ? (
        <p className="instrument__note">
          {countOf(meta.skippedLargeFiles, "file")} skipped for exceeding the per-file size ceiling.
        </p>
      ) : null}
    </header>
  );
}
