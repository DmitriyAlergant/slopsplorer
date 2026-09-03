import type { Aspect, FlavorSlice, Measure } from "../../shared/api.ts";
import { FLAVOR_DETAILS, weightName } from "../../shared/api.ts";
import { count } from "../format.ts";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  slices: readonly FlavorSlice[];
  measure: Measure;
  aspect: Aspect;
  isDiff: boolean;
  /** The whole every bar in the panel divides. See `DetailView.flavorBaseline`. */
  baseline: number;
}

/**
 * A folder's mass, drawn as length and split by flavor.
 *
 * Every slice is its own flavor's weight against one whole, so the filled
 * width is what the folder holds of the scope and the divisions are what it is
 * made of. The whole ignores the flavor chips, which is what makes turning a
 * flavor off take a slice out of every bar rather than stretch the rest.
 */
export function FlavorBar({ slices, measure, aspect, isDiff, baseline }: Props): React.JSX.Element {
  const total = slices.reduce((sum, slice) => sum + slice.weight, 0);
  const filled = baseline > 0 ? Math.min(1, total / baseline) : 0;
  const unit = weightName(measure, aspect, isDiff);
  return (
    <div className="flavor-bar" aria-hidden="true">
      <div className="flavor-bar__fill" style={{ width: `${filled * 100}%` }}>
        {slices.map((slice) => (
          <span
            key={slice.flavor}
            className="flavor-bar__slice"
            data-flavor={slice.flavor}
            style={{ width: `${total > 0 ? (slice.weight / total) * 100 : 0}%` }}
            {...tooltipHandlers}
          >
            <Tooltip compact>
              {`${FLAVOR_DETAILS[slice.flavor].label}: ${count(slice.weight)} ${unit}`
                // A slice is drawn from magnitude, so in net it is not the
                // signed figure the flavor switch below the tiles states.
                + (aspect === "net" ? ", ignoring sign" : "")}
            </Tooltip>
          </span>
        ))}
      </div>
    </div>
  );
}
