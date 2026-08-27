import { useCallback, useEffect, useState } from "react";
import type { CommitSpine, ComparisonRequest, Measure, Span, SpineEntry } from "../../shared/api.ts";
import { requestForSpan, sameComparisonRequest, slideSpan, spanBetween, spanOf } from "../../shared/api.ts";
import { count, sideCount, signed } from "../format.ts";
import { DEFAULT_SPINE_HEIGHT, MAX_SPINE_HEIGHT, MIN_SPINE_HEIGHT } from "../preferences.ts";
import { heaviestChurn, sidesOf } from "../spine.ts";
import { HeightSplitter } from "./Splitter.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  spine: CommitSpine;
  /** Unit the figures are stated in. A unit is not a filter, so the band follows it. */
  measure: Measure;
  /** The open comparison, which is what the selection is read from. */
  request: ComparisonRequest;
  /** A measurement is running, so a new one cannot start. */
  disabled: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (comparison: ComparisonRequest) => void;
  height: number;
  onHeightChange: (height: number) => void;
}

/** Where a span sits, in the fewest words that still say it. */
function whereText(spine: CommitSpine, span: Span | null): string {
  const total = spine.commits.length;
  if (span === null) return `all ${count(total)} commits`;
  if (span.start === span.end) return `commit ${span.start + 1} of ${count(total)}`;
  return `commits ${span.start + 1} to ${span.end + 1} of ${count(total)}`;
}

function shareStyle(entry: SpineEntry, measure: Measure, heaviest: number): React.CSSProperties {
  const { added, removed } = sidesOf(entry, measure);
  const scale = heaviest === 0 ? 0 : 1 / heaviest;
  return {
    "--share-removed": removed * scale,
    "--share-added": added * scale,
  } as React.CSSProperties;
}

/**
 * The commits a comparison spans, and the control that walks them.
 *
 * The band sits above the filter bar because its figures answer to no filter:
 * they are the frame a review happens inside, so "which commit is the heavy
 * one" has to stay the same answer while the page below it is narrowed.
 *
 * Collapsed it is one row, and it still states the span and still steps,
 * because a page drawing one commit of fifty must never look like it is
 * drawing the change.
 */
