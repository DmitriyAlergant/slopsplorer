import type { Measure, SummaryView } from "../../shared/api.ts";
import { compact, count, measureName, percent } from "../format.ts";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  summary: SummaryView | null;
  /** The measure the figures are in, taken from the response rather than the pending request. */
  measure: Measure;
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
 * same tree the panel below it is showing. Drilling therefore keeps one
 * project anchor on screen - the "of project" readout - rather than leaving
 * the strip describing a scope nothing else on the page is in.
 */
export function MassRibbon({ summary, measure, selectedPath, onSelect }: Props): React.JSX.Element {
  const segments = summary?.ribbon ?? [];
  const total = segments.reduce((sum, segment) => sum + segment.weight, 0);
  const commentShare = summary && summary.selectedLines > 0
    ? summary.selectedCommentLines / summary.selectedLines
    : 0;
  const unit = measureName(measure);
  // Taken from the response, not from the pending request, so the labels and
  // the numbers always describe the same scope.
  const drilled = summary !== null && summary.scopePath !== "";
  // Tokens are the cross-reference when they are not already the headline, so
  // the strip always carries one figure in a second unit.
  const secondary = measure === "tokens"
    ? { label: "lines of content", value: summary ? count(summary.selectedLines) : "-" }
    : { label: "tokens selected", value: summary ? count(summary.selectedTokens) : "-" };

  return (
    <section
      className="ribbon"
      aria-label={drilled ? `Drill scope ${unit} by folder` : `Project ${unit} by top-level folder`}
    >
      <div className="ribbon__readouts">
        <Readout
          label={drilled ? `scope ${unit}` : `project ${unit}`}
          value={summary ? count(summary.scopeWeight) : "-"}
        />
        <Readout label={`selected ${unit}`} value={summary ? count(summary.selectedWeight) : "-"} emphasis />
        <Readout
          label={drilled ? "of scope" : "of project"}
          value={summary && summary.scopeWeight > 0 ? percent(summary.selectedWeight / summary.scopeWeight) : "-"}
        />
        {drilled ? (
          <Readout
            label="of project"
            value={summary && summary.projectWeight > 0 ? percent(summary.selectedWeight / summary.projectWeight) : "-"}
          />
        ) : null}
        <Readout label="files selected" value={summary ? count(summary.selectedFiles) : "-"} />
        <Readout label={secondary.label} value={secondary.value} />
        <Readout label="comment share" value={summary ? percent(commentShare) : "-"} />
      </div>

      <div className="ribbon__track">
        {segments.map((segment, rank) => {
          const share = total > 0 ? segment.weight / total : 0;
          const selected =
            segment.path !== null &&
            selectedPath !== null &&
            (segment.path === selectedPath || selectedPath.startsWith(`${segment.path}/`));
          const label = `${segment.name} - ${count(segment.weight)} ${unit}, ${percent(share)} of scope`;
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
                <SegmentLabel share={share} name={segment.name} weight={segment.weight} />
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
              <SegmentLabel share={share} name={segment.name} weight={segment.weight} />
              <Tooltip compact>{label}</Tooltip>
            </button>
          );
        })}
        {segments.length === 0 ? <div className="ribbon__segment ribbon__segment--empty" /> : null}
      </div>
    </section>
  );
}

function SegmentLabel({ share, name, weight }: { share: number; name: string; weight: number }): React.JSX.Element | null {
  if (share < LABEL_THRESHOLD) return null;
  return (
    <span className="ribbon__label">
      <span className="ribbon__name">{name}</span>
      <span className="ribbon__weight">{compact(weight)}</span>
    </span>
  );
}

function Readout({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }): React.JSX.Element {
  return (
    <div className="readout" data-emphasis={emphasis === true}>
      <span className="readout__value">{value}</span>
      <span className="readout__label">{label}</span>
    </div>
  );
}
