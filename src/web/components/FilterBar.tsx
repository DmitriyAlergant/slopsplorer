import type { FileKind, ViewRequest } from "../../shared/api.ts";

interface Props {
  request: ViewRequest;
  onToggleKind: (kind: FileKind) => void;
  onToggleGenerated: () => void;
  onQueryChange: (query: string) => void;
}

const KIND_LABELS: ReadonlyArray<{ kind: FileKind; label: string; description: string }> = [
  { kind: "code", label: "Code", description: "Source and application code." },
  { kind: "test", label: "Tests", description: "Files in test folders or with common test naming patterns." },
  { kind: "text", label: "Docs", description: "Markdown and other prose documentation." },
  { kind: "i18n", label: "i18n", description: "Translation catalogues and locale files." },
  { kind: "data", label: "Data", description: "Structured data and configuration formats such as JSON, YAML, TOML, XML, and CSV." },
  { kind: "other", label: "Other", description: "Scannable text files that do not fit another flavor, such as HTML." },
];

const GENERATED_DESCRIPTION = "Generated output and lockfiles detected from path and filename conventions.";

/** Keep a tooltip inside the viewport when its chip sits near either edge. */
function positionTooltip(event: React.SyntheticEvent<HTMLLabelElement>): void {
  const tooltip = event.currentTarget.querySelector<HTMLElement>(".chip__tooltip");
  if (tooltip === null) return;

  tooltip.style.setProperty("--tooltip-shift", "0px");
  const bounds = tooltip.getBoundingClientRect();
  const gutter = 12;
  const shift = bounds.left < gutter
    ? gutter - bounds.left
    : Math.min(0, window.innerWidth - gutter - bounds.right);
  tooltip.style.setProperty("--tooltip-shift", `${shift}px`);
}

/** Search plus the visibility switches that decide what counts toward the totals. */
export function FilterBar({ request, onToggleKind, onToggleGenerated, onQueryChange }: Props): React.JSX.Element {
  return (
    <section className="filters" aria-label="Scope filters">
      <label className="search">
        <span className="visually-hidden">Search folders and files</span>
        <input
          type="search"
          value={request.query}
          placeholder="Filter by path"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <div className="chips" role="group" aria-label="File kinds counted">
        {KIND_LABELS.map(({ kind, label, description }) => (
          <label
            key={kind}
            className="chip"
            data-flavor={kind}
            data-on={request.kinds.includes(kind)}
            onMouseEnter={positionTooltip}
            onFocus={positionTooltip}
          >
            <input
              type="checkbox"
              checked={request.kinds.includes(kind)}
              aria-describedby={`flavor-tooltip-${kind}`}
              onChange={() => onToggleKind(kind)}
            />
            {label}
            <span className="chip__tooltip" id={`flavor-tooltip-${kind}`} role="tooltip">{description}</span>
          </label>
        ))}
        <label
          className="chip"
          data-flavor="generated"
          data-on={request.showGenerated}
          onMouseEnter={positionTooltip}
          onFocus={positionTooltip}
        >
          <input
            type="checkbox"
            checked={request.showGenerated}
            aria-describedby="flavor-tooltip-generated"
            onChange={onToggleGenerated}
          />
          Generated
          <span className="chip__tooltip" id="flavor-tooltip-generated" role="tooltip">{GENERATED_DESCRIPTION}</span>
        </label>
      </div>
    </section>
  );
}
