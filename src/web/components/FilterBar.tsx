import {
  ASPECTS, FILE_KINDS, FILE_KIND_DETAILS, MEASURES, aspectDescription, aspectHeading, measureHeading,
  type Aspect, type FileKind, type Measure, type ViewRequest,
} from "../../shared/api.ts";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  request: ViewRequest;
  /** Only a comparison has sides, so only a comparison offers the aspect switch. */
  isDiff: boolean;
  onToggleKind: (kind: FileKind) => void;
  onToggleGenerated: () => void;
  onQueryChange: (query: string) => void;
  onMeasureChange: (measure: Measure) => void;
  onAspectChange: (aspect: Aspect) => void;
}

const GENERATED_DESCRIPTION = "Generated output and lockfiles detected from path and filename conventions.";

const MEASURE_DESCRIPTIONS: Record<Measure, string> = {
  tokens: "Tokenizer count for the whole file, comments and whitespace included.",
  lines: "Every line with content, comment lines included. Blank lines are excluded.",
  codeLines: "Content lines that are not entirely comment. A line of code with a trailing comment still counts.",
};

/**
 * What is counted, and the quantity it is counted in.
 *
 * The two switches read as one phrase, side then unit: "net tokens". They sit
 * beside the visibility chips and not inside them, because both are orthogonal
 * to every chip: they change what a figure says, never which files are behind
 * it. One place owns each, so no two widgets can claim to decide what the page
 * counts.
 */
export function FilterBar({ request, isDiff, onToggleKind, onToggleGenerated, onQueryChange, onMeasureChange, onAspectChange }: Props): React.JSX.Element {
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

      <div className="filters__switches">
        {isDiff ? (
          <div className="switch" role="group" aria-label="Side of the change every figure describes">
            {ASPECTS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className="switch__option"
                aria-pressed={candidate === request.aspect}
                onClick={() => onAspectChange(candidate)}
                {...tooltipHandlers}
              >
                {aspectHeading(candidate)}
                <Tooltip>{aspectDescription(candidate)}</Tooltip>
              </button>
            ))}
          </div>
        ) : null}

        <div className="switch" role="group" aria-label="Unit every figure is expressed in">
          {MEASURES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="switch__option"
              aria-pressed={candidate === request.measure}
              onClick={() => onMeasureChange(candidate)}
              {...tooltipHandlers}
            >
              {measureHeading(candidate)}
              <Tooltip>{MEASURE_DESCRIPTIONS[candidate]}</Tooltip>
            </button>
          ))}
        </div>
      </div>

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
