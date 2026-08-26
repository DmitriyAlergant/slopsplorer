import { FILE_KINDS, type FileKind, type ViewRequest } from "../../shared/api.ts";
import { FILE_KIND_DETAILS } from "../fileKinds.ts";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  request: ViewRequest;
  onToggleKind: (kind: FileKind) => void;
  onToggleGenerated: () => void;
  onQueryChange: (query: string) => void;
}

const GENERATED_DESCRIPTION = "Generated output and lockfiles detected from path and filename conventions.";

/**
 * Search and the visibility switches: what is counted at all.
 *
 * The unit those counts are expressed in is not here. It belongs to the columns
 * that show it, so it is chosen from the source tree's numbers heading or by
 * sorting a file table on a measured column.
 */
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
        {FILE_KINDS.map((kind) => {
          const { label, description } = FILE_KIND_DETAILS[kind];
          return (
            <label
              key={kind}
              className="chip"
              data-flavor={kind}
              data-on={request.kinds.includes(kind)}
              {...tooltipHandlers}
            >
              <input
                type="checkbox"
                checked={request.kinds.includes(kind)}
                aria-describedby={`flavor-tooltip-${kind}`}
                onChange={() => onToggleKind(kind)}
              />
              {label}
              <Tooltip id={`flavor-tooltip-${kind}`}>{description}</Tooltip>
            </label>
          );
        })}
        <label
          className="chip"
          data-flavor="generated"
          data-on={request.showGenerated}
          {...tooltipHandlers}
        >
          <input
            type="checkbox"
            checked={request.showGenerated}
            aria-describedby="flavor-tooltip-generated"
            onChange={onToggleGenerated}
          />
          Generated
          <Tooltip id="flavor-tooltip-generated">{GENERATED_DESCRIPTION}</Tooltip>
        </label>
      </div>
    </section>
  );
}
