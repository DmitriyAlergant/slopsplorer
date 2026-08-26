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
