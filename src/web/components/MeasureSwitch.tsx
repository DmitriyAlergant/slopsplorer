import type { Measure } from "../../shared/api.ts";
import { MEASURES } from "../../shared/api.ts";
import { measureHeading } from "../format.ts";
import { positionTooltip } from "../tooltip.ts";

interface Props {
  measure: Measure;
  onChange: (measure: Measure) => void;
}

const MEASURE_DESCRIPTIONS: Record<Measure, string> = {
  tokens: "Tokenizer count for the whole file, comments and whitespace included.",
  lines: "Every line with content, comment lines included. Blank lines are excluded.",
  codeLines: "Lines of code: content lines that are not entirely comment. Blank and comment-only lines are excluded, and a line of code with a trailing comment still counts.",
};

/**
 * The unit every total is expressed in.
 *
 * It sits with the filters because it is read alongside them, but it is a
 * different kind of control: the filters decide which files count, and this
 * decides what counting means. Nothing is hidden or revealed by changing it.
 */
export function MeasureSwitch({ measure, onChange }: Props): React.JSX.Element {
  return (
    <div className="measure" role="group" aria-label="Primary measure">
      <span className="measure__label">Measure</span>
      <div className="measure__options">
        {MEASURES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className="measure__option"
            aria-pressed={candidate === measure}
            aria-describedby={`measure-tooltip-${candidate}`}
            onMouseEnter={positionTooltip}
            onFocus={positionTooltip}
            onClick={() => onChange(candidate)}
          >
            {measureHeading(candidate)}
            <span className="tooltip" id={`measure-tooltip-${candidate}`} role="tooltip">
              {MEASURE_DESCRIPTIONS[candidate]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
