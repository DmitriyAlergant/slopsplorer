import { Fragment } from "react";
import type { Aspect, FileRow, Measure, MeasuredMetric, RankMetric } from "../../shared/api.ts";
import {
  FLAVOR_DETAILS, aspectHeading, measureAbbreviation, rankMetricsFor, weightField,
} from "../../shared/api.ts";
import { pathRelativeTo } from "../displayPath.ts";
import { changePercent, count, percent, signed, statusLetter, statusName } from "../format.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { SortCaret } from "./SortCaret.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  files: readonly FileRow[];
  /** Highlighted column: the measure every other figure on the page is drawn from. */
  measure: Measure;
  /** Highlighted column in a diff, where the columns are the sides of the change. */
  aspect: Aspect;
  isDiff: boolean;
  /** Sorted column, chosen by clicking a heading rather than by a control of its own. */
  sort: RankMetric;
  /** Sorting on a measured column also makes that measure the page's unit. */
  onSortChange: (metric: RankMetric) => void;
  /** Project-relative folder that displayed file names should be relative to. */
  displayRoot: string;
  onOpenSource: (path: string) => void;
  onOpenListed: () => void;
  emptyMessage: string;
}

/**
 * How each plain column is headed and where it reads its number.
 *
 * The aspect columns are not here: their unit is the active measure, so their
 * field is resolved per request rather than fixed in a table.
 */
const PLAIN_COLUMNS: Readonly<Record<
  "tokens" | "lines" | "codeLines" | "commentLines",
  { label: string; field: "tokens" | "lines" | "codeLines" | "commentLines" }
>> = {
  tokens: { label: "Tokens", field: "tokens" },
  lines: { label: "Lines", field: "lines" },
  codeLines: { label: "LOC", field: "codeLines" },
  commentLines: { label: "Comment", field: "commentLines" },
};

/** Heading and value resolver for one drawn column. */
interface Column {
  metric: MeasuredMetric;
  label: string;
  value: (file: FileRow) => number;
  /** Whether the figure carries a sign of its own. */
  isSigned: boolean;
}

function describeColumn(metric: MeasuredMetric, measure: Measure): Column {
  switch (metric) {
    case "churn": case "net": case "added": case "removed": case "after": {
      const field = weightField(measure, metric);
      // The unit is in the heading because these five columns are the only ones
      // whose unit moves, and a figure whose unit is stated elsewhere is a guess.
      return {
        metric,
        label: `${aspectHeading(metric)} ${measureAbbreviation(measure)}`,
        value: (file: FileRow) => file[field],
        isSigned: metric === "net",
      };
    }
    default: {
      const plain = PLAIN_COLUMNS[metric];
      return { metric, label: plain.label, value: (file: FileRow) => file[plain.field], isSigned: false };
    }
  }
}

/** Exact before-image field for the unit carried by the diff columns. */
const BEFORE_FIELDS: Readonly<Record<Measure, "beforeTokens" | "beforeLines" | "beforeCodeLines">> = {
  tokens: "beforeTokens",
  lines: "beforeLines",
  codeLines: "beforeCodeLines",
};

/** The metrics table of the folder panel: one row for each file of the selection. */
export function FileTable({
  files, measure, aspect, isDiff, sort, onSortChange, displayRoot, onOpenSource, onOpenListed, emptyMessage,
}: Props): React.JSX.Element {
  if (files.length === 0) return <p className="empty">{emptyMessage}</p>;
  const columns = rankMetricsFor(isDiff).map((metric) => describeColumn(metric, measure));
  const activeMetric: RankMetric = isDiff ? aspect : measure;
  return (
    <div className="table-scroll">
      <table className="metrics">
        <thead>
          <tr>
            <th scope="col">Flavor</th>
            {isDiff ? <th scope="col" className="metrics__change">Change</th> : null}
            {/* Left-aligned above the paths it heads, and sorted A to Z: a path
                is read from its start, and no order of it is a ranking. */}
            <th scope="col" className="metrics__path" aria-sort={sort === "name" ? "ascending" : "none"}>
              <span className="metrics__path-head">
                <button
                  type="button"
                  className="metrics__sort"
                  aria-label="Sort by file name, A to Z"
                  onClick={() => onSortChange("name")}
                >
                  File
                  <SortCaret ascending placeholder={sort !== "name"} />
                </button>
                <button type="button" className="button button--tiny metrics__read-all" onClick={onOpenListed} {...tooltipHandlers}>
                  Read all
                  <Tooltip compact>Open all matching files in one scrolling preview, in path order</Tooltip>
                </button>
              </span>
            </th>
            {columns.map(({ metric, label }) => (
              <th
                key={metric}
                scope="col"
                colSpan={metric === "churn" || metric === "net" ? 2 : 1}
                data-active={activeMetric === metric}
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
            const displayedPath = pathRelativeTo(file.path, displayRoot);
            return (
              <tr key={file.path}>
                <td>
                  <span className="tag" data-flavor={file.generated ? "generated" : file.kind}>
                    {file.generated ? "gen" : FLAVOR_DETAILS[file.kind].label}
                  </span>
                </td>
                {isDiff ? (
                  /* A Git letter rather than a second pill: the flavor beside it
                     is a tag, and two tags in two columns read as one system. */
                  <td className="metrics__change">
                    <span className="status" data-status={file.status} {...tooltipHandlers}>
                      <span aria-hidden="true">{statusLetter(file.status)}</span>
                      <span className="visually-hidden">{statusName(file.status)}</span>
                      <Tooltip compact>
                        {file.previousPath === null
                          ? `File ${statusName(file.status)}`
                          : `Renamed from ${file.previousPath}`}
                      </Tooltip>
                    </span>
                  </td>
                ) : null}
                <td className="metrics__path">
                  <span className="metrics__file">
                    <button type="button" className="link" onClick={() => onOpenSource(file.path)} {...tooltipHandlers}>
                      {displayedPath}
                      <Tooltip compact>{file.path}</Tooltip>
                    </button>
                    <CopyPathButton path={file.path} />
                  </span>
                </td>
                {columns.map(({ metric, value, isSigned }) => {
                  const raw = value(file);
                  const cell = isSigned ? signed(raw) : count(raw);
                  const marks = {
                    "data-active": activeMetric === metric,
                    "data-sorted": sort === metric,
                    ...(isSigned ? { "data-sign": raw < 0 ? "negative" : raw > 0 ? "positive" : "zero" } : {}),
                  };
                  const relativeAspect = metric === "churn" || metric === "net" ? metric : null;
                  return metric === "commentLines" ? (
                    <td key={metric} {...marks} {...tooltipHandlers}>
                      {cell}
                      <Tooltip compact>{`${percent(commentShare)} of lines are comment`}</Tooltip>
                      {commentShare >= 0.4 && file.lines >= 40 ? <i className="dot" aria-hidden="true" /> : null}
                    </td>
                  ) : relativeAspect === null ? (
                    <td key={metric} {...marks}>{cell}</td>
                  ) : (
                    <Fragment key={metric}>
                      <td {...marks}>{cell}</td>
                      <td className="metrics__change-percent">
                        ({changePercent(relativeAspect, raw, file[BEFORE_FIELDS[measure]])})
                      </td>
                    </Fragment>
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
