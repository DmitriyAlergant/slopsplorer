import type { ScanMeta } from "../../shared/api.ts";
import { count, since } from "../format.ts";

interface Props {
  meta: ScanMeta | null;
  rescanning: boolean;
  onRescan: () => void;
  onInstallSkill: () => void;
}

/** The fixed readout strip: what was scanned, how, and how long ago. */
export function InstrumentBar({ meta, rescanning, onRescan, onInstallSkill }: Props): React.JSX.Element {
  return (
    <header className="instrument">
      <div className="instrument__identity">
        <h1 className="wordmark">Slopsplorer</h1>
        <p className="instrument__path" title={meta?.rootPath ?? ""}>
          {meta ? meta.rootPath : "Scanning the source tree"}
        </p>
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
        <button type="button" className="button" onClick={onRescan} disabled={rescanning}>
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
