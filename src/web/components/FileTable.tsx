import type { FileRow, Measure, RankMetric } from "../../shared/api.ts";
import { displayFilePath } from "../displayPath.ts";
import { FILE_KIND_DETAILS } from "../fileKinds.ts";
import { count, percent } from "../format.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { SortCaret } from "./SortCaret.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  files: readonly FileRow[];
  /** Highlighted column: the measure every other figure on the page is drawn from. */
  measure: Measure;
  /** Sorted column. Shared by both tables, so they never disagree on an order. */
  sort: RankMetric;
  /** Sorting on a measured column also makes that measure the page's unit. */
  onSortChange: (metric: RankMetric) => void;
  /** Project-relative folder that displayed file names should be relative to. */
  displayRoot: string;
  /** Mark displayed paths as relative while preserving project-relative copy values. */
  prefixRelativePaths: boolean;
  onOpenSource: (path: string) => void;
  emptyMessage: string;
}

/**
 * The measured columns, in the order they are drawn.
 *
 * One entry per `RankMetric`, because sorting a column is the only way to
 * choose the metric: a metric without a heading here could never be picked.
 */
const COLUMNS: ReadonlyArray<{ metric: RankMetric; label: string; value: (file: FileRow) => number }> = [
  { metric: "tokens", label: "Tokens", value: (file) => file.tokens },
  { metric: "lines", label: "Lines", value: (file) => file.lines },
  { metric: "codeLines", label: "LOC", value: (file) => file.codeLines },
  { metric: "commentLines", label: "Comment", value: (file) => file.commentLines },
  { metric: "functions", label: "Fn", value: (file) => file.functions },
  { metric: "branches", label: "Branch", value: (file) => file.branches },
];

/** Structure counts are absent rather than zero for a file no grammar parsed. */
const STRUCTURE_METRICS: ReadonlySet<RankMetric> = new Set<RankMetric>(["functions", "branches"]);

/** The shared metrics table, used for a folder's own files and for the ranking. */
export function FileTable({ files, measure, sort, onSortChange, displayRoot, prefixRelativePaths, onOpenSource, emptyMessage }: Props): React.JSX.Element {
  if (files.length === 0) return <p className="empty">{emptyMessage}</p>;
  return (
    <div className="table-scroll">
      <table className="metrics">
        <thead>
          <tr>
            <th scope="col">Flavor</th>
            <th scope="col">File</th>
            {COLUMNS.map(({ metric, label }) => (
              <th
                key={metric}
                scope="col"
                data-active={measure === metric}
                aria-sort={sort === metric ? "descending" : "none"}
              >
                {/* Heaviest first on every column, so the heading selects an order
                    rather than toggling one. The caret states which is running. */}
                <button
                  type="button"
                  className="metrics__sort"
                  aria-label={`Sort by ${label.toLowerCase()}, highest first`}
                  onClick={() => onSortChange(metric)}
                >
                  {/* Always drawn: a caret that appears on click would resize the
                      column it lands in and shift every heading beside it. */}
                  <SortCaret placeholder={sort !== metric} />
                  {label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const commentShare = file.lines > 0 ? file.commentLines / file.lines : 0;
            const displayedPath = displayFilePath(file.path, displayRoot, prefixRelativePaths);
            return (
              <tr key={file.path}>
                <td>
                  <span className="tag" data-flavor={file.generated ? "generated" : file.kind}>
                    {file.generated ? "gen" : FILE_KIND_DETAILS[file.kind].label}
                  </span>
                </td>
                <td className="metrics__path">
                  <span className="metrics__file">
                    <button type="button" className="link" onClick={() => onOpenSource(file.path)} {...tooltipHandlers}>
                      {displayedPath}
                      <Tooltip compact>{file.path}</Tooltip>
                    </button>
                    <CopyPathButton path={file.path} />
                  </span>
                </td>
                {COLUMNS.map(({ metric, value }) => {
                  const cell = STRUCTURE_METRICS.has(metric) && file.language === null ? "-" : count(value(file));
                  const marks = { "data-active": measure === metric, "data-sorted": sort === metric };
                  return metric === "commentLines" ? (
                    <td key={metric} {...marks} {...tooltipHandlers}>
                      {cell}
                      <Tooltip compact>{`${percent(commentShare)} of lines are comment`}</Tooltip>
                      {commentShare >= 0.4 && file.lines >= 40 ? <i className="dot" aria-hidden="true" /> : null}
                    </td>
                  ) : (
                    <td key={metric} {...marks}>{cell}</td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
