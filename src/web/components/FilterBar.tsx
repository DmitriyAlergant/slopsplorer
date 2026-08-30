import {
  ASPECTS, MEASURES, aspectDescription, aspectHeading, measureHeading,
  type Aspect, type Measure, type ViewRequest,
} from "../../shared/api.ts";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  request: ViewRequest;
  /** Only a comparison has sides, so only a comparison offers the aspect switch. */
  isDiff: boolean;
  onQueryChange: (query: string) => void;
  onMeasureChange: (measure: Measure) => void;
  onAspectChange: (aspect: Aspect) => void;
}

const MEASURE_DESCRIPTIONS: Record<Measure, string> = {
  tokens: "Tokenizer count for the whole file, comments and whitespace included.",
  lines: "Every line with content, comment lines included. Blank lines are excluded.",
  codeLines: "Content lines that are not entirely comment. A line of code with a trailing comment still counts.",
};

/**
 * The quantity every figure is counted in, and what is counted.
 *
 * The unit switch comes first because a scan has no side to pick: the aspect
 * switch appears only in a comparison, so putting it last keeps the units in
 * one place while the page moves between before, diff, and after. They sit
 * above the workspace because they change what every figure says.
 * Flavor controls sit above the file table with the scope totals they change.
 */
export function FilterBar({
  request, isDiff, onQueryChange, onMeasureChange, onAspectChange,
}: Props): React.JSX.Element {
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
      </div>
    </section>
  );
}
