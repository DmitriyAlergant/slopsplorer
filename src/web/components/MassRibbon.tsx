import type { Aspect, Measure, RowKind, SummaryView, ViewRequest } from "../../shared/api.ts";
import { ASPECTS, MEASURES, aspectTotals } from "../../shared/api.ts";
import {
  aspectFigure, compact, count, measureHeading, percent, weightCount, weightHeading, weightName,
} from "../format.ts";
import { Readout } from "./Readout.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  summary: SummaryView | null;
  /** The measure the figures are in, taken from the response rather than the pending request. */
  measure: Measure;
  /** The side of the change the figures describe. */
  aspect: Aspect;
  isDiff: boolean;
  /** What the tree has selected, so the segment that names it can say so. */
  selected: ViewRequest["selected"];
  onSelect: (rowKind: RowKind, path: string) => void;
}

/** Segments below this share cannot fit a readable label. */
const LABEL_THRESHOLD = 0.06;

/**
 * The current drill scope as one bar, split by the folders directly inside it.
 *
 * Mass is the subject of this tool, so it is drawn as length before it is
 * written as digits. Segments are shaded darkest-first by rank, which makes the
 * ordering readable without a legend, and each one selects its folder.
 *
 * The strip above the bar states the same columns as the folder head, in the
 * same order, so one figure is read the same way in both places and only the
 * subject changes: the folder head describes the selection, and this describes
 * the whole drill scope. What only this strip can say - how much of the project
 * the scope and the filters keep, and how much of that is comment - stands to
 * the right of the columns rather than among them.
 */
export function MassRibbon({ summary, measure, aspect, isDiff, selected, onSelect }: Props): React.JSX.Element {
  const segments = summary?.ribbon ?? [];
  // Magnitude, because in net a folder that removed 400 lines is 400 of the
  // scope's ink even though its weight is negative.
  const total = segments.reduce((sum, segment) => sum + Math.abs(segment.weight), 0);
  const unit = weightName(measure, aspect, isDiff);
  // Net is signed, so no whole divides it into an honest percentage and the
  // strip states none.
  const showsShare = aspect !== "net";
  // Taken from the response, not from the pending request, so the labels and
  // the numbers always describe the same scope.
  const drilled = summary !== null && summary.scopePath !== "";
  const scopeMeasures: Record<Measure, number> = {
    tokens: summary?.selectedTokens ?? 0,
    lines: summary?.selectedLines ?? 0,
    codeLines: summary?.selectedCodeLines ?? 0,
  };
  const totals = aspectTotals({
    added: summary?.selectedAdded ?? 0,
    removed: summary?.selectedRemoved ?? 0,
    ...scopeMeasures,
  }, measure);

  return (
    <section
      className="ribbon"
      aria-label={drilled ? `Drill scope ${unit} by folder` : `Whole ${unit} by top-level folder`}
    >
      <div className="ribbon__head">
        <div className="ribbon__identity">
          {/* The strip carries no "selected" label of its own, so this names its
              subject once: the drill scope, as the filters and the checkboxes
              leave it. */}
          <p className="eyebrow ribbon__eyebrow">{drilled ? "drilled scope" : "whole project"}</p>
          <div className="readouts ribbon__readouts">
            {isDiff
              ? ASPECTS.map((candidate) => {
                const figure = aspectFigure(candidate, totals[candidate]);
                return (
                  <Readout
                    key={candidate}
                    label={weightHeading(measure, candidate, true)}
                    value={summary ? figure.text : "-"}
                    sign={figure.sign}
                    emphasis={candidate === aspect}
                  />
                );
              })
              : MEASURES.map((candidate) => (
                <Readout
                  key={candidate}
                  label={measureHeading(candidate)}
                  value={summary ? count(scopeMeasures[candidate]) : "-"}
                  emphasis={candidate === measure}
                />
              ))}
            <Readout label="files" value={summary ? count(summary.selectedFiles) : "-"} />
          </div>
        </div>
        {/* The one fact no other panel can state: how much of the project this
            scope and these filters keep. It stands beside the columns rather
            than among them, and in net it is absent rather than empty, because
            a signed quantity has no honest whole to divide by. */}
        <div className="ribbon__actions">
          {showsShare ? (
            <Readout
              label="of project"
              value={summary && summary.projectWeight > 0
                ? percent(Math.abs(summary.selectedWeight) / summary.projectWeight)
                : "-"}
              emphasis
            />
          ) : null}
        </div>
      </div>

      <div className="ribbon__track">
        {segments.map((segment, rank) => {
          const share = total > 0 ? Math.abs(segment.weight) / total : 0;
          // A folder segment also marks a selection below it, because drilling
          // into a child is still reading that part of the scope. The `.`
          // segment holds files and nothing sits below it.
          const marked = segment.rowKind === "files"
            ? selected.rowKind === "files" && selected.path === segment.path
            : selected.rowKind === "folder"
              && (selected.path === segment.path || selected.path.startsWith(`${segment.path}/`));
          const label = `${segment.name} - ${weightCount(segment.weight, aspect)} ${unit}, ${percent(share)} of scope`;
          const shade = Math.min(rank, 7);
          return (
            <button
              // Every segment names a row of the tree. Only the folder panel
              // has a tile with no path, and that is its aggregate.
              key={`${segment.rowKind}:${segment.path}`}
              type="button"
              className="ribbon__segment"
              style={{ width: `${share * 100}%` }}
              data-shade={shade}
              data-selected={marked}
              aria-label={label}
              onClick={() => onSelect(segment.rowKind, segment.path!)}
              {...tooltipHandlers}
            >
              <SegmentLabel share={share} name={segment.name} weight={segment.weight} aspect={aspect} />
              <Tooltip compact>{label}</Tooltip>
            </button>
          );
        })}
        {segments.length === 0 ? <div className="ribbon__segment ribbon__segment--empty" /> : null}
      </div>
    </section>
  );
}

function SegmentLabel(
  { share, name, weight, aspect }: { share: number; name: string; weight: number; aspect: Aspect },
): React.JSX.Element | null {
  if (share < LABEL_THRESHOLD) return null;
  return (
    <span className="ribbon__label">
      <span className="ribbon__name">{name}</span>
      <span className="ribbon__weight">
        {aspect === "net" && weight !== 0 ? `${weight < 0 ? "-" : "+"}${compact(Math.abs(weight))}` : compact(weight)}
      </span>
    </span>
  );
}
