import type { Aspect, FlavorSlice, Measure, StatusSlice } from "../../shared/api.ts";
import { count, weightName } from "../format.ts";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  slices: readonly FlavorSlice[];
  /** How the change divides. Drawn instead of the flavors when a diff is open. */
  statuses: readonly StatusSlice[];
  measure: Measure;
  aspect: Aspect;
  isDiff: boolean;
  /** 0-1 width of the filled portion, so the bar carries magnitude too. */
  scale?: number;
}

/**
 * A folder's mass, drawn as length and split by composition.
 *
 * The filled width is the folder's share of the active scope and the internal
 * divisions are what it is made of, so one bar answers "how big" and "made of
 * what" at once. A drill scope changes the common baseline without making
 * siblings or descendants use different scales.
 *
 * Inside a diff the better split is the change itself: which part of this
 * folder is new, edited, moved, or gone says more than which part is code.
 */
export function FlavorBar({ slices, statuses, measure, aspect, isDiff, scale = 1 }: Props): React.JSX.Element {
  const segments = isDiff
    ? statuses.map((slice) => ({ key: slice.status, mark: { "data-status": slice.status }, weight: slice.weight }))
    : slices.map((slice) => ({ key: slice.flavor, mark: { "data-flavor": slice.flavor }, weight: slice.weight }));
  const total = segments.reduce((sum, segment) => sum + segment.weight, 0);
  const filled = Math.min(1, Math.max(0, scale));
  const unit = weightName(measure, aspect, isDiff);
  return (
    <div className="flavor-bar" aria-hidden="true">
      <div className="flavor-bar__fill" style={{ width: `${filled * 100}%` }}>
        {segments.map((segment) => (
          <span
            key={segment.key}
            className="flavor-bar__slice"
            {...segment.mark}
            style={{ width: `${total > 0 ? (segment.weight / total) * 100 : 0}%` }}
            {...tooltipHandlers}
          >
            <Tooltip compact>{`${segment.key}: ${count(segment.weight)} ${unit}`}</Tooltip>
          </span>
        ))}
      </div>
    </div>
  );
}
