import type { Measure } from "../shared/api.ts";

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
