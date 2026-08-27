import type { CommitSpine, Measure, SpineEntry } from "../shared/api.ts";

const ADDED_FIELDS: Readonly<Record<Measure, keyof SpineEntry>> = {
  tokens: "addedTokens", lines: "addedLines", codeLines: "addedCodeLines",
};

const REMOVED_FIELDS: Readonly<Record<Measure, keyof SpineEntry>> = {
  tokens: "removedTokens", lines: "removedLines", codeLines: "removedCodeLines",
};

/** What one commit added and removed, in the unit the page is counting in. */
export function sidesOf(entry: SpineEntry, measure: Measure): { added: number; removed: number } {
  return {
    added: entry[ADDED_FIELDS[measure]] as number,
    removed: entry[REMOVED_FIELDS[measure]] as number,
  };
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
