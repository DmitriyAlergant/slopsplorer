import type { FileRow, Measure, RankMetric, ViewRequest } from "../../shared/api.ts";
import { count, measureName } from "../format.ts";
import { FileTable } from "./FileTable.tsx";

interface Props {
  files: readonly FileRow[];
  /** The measure the threshold is applied in, and the column the table highlights. */
  measure: Measure;
  total: number;
  /** Project-relative folder the ranking covers. */
  scopePath: string;
  /** Whether the ranking is limited to files directly inside its scope folder. */
  directFilesOnly: boolean;
  /** Name of the scan root, so the label reads as a whole path rather than a relative one. */
  rootName: string;
  /** Drill root that file names and the scope label should be relative to. */
  displayRoot: string;
  rank: ViewRequest["rank"];
  onRankChange: (change: Partial<ViewRequest["rank"]>) => void;
  onOpenSource: (path: string) => void;
}

const METRIC_LABELS: ReadonlyArray<{ metric: RankMetric; label: string }> = [
  { metric: "tokens", label: "Tokens" },
  { metric: "lines", label: "Lines" },
  { metric: "codeLines", label: "LOC" },
  { metric: "commentLines", label: "Comment lines" },
  { metric: "functions", label: "Functions" },
  { metric: "classes", label: "Classes" },
  { metric: "branches", label: "Branch nodes" },
];

/** A round step for each measure, so the spinner moves by a useful amount. */
const THRESHOLD_STEPS: Record<Measure, number> = { tokens: 500, lines: 50, codeLines: 50 };

/** The ranked file list for whatever scope the tree currently describes. */
export function LargestFiles({ files, measure, total, scopePath, directFilesOnly, rootName, displayRoot, rank, onRankChange, onOpenSource }: Props): React.JSX.Element {
  // The whole path from the scan root, so the heading names a place rather than
  // an offset from one. The rows below stay relative, which the caption states.
  const scopeSegments = scopePath ? scopePath.split("/") : [];
  const scopeLabel = [rootName, ...scopeSegments].join("/") + (directFilesOnly ? "/." : "");
  const truncated = files.length < total;
  return (
    <section className="panel ranking" aria-label="Heaviest files in scope">
      <div className="panel__head">
        <div>
          <p className="eyebrow">Within {scopeLabel}</p>
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
            <span>Minimum {measureName(measure)}</span>
            <input
              type="number"
              min={0}
              step={THRESHOLD_STEPS[measure]}
              value={rank.minWeight}
              onChange={(event) => onRankChange({ minWeight: Math.max(0, Number(event.target.value) || 0) })}
            />
          </label>
        </div>
      </div>

      {truncated ? (
        <p className="detail__caption">
          Showing the heaviest {count(files.length)} of {count(total)} matching files
        </p>
      ) : null}
      <FileTable
        files={files}
        measure={measure}
        displayRoot={displayRoot}
        prefixRelativePaths
        onOpenSource={onOpenSource}
        emptyMessage={`No files match the current filters, scope, and minimum ${measureName(measure)} threshold.`}
      />
    </section>
  );
}
