import type { Aspect, ChangeStatus, ComparisonRequest, Measure } from "../shared/api.ts";

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

/** A count and the noun it agrees with: "1 file", "2 files". */
export function countOf(value: number, noun: string): string {
  return `${count(value)} ${noun}${value === 1 ? "" : "s"}`;
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
 * Shortest form that still says which side it is: "net tok", "removed lines".
 *
 * A tile states one figure, and the switch that chose it is at the top of the
 * page, so the figure has to name its own side or it means nothing on its own.
 */
export function weightAbbreviation(measure: Measure, aspect: Aspect, isDiff: boolean): string {
  return isDiff
    ? `${ASPECT_NAMES[aspect].prose} ${MEASURE_NAMES[measure].abbreviation}`
    : MEASURE_NAMES[measure].abbreviation;
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

/**
 * One side of a change, signed unless it is nothing.
 *
 * Nothing has no direction, and a red "-0" reads as a broken figure rather
 * than as an absence.
 */
export function sideCount(value: number, sign: "+" | "-"): string {
  return value === 0 ? "0" : `${sign}${count(value)}`;
}

/** Figures in the active aspect, signed only where the aspect is. */
export function weightCount(value: number, aspect: Aspect): string {
  return aspect === "net" ? signed(value) : count(value);
}

/** How a figure is coloured. Direction is drawn beside the hue, never by it. */
export type FigureSign = "positive" | "negative" | "zero" | "none";

/**
 * One aspect figure, formatted and given its direction.
 *
 * Added and removed take the direction of the side they name rather than of
 * their own value, so a removal reads as a removal wherever it is drawn.
 */
export function aspectFigure(aspect: Aspect, value: number): { text: string; sign: FigureSign } {
  switch (aspect) {
    case "added": return { text: sideCount(value, "+"), sign: value === 0 ? "zero" : "positive" };
    case "removed": return { text: sideCount(value, "-"), sign: value === 0 ? "zero" : "negative" };
    case "net": return { text: signed(value), sign: value === 0 ? "zero" : value < 0 ? "negative" : "positive" };
    case "churn": case "after": return { text: count(value), sign: "none" };
  }
}

/** A whole object name, which is the one revision safe to abbreviate. */
const WHOLE_OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * A revision as the page prints it.
 *
 * Forty monospace characters of commit dwarf every other reading in the strip,
 * and a whole object name is the only revision that can be cut without turning
 * an unambiguous prefix into an ambiguous one.
 */
export function shortRevision(rev: string): string {
  const pullRequest = /^refs\/slopsplorer\/pull\/(\d+)$/.exec(rev);
  if (pullRequest !== null) return `PR ${pullRequest[1]}`;
  return WHOLE_OBJECT_NAME.test(rev) ? rev.slice(0, 10) : rev;
}

/**
 * A comparison in one line, the way the instrument bar names one.
 *
 * One labeller, so the picker and the progress card cannot describe the same
 * comparison in two ways.
 */
export function comparisonLabel(request: ComparisonRequest): string {
  switch (request.kind) {
    case "workingTree": return "HEAD -> working tree";
    case "staged": return "HEAD -> index";
    case "revisionToWorkingTree": return `${shortRevision(request.rev)} -> working tree`;
    case "revisionPair": return `${shortRevision(request.base)} -> ${shortRevision(request.target)}`;
    case "mergeBase":
      return `${shortRevision(request.base)} -> ${shortRevision(request.target)}, from the merge base`;
  }
}

/**
 * How each status is drawn, and how it is read aloud.
 *
 * The letter is Git's own, from `git status --short` and `git diff
 * --name-status`, so a reader arrives already knowing it and the column needs
 * no legend. The prose is what a screen reader gets, because a letter alone
 * says nothing without the convention behind it.
 */
const CHANGE_STATUS_NAMES: Record<ChangeStatus, { letter: string; prose: string }> = {
  added: { letter: "A", prose: "added" },
  modified: { letter: "M", prose: "modified" },
  deleted: { letter: "D", prose: "deleted" },
  renamed: { letter: "R", prose: "renamed" },
  unchanged: { letter: "=", prose: "unchanged" },
};

/** Git's one-letter mark for the status column. */
export function statusLetter(status: ChangeStatus): string {
  return CHANGE_STATUS_NAMES[status].letter;
}

/** What the letter stands for, in running text. */
export function statusName(status: ChangeStatus): string {
  return CHANGE_STATUS_NAMES[status].prose;
}
