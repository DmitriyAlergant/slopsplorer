import type { Aspect, ChangeStatus, Measure } from "../shared/api.ts";

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function count(value: number): string {
  return integer.format(value);
}

/** Compact magnitude for tight spaces: 12_400 becomes "12.4k". */
export function compact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
}

/** A 0-1 ratio as a percentage, keeping one decimal below 10 percent. */
export function percent(ratio: number): string {
  const value = ratio * 100;
  if (value === 0) return "0%";
  if (value < 0.1) return "<0.1%";
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

/** Relative age of an ISO timestamp, for the scan freshness readout. */
export function since(isoTimestamp: string): string {
  const elapsedSeconds = Math.max(0, (Date.now() - new Date(isoTimestamp).getTime()) / 1000);
  if (elapsedSeconds < 45) return "just now";
  if (elapsedSeconds < 3600) return `${Math.round(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 86_400) return `${Math.round(elapsedSeconds / 3600)}h ago`;
  return `${Math.round(elapsedSeconds / 86_400)}d ago`;
}

/**
 * How each measure is named in prose, in a heading, and in a tight cell.
 *
 * One table rather than three, so a new measure cannot arrive with a label
 * missing from one surface and present in another.
 */
const MEASURE_NAMES: Record<Measure, { prose: string; heading: string; abbreviation: string }> = {
  tokens: { prose: "tokens", heading: "Tokens", abbreviation: "tok" },
  lines: { prose: "lines", heading: "Lines", abbreviation: "lines" },
  codeLines: { prose: "LOC", heading: "LOC", abbreviation: "LOC" },
};

/** Name for running text: "42,000 tokens", "1,200 LOC". */
export function measureName(measure: Measure): string {
  return MEASURE_NAMES[measure].prose;
}

/** Title-case name for a control, a button, or a column heading. */
export function measureHeading(measure: Measure): string {
  return MEASURE_NAMES[measure].heading;
}

/** Shortest form, for a tile caption where the number matters more than the unit. */
export function measureAbbreviation(measure: Measure): string {
  return MEASURE_NAMES[measure].abbreviation;
}

/**
 * How each aspect is named beside a unit and explained in the menu.
 *
 * One table for all three surfaces, so a new aspect cannot arrive with a label
 * on one of them and nothing on the others.
 */
const ASPECT_NAMES: Record<Aspect, { heading: string; prose: string; description: string }> = {
  churn: {
    heading: "Churn",
    prose: "churn",
    description: "Added plus removed. The volume of the change, and never negative.",
  },
  net: {
    heading: "Net",
    prose: "net",
    description: "Added minus removed. What the change leaves behind, and signed.",
  },
  added: { heading: "Added", prose: "added", description: "Only the lines the change introduced." },
  removed: { heading: "Removed", prose: "removed", description: "Only the lines the change took away." },
  after: {
    heading: "After",
    prose: "after",
    description: "The whole file as the change leaves it, the same figure a scan reports.",
  },
};

export function aspectHeading(aspect: Aspect): string {
  return ASPECT_NAMES[aspect].heading;
}

export function aspectDescription(aspect: Aspect): string {
  return ASPECT_NAMES[aspect].description;
}

/**
 * Name the numbers column, which is one unit in a scan and a unit and a side
 * in a diff.
 */
export function weightHeading(measure: Measure, aspect: Aspect, isDiff: boolean): string {
  return isDiff
    ? `${ASPECT_NAMES[aspect].heading} ${MEASURE_NAMES[measure].abbreviation}`
    : MEASURE_NAMES[measure].heading;
}

/** Name for running text: "42,000 churn tokens", "1,200 LOC". */
export function weightName(measure: Measure, aspect: Aspect, isDiff: boolean): string {
  return isDiff && aspect !== "after"
    ? `${ASPECT_NAMES[aspect].prose} ${MEASURE_NAMES[measure].prose}`
    : MEASURE_NAMES[measure].prose;
}

/**
 * A signed figure, with the sign always drawn.
 *
 * Net weight is the only signed quantity on the page, and a "-" that only
 * appears sometimes reads as a hyphen rather than as a direction.
 */
export function signed(value: number): string {
  if (value === 0) return "0";
  return `${value < 0 ? "-" : "+"}${integer.format(Math.abs(value))}`;
}

/** Figures in the active aspect, signed only where the aspect is. */
export function weightCount(value: number, aspect: Aspect): string {
  return aspect === "net" ? signed(value) : count(value);
}

const CHANGE_STATUS_LABELS: Record<ChangeStatus, string> = {
  added: "new",
  modified: "edit",
  deleted: "gone",
  renamed: "moved",
  unchanged: "same",
};

/** Short tag for the status column, sized for a table cell. */
export function statusLabel(status: ChangeStatus): string {
  return CHANGE_STATUS_LABELS[status];
}
