import { FILE_KINDS, type FileKind, type Measure, type ViewRequest } from "../../shared/api.ts";
import { FILE_KIND_DETAILS } from "../fileKinds.ts";
import { positionTooltip } from "../tooltip.ts";
import { MeasureSwitch } from "./MeasureSwitch.tsx";

interface Props {
  request: ViewRequest;
  onToggleKind: (kind: FileKind) => void;
  onToggleGenerated: () => void;
  onQueryChange: (query: string) => void;
  onMeasureChange: (measure: Measure) => void;
}

const GENERATED_DESCRIPTION = "Generated output and lockfiles detected from path and filename conventions.";

/** Search, the visibility switches, and the unit the totals are counted in. */
export function FilterBar({ request, onToggleKind, onToggleGenerated, onQueryChange, onMeasureChange }: Props): React.JSX.Element {
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
        {FILE_KINDS.map((kind) => {
          const { label, description } = FILE_KIND_DETAILS[kind];
          return (
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
              <span className="tooltip" id={`flavor-tooltip-${kind}`} role="tooltip">{description}</span>
            </label>
          );
        })}
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
          <span className="tooltip" id="flavor-tooltip-generated" role="tooltip">{GENERATED_DESCRIPTION}</span>
        </label>
      </div>

      <MeasureSwitch measure={request.measure} onChange={onMeasureChange} />
    </section>
  );
}
