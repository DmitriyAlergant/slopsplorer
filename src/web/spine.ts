import type { CommitSpine, Measure, SpineEntry } from "../shared/api.ts";

/** A `SpineEntry` field that holds a figure, which is every one but its identity. */
type MeasuredSpineField = {
  [Field in keyof SpineEntry]: SpineEntry[Field] extends number ? Field : never;
}[keyof SpineEntry];

/**
 * The two fields one measure reads a commit's sides from.
 *
 * Every name appears whole, as it does in `SpineEntry` and in `FileRow`, so one
 * search finds each of them everywhere it matters.
 */
const SIDE_FIELDS: Readonly<Record<Measure, { added: MeasuredSpineField; removed: MeasuredSpineField }>> = {
  tokens: { added: "addedTokens", removed: "removedTokens" },
  lines: { added: "addedLines", removed: "removedLines" },
  codeLines: { added: "addedCodeLines", removed: "removedCodeLines" },
};

/** What one commit added and removed, in the unit the page is counting in. */
export function sidesOf(entry: SpineEntry, measure: Measure): { added: number; removed: number } {
  const fields = SIDE_FIELDS[measure];
  return { added: entry[fields.added], removed: entry[fields.removed] };
}

/** The heaviest churn in a spine, which is what every bar is drawn against. */
export function heaviestChurn(spine: CommitSpine, measure: Measure): number {
  let heaviest = 0;
  for (const entry of spine.commits) {
    const { added, removed } = sidesOf(entry, measure);
    heaviest = Math.max(heaviest, added + removed);
  }
  return heaviest;
}
