import type { Measure, SummaryView } from "../../shared/api.ts";
import { compact, count, measureName, percent } from "../format.ts";

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
 * The whole project as one bar, split by top-level folder.
 *
 * Mass is the subject of this tool, so it is drawn as length before it is
 * written as digits. Segments are shaded darkest-first by rank, which makes the
 * ordering readable without a legend, and each one selects its folder.
 */
export function MassRibbon({ summary, measure, selectedPath, onSelect }: Props): React.JSX.Element {
  const segments = summary?.ribbon ?? [];
  const total = segments.reduce((sum, segment) => sum + segment.weight, 0);
  const commentShare = summary && summary.selectedLines > 0
    ? summary.selectedCommentLines / summary.selectedLines
    : 0;
  const unit = measureName(measure);
  // Tokens are the cross-reference when they are not already the headline, so
  // the strip always carries one figure in a second unit.
  const secondary = measure === "tokens"
    ? { label: "lines of content", value: summary ? count(summary.selectedLines) : "-" }
    : { label: "tokens selected", value: summary ? count(summary.selectedTokens) : "-" };

  return (
    <section className="ribbon" aria-label={`Project ${unit} by top-level folder`}>
      <div className="ribbon__readouts">
        <Readout label={`project ${unit}`} value={summary ? count(summary.projectWeight) : "-"} />
        <Readout label={`selected ${unit}`} value={summary ? count(summary.selectedWeight) : "-"} emphasis />
        <Readout
          label="of project"
          value={summary && summary.projectWeight > 0 ? percent(summary.selectedWeight / summary.projectWeight) : "-"}
        />
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
                title={label}
              >
                <SegmentLabel share={share} name={segment.name} weight={segment.weight} />
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
              title={label}
              aria-label={label}
              onClick={() => onSelect(segment.path!)}
            >
              <SegmentLabel share={share} name={segment.name} weight={segment.weight} />
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
