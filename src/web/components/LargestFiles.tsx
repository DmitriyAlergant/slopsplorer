import type { FileRow, RankMetric, ViewRequest } from "../../shared/api.ts";
import { count } from "../format.ts";
import { FileTable } from "./FileTable.tsx";

interface Props {
  files: readonly FileRow[];
  total: number;
  /** The folder the ranking covers, shown so the panel cannot mislead. */
  scope: string;
  rank: ViewRequest["rank"];
  onRankChange: (change: Partial<ViewRequest["rank"]>) => void;
  onOpenSource: (path: string) => void;
}

const METRIC_LABELS: ReadonlyArray<{ metric: RankMetric; label: string }> = [
  { metric: "tokens", label: "Tokens" },
  { metric: "lines", label: "Lines" },
  { metric: "codeLines", label: "Code lines" },
  { metric: "commentLines", label: "Comment lines" },
  { metric: "functions", label: "Functions" },
  { metric: "classes", label: "Classes" },
  { metric: "branches", label: "Branch nodes" },
];

/** The ranked file list for whatever scope the tree currently describes. */
export function LargestFiles({ files, total, scope, rank, onRankChange, onOpenSource }: Props): React.JSX.Element {
  return (
    <section className="panel ranking" aria-label="Heaviest files in scope">
      <div className="panel__head">
        <div>
          <p className="eyebrow">Within {scope || "the selected folder"}</p>
          <h2>Heaviest files</h2>
        </div>
        <div className="ranking__controls">
          <label>
            <span>Rank by</span>
            <select
              value={rank.metric}
              onChange={(event) => onRankChange({ metric: event.target.value as RankMetric })}
            >
              {METRIC_LABELS.map(({ metric, label }) => (
                <option key={metric} value={metric}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Minimum tokens</span>
            <input
              type="number"
              min={0}
              step={500}
              value={rank.minTokens}
              onChange={(event) => onRankChange({ minTokens: Math.max(0, Number(event.target.value) || 0) })}
            />
          </label>
        </div>
      </div>

      <p className="detail__caption">
        Showing {count(files.length)} of {count(total)} matching files in this folder
      </p>
      <FileTable
        files={files}
        onOpenSource={onOpenSource}
        emptyMessage="No files match the current filters, scope, and minimum-token threshold."
      />
    </section>
  );
}