export function SpineBand({
  spine, measure, request, disabled, expanded, onExpandedChange, onSelect, height, onHeightChange,
}: Props): React.JSX.Element {
  const span = spanOf(spine, request);
  const whole = sameComparisonRequest(request, spine.range);
  const heaviest = heaviestChurn(spine, measure);
  const [anchor, setAnchor] = useState(0);

  const choose = useCallback((next: Span) => {
    onSelect(requestForSpan(spine, next));
  }, [onSelect, spine]);

  /**
   * A step keeps the width of the span it moves, so one control walks single
   * commits and slides a window. From the whole range it enters at the end it
   * came from.
   */
  const step = useCallback((delta: number) => {
    if (span === null) {
      const index = delta > 0 ? 0 : spine.commits.length - 1;
      setAnchor(index);
      choose({ start: index, end: index });
      return;
    }
    const next = slideSpan(spine, span, delta);
    if (next === null) return;
    setAnchor(next.start);
    choose(next);
  }, [choose, span, spine]);

  const canStep = (delta: number): boolean =>
    !disabled && spine.commits.length > 0 && (span === null || slideSpan(spine, span, delta) !== null);

  // A reviewer walks commits far more often than anything else on the page, so
  // the step has keys. A field that takes text keeps them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "[" && event.key !== "]") return;
      const target = event.target;
      if (target instanceof HTMLElement
        && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const delta = event.key === "]" ? 1 : -1;
      if (!canStep(delta)) return;
      event.preventDefault();
      step(delta);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const rowFor = (entry: SpineEntry, index: number): React.JSX.Element => {
    const { added, removed } = sidesOf(entry, measure);
    const inSpan = span !== null && index >= span.start && index <= span.end;
    return (
      <div key={entry.sha} className="spine-row" data-in-span={inSpan}>
        {/* The whole row selects, and it is a layer under the cells rather than
            their parent, because an object name that opens the forge has to be
            a link and a link cannot sit inside a button. */}
        <button
          type="button"
          className="spine-row__pick"
          aria-pressed={inSpan}
          aria-label={entry.subject}
          disabled={disabled}
          onClick={(event) => {
            if (event.shiftKey) {
              choose(spanBetween(anchor, index));
              return;
            }
            setAnchor(index);
            choose({ start: index, end: index });
          }}
          {...tooltipHandlers}
        >
          <Tooltip>
            <span className="spine-row__message">
              <b>{entry.subject}</b>
              {entry.body === "" ? null : <span className="spine-row__body">{entry.body}</span>}
            </span>
          </Tooltip>
        </button>

        {entry.url === null ? (
          <span className="spine-row__sha">{entry.shortSha}</span>
        ) : (
          <a
            className="spine-row__sha spine-row__sha--link"
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            {...tooltipHandlers}
          >
            {entry.shortSha}
            <Tooltip compact>Open this commit on the forge</Tooltip>
          </a>
        )}
        <span className="spine-row__subject">{entry.subject}</span>
        <span className="spine-row__author">{entry.author}</span>
        {/* Removed left of the axis and added right, as a number line reads and
            as the source tree already draws a net row. */}
        <span className="spine-row__axis" style={shareStyle(entry, measure, heaviest)} aria-hidden="true">
          <span className="spine-row__half spine-row__half--removed" data-empty={removed === 0} />
          <span className="spine-row__half spine-row__half--added" data-empty={added === 0} />
        </span>
        <span className="spine-row__figure" data-sign="positive">{sideCount(added, "+")}</span>
        <span className="spine-row__figure" data-sign="negative">{sideCount(removed, "-")}</span>
        <span className="spine-row__figure spine-row__net">{signed(added - removed)}</span>
      </div>
    );
  };

  return (
    <section className="spine" aria-label="Commits this comparison spans">
      <div className="spine__head">
        <button
          type="button"
          className="spine__disclose"
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          <span className="spine__caret" data-open={expanded} aria-hidden="true" />
          Commits
        </button>

        {expanded ? null : (
          <span className="spine__mini" aria-hidden="true">
            {spine.commits.map((entry, index) => {
              const { added, removed } = sidesOf(entry, measure);
              const share = heaviest === 0 ? 0 : (added + removed) / heaviest;
              return (
                <i
                  key={entry.sha}
                  className="spine__tick"
                  data-in-span={span !== null && index >= span.start && index <= span.end}
                  style={{ "--mass": Math.max(0.08, share) } as React.CSSProperties}
                />
              );
            })}
          </span>
        )}

        <span className="spine__where">{whereText(spine, span)}</span>

        <span className="spine__step">
          <button
            type="button"
            aria-label="Previous commit"
            disabled={!canStep(-1)}
            onClick={() => step(-1)}
            {...tooltipHandlers}
          >
            &lsaquo;
            <Tooltip compact>Previous commit, or [</Tooltip>
          </button>
          <button
            type="button"
            aria-label="Next commit"
            disabled={!canStep(1)}
            onClick={() => step(1)}
            {...tooltipHandlers}
          >
            &rsaquo;
            <Tooltip compact>Next commit, or ]</Tooltip>
          </button>
        </span>

        <button
          type="button"
          className="spine__all"
          aria-pressed={whole}
          disabled={disabled || whole}
          onClick={() => onSelect(spine.range)}
        >
          Whole change
        </button>
      </div>

      {expanded ? (
        <div className="spine__list" style={{ "--spine-height": `${height}px` } as React.CSSProperties}>
          <div className="spine__columns" aria-hidden="true">
            <span />
            <span>Subject</span>
            <span />
            <span />
            <span>Added</span>
            <span>Removed</span>
            <span>Net</span>
          </div>
          {spine.commits.map(rowFor)}
          {spine.omitted > 0 ? (
            <p className="spine__omitted">
              {`${count(spine.omitted)} older ${spine.omitted === 1 ? "commit is" : "commits are"} not listed`}
            </p>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <HeightSplitter
          height={height}
          onHeightChange={onHeightChange}
          label="Resize the commit band"
          hint="Drag to resize the commit band. Double-click to reset."
          minimum={MIN_SPINE_HEIGHT}
          maximum={MAX_SPINE_HEIGHT}
          defaultHeight={DEFAULT_SPINE_HEIGHT}
        />
      ) : null}
    </section>
  );
}

/**
 * The band before its commits arrive.
 *
 * Measuring a range costs one diff for each commit in it, so a wide one takes a
 * moment. The band says so from the start rather than appearing once it is
 * finished: a control that arrives late reads as one that was broken.
 */
export function PendingSpineBand(): React.JSX.Element {
  return (
    <section className="spine spine--pending" aria-label="Commits this comparison spans" aria-busy="true">
      <div className="spine__head">
        <span className="spine__disclose" aria-hidden="true">
          <span className="spine__caret" />
          Commits
        </span>
        <span className="spine__where">measuring each commit...</span>
      </div>
    </section>
  );
}
