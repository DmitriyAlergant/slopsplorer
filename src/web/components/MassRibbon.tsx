import type { Aspect, Measure, SummaryView } from "../../shared/api.ts";
import { aspectFigure, compact, count, percent, weightCount, weightName } from "../format.ts";
import { Readout } from "./Readout.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  summary: SummaryView | null;
  /** The measure the figures are in, taken from the response rather than the pending request. */
  measure: Measure;
  /** The side of the change the figures describe. */
  aspect: Aspect;
  isDiff: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
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
 * Every figure here describes the drill scope, so the bar always splits the
 * same tree the workspace above it is showing. Drilling therefore keeps one
 * project anchor on screen - the "of project" readout - rather than leaving
 * the strip describing a scope nothing else on the page is in.
 */
export function MassRibbon({ summary, measure, aspect, isDiff, selectedPath, onSelect }: Props): React.JSX.Element {
  const segments = summary?.ribbon ?? [];
  // Magnitude, because in net a folder that removed 400 lines is 400 of the
  // scope's ink even though its weight is negative.
  const total = segments.reduce((sum, segment) => sum + Math.abs(segment.weight), 0);
  const commentBase = isDiff ? summary?.selectedChurnLines ?? 0 : summary?.selectedLines ?? 0;
  const commentPart = isDiff ? summary?.selectedChurnCommentLines ?? 0 : summary?.selectedCommentLines ?? 0;
  const commentShare = commentBase > 0 ? commentPart / commentBase : 0;
  const unit = weightName(measure, aspect, isDiff);
  // Net is signed, so every share is drawn against churn instead. These two
  // readouts state that denominator, and naming them "net" would put a churn
  // figure under a net label.
  const baselineUnit = weightName(measure, aspect === "net" ? "churn" : aspect, isDiff);
  const baselineSuffix = aspect === "net" ? " churn" : "";
  // Taken from the response, not from the pending request, so the labels and
  // the numbers always describe the same scope.
  const drilled = summary !== null && summary.scopePath !== "";
  // The denominator is stated in the shape of the thing it divides, so a
  // baseline and the figure drawn against it are never formatted differently.
  const baselineFigure = aspectFigure(aspect === "net" ? "churn" : aspect, summary?.scopeWeight ?? 0);
  const selectedFigure = aspectFigure(aspect, summary?.selectedWeight ?? 0);
  const addedFigure = aspectFigure("added", summary?.selectedAdded ?? 0);
  const removedFigure = aspectFigure("removed", summary?.selectedRemoved ?? 0);
  // Tokens are the cross-reference when they are not already the headline, so
  // the strip always carries one figure in a second unit.
  const secondary = isDiff
    ? measure === "tokens"
      ? { label: "lines churned", value: summary ? count(summary.selectedChurnLines) : "-" }
      : { label: "tokens churned", value: summary ? count(summary.selectedChurnTokens) : "-" }
    : measure === "tokens"
      ? { label: "lines of content", value: summary ? count(summary.selectedLines) : "-" }
      : { label: "tokens selected", value: summary ? count(summary.selectedTokens) : "-" };

  return (
    <section
      className="ribbon"
      aria-label={drilled ? `Drill scope ${unit} by folder` : `Whole ${unit} by top-level folder`}
    >
      <div className="readouts ribbon__readouts">
        <Readout
          label={drilled ? `scope ${baselineUnit}` : `project ${baselineUnit}`}
          value={summary ? baselineFigure.text : "-"}
        />
        <Readout
          label={`selected ${unit}`}
          value={summary ? selectedFigure.text : "-"}
          sign={selectedFigure.sign}
          emphasis
        />
        {/* The two sides, each in the shape the folder panel gives it, so one
            figure means the same wherever the page states it. */}
        {isDiff ? (
          <>
            <Readout label={weightName(measure, "added", isDiff)} value={summary ? addedFigure.text : "-"} sign={addedFigure.sign} />
            <Readout label={weightName(measure, "removed", isDiff)} value={summary ? removedFigure.text : "-"} sign={removedFigure.sign} />
          </>
        ) : null}
        <Readout
          label={drilled ? `of scope${baselineSuffix}` : `of project${baselineSuffix}`}
          value={summary && summary.scopeWeight > 0 ? percent(Math.abs(summary.selectedWeight) / summary.scopeWeight) : "-"}
        />
        {drilled ? (
          <Readout
            label={`of project${baselineSuffix}`}
            value={summary && summary.projectWeight > 0 ? percent(Math.abs(summary.selectedWeight) / summary.projectWeight) : "-"}
          />
        ) : null}
        <Readout label="files selected" value={summary ? count(summary.selectedFiles) : "-"} />
        <Readout label={secondary.label} value={secondary.value} />
        <Readout label={isDiff ? "comment of churn" : "comment share"} value={summary ? percent(commentShare) : "-"} />
      </div>

      <div className="ribbon__track">
        {segments.map((segment, rank) => {
          const share = total > 0 ? Math.abs(segment.weight) / total : 0;
          const selected =
            segment.path !== null &&
            selectedPath !== null &&
            (segment.path === selectedPath || selectedPath.startsWith(`${segment.path}/`));
          const label = `${segment.name} - ${weightCount(segment.weight, aspect)} ${unit}, ${percent(share)} of scope`;
          const shade = Math.min(rank, 7);
          if (segment.path === null) {
            return (
              <div
                key={`root-files-${rank}`}
                className="ribbon__segment ribbon__segment--static"
                style={{ width: `${share * 100}%` }}
                data-shade={shade}
                {...tooltipHandlers}
              >
                <SegmentLabel share={share} name={segment.name} weight={segment.weight} aspect={aspect} />
                <Tooltip compact>{label}</Tooltip>
              </div>
            );
          }
          return (
            <button
              key={segment.path}
              type="button"
              className="ribbon__segment"
              style={{ width: `${share * 100}%` }}
              data-shade={shade}
              data-selected={selected}
              aria-label={label}
              onClick={() => onSelect(segment.path!)}
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
