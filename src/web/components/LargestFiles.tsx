import type { FileRow, Measure, RankMetric, ViewRequest } from "../../shared/api.ts";
import { DEFAULT_RANKING_HEIGHT, MAX_RANKING_HEIGHT, MIN_RANKING_HEIGHT } from "../preferences.ts";
import { count, measureName } from "../format.ts";
import { FileTable } from "./FileTable.tsx";
import { HeightSplitter } from "./Splitter.tsx";

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
  /** Height the list is capped at, dragged from the boundary under it. */
  height: number;
  onHeightChange: (height: number) => void;
  onRankChange: (change: Partial<ViewRequest["rank"]>) => void;
  /** Ranking order, chosen by sorting a column rather than by a control of its own. */
  onSortChange: (metric: RankMetric) => void;
  onOpenSource: (path: string) => void;
}

/** A round step for each measure, so the spinner moves by a useful amount. */
const THRESHOLD_STEPS: Record<Measure, number> = { tokens: 500, lines: 50, codeLines: 50 };

/** The ranked file list for whatever scope the tree currently describes. */
export function LargestFiles({ files, measure, total, scopePath, directFilesOnly, rootName, displayRoot, rank, height, onHeightChange, onRankChange, onSortChange, onOpenSource }: Props): React.JSX.Element {
  // The whole path from the scan root, so the heading names a place rather than
  // an offset from one. The rows below stay relative, which the caption states.
  const scopeSegments = scopePath ? scopePath.split("/") : [];
  const scopeLabel = [rootName, ...scopeSegments].join("/") + (directFilesOnly ? "/." : "");
  const truncated = files.length < total;
  return (
    <section
      className="panel ranking"
      aria-label="Heaviest files in scope"
      style={{ "--ranking-height": `${height}px` } as React.CSSProperties}
    >
      <div className="panel__head">
        {/* The scope qualifies the heading, so it reads after it, the way the
            folder panel puts its figures under the name they describe. */}
        <div>
          <h2>Heaviest files</h2>
          <p className="panel__scope">Within {scopeLabel}</p>
        </div>
        <div className="ranking__controls">
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
        sort={rank.metric}
        onSortChange={onSortChange}
        displayRoot={displayRoot}
        prefixRelativePaths
        onOpenSource={onOpenSource}
        emptyMessage={`No files match the current filters, scope, and minimum ${measureName(measure)} threshold.`}
      />
      {/* Directly after the table, because the boundary sizes the box before it.
          An empty list has no rows to curtail, so it has no boundary either. */}
      {files.length > 0 ? (
        <HeightSplitter
          height={height}
          onHeightChange={onHeightChange}
          label="Resize the file list"
          hint="Drag to resize the file list. Double-click to reset."
          minimum={MIN_RANKING_HEIGHT}
          maximum={MAX_RANKING_HEIGHT}
          defaultHeight={DEFAULT_RANKING_HEIGHT}
        />
      ) : null}
    </section>
  );
}
