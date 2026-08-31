import type { Aspect, Flavor, FlavorSlice, Measure, RowKind, SummaryView, ViewRequest } from "../../shared/api.ts";
import {
  ASPECTS, FLAVORS, FLAVOR_DETAILS, MEASURES, aspectTotals, measureHeading, weightHeading, weightName,
} from "../../shared/api.ts";
import { aspectFigure, changePercent, compact, count, percent, weightCount } from "../format.ts";
import { Readout } from "./Readout.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  summary: SummaryView | null;
  /** The measure the figures are in, taken from the response rather than the pending request. */
  measure: Measure;
  /** The side of the change the figures describe. */
  aspect: Aspect;
  isDiff: boolean;
  /**
   * The flavors the answered request counted.
   *
   * Taken from the response like the measure and the aspect, so a legend never
   * marks a flavor dropped while the figures beside it still hold that flavor.
   */
  countedFlavors: readonly Flavor[];
  /** What the tree has selected, so the segment that names it can say so. */
  selected: ViewRequest["selected"];
  onSelect: (rowKind: RowKind, path: string) => void;
}

/**
 * Segments below this share cannot fit a readable label.
 *
 * A share and not a width, because the strip spans the page and the tooltip
 * inside a segment is fixed-position, which rules out asking the segment how
 * wide it came out.
 */
const LABEL_THRESHOLD = 0.04;

/**
 * The current drill scope as one bar, split by the folders directly inside it.
 *
 * Mass is the subject of this tool, so it is drawn as length before it is
 * written as digits. A segment's width is its folder's share of the scope, and
 * the bands stacked inside it are the flavors that folder is made of, so one
 * strip answers where the weight sits and what it is. Each segment selects its
 * folder.
 *
 * The strip above the bar states the same columns as the folder head, in the
 * same order, so one figure is read the same way in both places and only the
 * subject changes: the folder head describes the selection, and this describes
 * the whole drill scope. What only this strip can say - how much of the project
 * the scope and the filters keep, and how much of that is comment - stands to
 * the right of the columns rather than among them.
 */
export function MassRibbon(
  { summary, measure, aspect, isDiff, countedFlavors, selected, onSelect }: Props,
): React.JSX.Element {
  const segments = summary?.ribbon ?? [];
  // Magnitude, because in net a folder that removed 400 lines is 400 of the
  // scope's ink even though its weight is negative.
  const total = segments.reduce((sum, segment) => sum + Math.abs(segment.weight), 0);
  const unit = weightName(measure, aspect, isDiff);
  // Net is signed, so no whole divides it into an honest percentage and the
  // strip states none.
  const showsShare = aspect !== "net";
  // Taken from the response, not from the pending request, so the labels and
  // the numbers always describe the same scope.
  const drilled = summary !== null && summary.scopePath !== "";
  const scopeMeasures: Record<Measure, number> = {
    tokens: summary?.selectedTokens ?? 0,
    lines: summary?.selectedLines ?? 0,
    codeLines: summary?.selectedCodeLines ?? 0,
  };
  const totals = aspectTotals({
    added: summary?.selectedAdded ?? 0,
    removed: summary?.selectedRemoved ?? 0,
    ...scopeMeasures,
  }, measure);
  const before = summary === null ? 0 : {
    tokens: summary.selectedBeforeTokens,
    lines: summary.selectedBeforeLines,
    codeLines: summary.selectedBeforeCodeLines,
  }[measure];

  return (
    <section
      className="ribbon"
      aria-label={drilled ? `Drill scope ${unit} by folder` : `Whole ${unit} by top-level folder`}
    >
      <div className="ribbon__head">
        <div className="ribbon__identity">
          {/* The strip carries no "selected" label of its own, so this names its
              subject once: the drill scope, as the filters and the checkboxes
              leave it. */}
          <p className="eyebrow ribbon__eyebrow">{drilled ? "drilled scope under current filters" : "whole project under current filters"}</p>
          <div className="readouts ribbon__readouts">
            {isDiff
              ? ASPECTS.map((candidate) => {
                const figure = aspectFigure(candidate, totals[candidate]);
                return (
                  <Readout
                    key={candidate}
                    label={weightHeading(measure, candidate, true)}
                    value={summary ? figure.text : "-"}
                    sign={figure.sign}
                    emphasis={candidate === aspect}
                  />
                );
              }).concat(
                <Readout
                  key="net-percent"
                  label="net %"
                  value={summary ? changePercent("net", totals.net, before) : "-"}
                />,
              )
              : MEASURES.map((candidate) => (
                <Readout
                  key={candidate}
                  label={measureHeading(candidate)}
                  value={summary ? count(scopeMeasures[candidate]) : "-"}
                  emphasis={candidate === measure}
                />
              ))}
          </div>
        </div>
        {/* The one fact no other panel can state: how much of the project this
            scope and these filters keep. It stands beside the columns rather
            than among them, and in net it is absent rather than empty, because
            a signed quantity has no honest whole to divide by. */}
        <div className="ribbon__actions">
          {showsShare ? (
            <Readout
              label="of project"
              value={summary && summary.projectWeight > 0
                ? percent(Math.abs(summary.selectedWeight) / summary.projectWeight)
                : "-"}
              emphasis
            />
          ) : null}
        </div>
      </div>

      <div className="ribbon__track">
        {segments.map((segment) => {
          const share = total > 0 ? Math.abs(segment.weight) / total : 0;
          // A folder segment also marks a selection below it, because drilling
          // into a child is still reading that part of the scope. The `.`
          // segment holds files and nothing sits below it.
          const marked = segment.rowKind === "files"
            ? selected.rowKind === "files" && selected.path === segment.path
            : selected.rowKind === "folder"
              && (selected.path === segment.path || selected.path.startsWith(`${segment.path}/`));
          // `.` names a row of the tree, where the folder above it gives it its
          // meaning. On its own, in a panel or read aloud, it is a speck.
          const subject = segment.rowKind === "files" ? "Files directly in this folder" : segment.name;
          const figures = `${weightCount(segment.weight, aspect)} ${unit}, ${percent(share)} of scope`;
          const label = `${subject} - ${figures}`;
          const body = (
            <>
              <FlavorStack slices={segment.flavors} />
              {share >= LABEL_THRESHOLD
                ? <SegmentLabel name={segment.name} weight={segment.weight} aspect={aspect} />
                : null}
              <Tooltip compact>
                <span className="ribbon__tip">
                  <span className="ribbon__tip-name">{subject}</span>
                  <span className="ribbon__tip-scope">{figures}</span>
                  <FlavorLegend slices={segment.flavors} counted={countedFlavors} />
                </span>
              </Tooltip>
            </>
          );
          const segmentPath = segment.path;
          const width = { width: `${share * 100}%` };
          // The tail segment stands for folders the strip stopped drawing one at
          // a time, so it names no row and selects nothing.
          return segmentPath === null ? (
            <div key="rest" className="ribbon__segment" style={width} role="img" aria-label={label} {...tooltipHandlers}>
              {body}
            </div>
          ) : (
            <button
              key={`${segment.rowKind}:${segmentPath}`}
              type="button"
              className="ribbon__segment"
              style={width}
              data-selected={marked}
              aria-label={label}
              onClick={() => onSelect(segment.rowKind, segmentPath)}
              {...tooltipHandlers}
            >
              {body}
            </button>
          );
        })}
        {segments.length === 0 ? <div className="ribbon__segment ribbon__segment--empty" /> : null}
      </div>
    </section>
  );
}

