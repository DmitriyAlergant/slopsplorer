import type { Aspect, ChangeStatus, ComparisonRequest, Measure, ScanMeta } from "../shared/api.ts";

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

/**
 * A run length as minutes and seconds: "0:42", "3:05".
 *
 * Read while it climbs, so the seconds are always two digits and the string
 * never changes width under the eye.
 */
export function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
 * The browser tab's name for what the page holds.
 *
 * The subject comes first, because a tab is cut from the right and the folder
 * is what tells two Slopsplorer windows apart. The product name follows it in
 * the form the wordmark uses, so the tab and the strip name one mode.
 */
export function documentTitle(meta: ScanMeta | null): string {
  if (meta === null) return "Slopsplorer";
  if (meta.diff === null) return `${meta.rootName} - Slopsplorer`;
  return `${meta.rootName}: ${comparisonLabel(meta.diff.request)} - Slopsplorer diff`;
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
