import type { SummaryView } from "../../shared/api.ts";
import { compact, count, percent } from "../format.ts";

interface Props {
  summary: SummaryView | null;
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
export function MassRibbon({ summary, selectedPath, onSelect }: Props): React.JSX.Element {
  const segments = summary?.ribbon ?? [];
  const total = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  const commentShare = summary && summary.selectedLines > 0
    ? summary.selectedCommentLines / summary.selectedLines
    : 0;

  return (
    <section className="ribbon" aria-label="Project token mass by top-level folder">
      <div className="ribbon__readouts">
        <Readout label="project tokens" value={summary ? count(summary.projectTokens) : "-"} />
        <Readout label="selected tokens" value={summary ? count(summary.selectedTokens) : "-"} emphasis />
        <Readout
          label="of project"
          value={summary && summary.projectTokens > 0 ? percent(summary.selectedTokens / summary.projectTokens) : "-"}
        />
        <Readout label="files selected" value={summary ? count(summary.selectedFiles) : "-"} />
        <Readout label="lines of content" value={summary ? count(summary.selectedLines) : "-"} />
        <Readout label="comment share" value={summary ? percent(commentShare) : "-"} />
      </div>

      <div className="ribbon__track">
        {segments.map((segment, rank) => {
          const share = total > 0 ? segment.tokens / total : 0;
          const selected =
            segment.path !== null &&
            selectedPath !== null &&
            (segment.path === selectedPath || selectedPath.startsWith(`${segment.path}/`));
          const label = `${segment.name} - ${count(segment.tokens)} tokens, ${percent(share)} of scope`;
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
                <SegmentLabel share={share} name={segment.name} tokens={segment.tokens} />
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
              <SegmentLabel share={share} name={segment.name} tokens={segment.tokens} />
            </button>
          );
        })}
        {segments.length === 0 ? <div className="ribbon__segment ribbon__segment--empty" /> : null}
      </div>
    </section>
  );
}

function SegmentLabel({ share, name, tokens }: { share: number; name: string; tokens: number }): React.JSX.Element | null {
  if (share < LABEL_THRESHOLD) return null;
  return (
    <span className="ribbon__label">
      <span className="ribbon__name">{name}</span>
      <span className="ribbon__tokens">{compact(tokens)}</span>
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