/** Magnitudes, so a net segment is made of as much ink as it moved. */
function bandTotal(slices: readonly FlavorSlice[]): number {
  return slices.reduce((sum, slice) => sum + slice.weight, 0);
}

/**
 * One folder's weight divided by flavor, top to bottom.
 *
 * The bands are grown rather than sized, so they divide the segment's height
 * exactly however many of them there are and whatever the seams between them
 * cost.
 */
function FlavorStack({ slices }: { slices: readonly FlavorSlice[] }): React.JSX.Element {
  return (
    <span className="ribbon__stack" aria-hidden="true">
      {slices.map((slice) => (
        <span
          key={slice.flavor}
          className="ribbon__band"
          data-flavor={slice.flavor}
          style={{ flexGrow: slice.weight }}
        />
      ))}
    </span>
  );
}

/**
 * The bands of one segment, named and measured, so the strip needs no legend.
 *
 * Every flavor takes a row, not only the ones the segment holds: a reader who
 * turned a switch off has to see that the strip stopped counting it, and a
 * flavor a folder simply has none of is a different answer from one the page
 * dropped. The panel is then the same table for every segment.
 *
 * The unit is stated once above rather than on every row: the rows are a column
 * of figures, and a word between the digits and the share breaks the column.
 */
function FlavorLegend(
  { slices, counted }: { slices: readonly FlavorSlice[]; counted: readonly Flavor[] },
): React.JSX.Element {
  const whole = bandTotal(slices);
  const weights = new Map(slices.map((slice) => [slice.flavor, slice.weight]));
  return (
    <span className="ribbon__tip-rows">
      {FLAVORS.map((flavor) => {
        const dropped = !counted.includes(flavor);
        const weight = weights.get(flavor) ?? 0;
        return (
          <span key={flavor} className="ribbon__tip-row" data-off={dropped || weight === 0}>
            <span className="ribbon__swatch" data-flavor={flavor} />
            <span>{FLAVOR_DETAILS[flavor].label}</span>
            {dropped ? <span className="ribbon__tip-dropped">(excluded)</span> : (
              <>
                <span className="ribbon__tip-figure">{count(weight)}</span>
                <span className="ribbon__tip-figure">{percent(whole > 0 ? weight / whole : 0)}</span>
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

function SegmentLabel(
  { name, weight, aspect }: { name: string; weight: number; aspect: Aspect },
): React.JSX.Element {
  return (
    <span className="ribbon__label">
      <span className="ribbon__name">{name}</span>
      <span className="ribbon__weight">
        {aspect === "net" && weight !== 0 ? `${weight < 0 ? "-" : "+"}${compact(Math.abs(weight))}` : compact(weight)}
      </span>
    </span>
  );
}
