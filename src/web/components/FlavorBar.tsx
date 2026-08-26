import type { FlavorSlice, Measure } from "../../shared/api.ts";
import { count, measureName } from "../format.ts";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  slices: readonly FlavorSlice[];
  measure: Measure;
  /** 0-1 width of the filled portion, so the bar carries magnitude too. */
  scale?: number;
}

/**
 * A folder's mass, drawn as length and split by flavor.
 *
 * The filled width is the folder's share of the active scope and the internal
 * divisions are its composition, so one bar answers "how big" and "made of
 * what" at once. A drill scope changes the common baseline without making
 * siblings or descendants use different scales.
 */
export function FlavorBar({ slices, measure, scale = 1 }: Props): React.JSX.Element {
  const total = slices.reduce((sum, slice) => sum + slice.weight, 0);
  const filled = Math.min(1, Math.max(0, scale));
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
            <Tooltip compact>{`${slice.flavor}: ${count(slice.weight)} ${measureName(measure)}`}</Tooltip>
          </span>
        ))}
      </div>
    </div>
  );
}
