import type { CommitSpine, ComparisonRequest, FileRow, SpineEntry } from "../shared/api.ts";
import { scanDiff, type DiffScanOptions } from "./diffScan.ts";
import { commitComparison, commitUrlBase, listSpineCommits, type SpineCommit } from "./gitdiff.ts";
import { mapWithConcurrency } from "./scan.ts";

/**
 * Commits measured at once.
 *
 * Each one runs a whole diff of its own, and each of those already spreads its
 * files over the scan concurrency, so a few in flight fill the machine without
 * making a review wait on a fleet of Git processes.
 */
const SPINE_CONCURRENCY = 4;

/**
 * What one commit changed, with generated files left out.
 *
 * The spine sits above the filter bar and states the same figures however the
 * page below is narrowed, so nothing here reads a filter. Generated files are
 * the exception that is not an exception: a regenerated lockfile flattens every
 * other commit into noise, and nobody wrote it, so it was never part of what a
 * commit costs to review.
 */
function measuredCommit(commit: SpineCommit, files: readonly FileRow[], urlBase: string | null): SpineEntry {
  const entry: SpineEntry = {
    sha: commit.sha,
    shortSha: commit.shortSha,
    parent: commit.parent,
    subject: commit.subject,
    body: commit.body,
    url: urlBase === null ? null : `${urlBase}${commit.sha}`,
    author: commit.author,
    date: commit.date,
    files: 0,
    addedTokens: 0,
    removedTokens: 0,
    addedLines: 0,
    removedLines: 0,
    addedCodeLines: 0,
    removedCodeLines: 0,
  };
  for (const file of files) {
    if (file.generated) continue;
    entry.files += 1;
    entry.addedTokens += file.addedTokens;
    entry.removedTokens += file.removedTokens;
    entry.addedLines += file.addedLines;
    entry.removedLines += file.removedLines;
    entry.addedCodeLines += file.addedCodeLines;
    entry.removedCodeLines += file.removedCodeLines;
  }
  return entry;
}

/**
 * Measure every commit a comparison spans.
 *
 * Each commit is measured against its own first parent, by the same scanner
 * that measures the range, so a figure in the band and a figure in the page
 * mean the same thing. `null` when the comparison has no spine, which is any
 * comparison with the working tree or the index on one side.
 *
 * The column will not sum to the range: a line a later commit rewrites is
 * counted in both, and the difference is the branch's own rework rather than
 * a fault in either figure.
 */
export async function buildSpine(
  options: DiffScanOptions, request: ComparisonRequest,
): Promise<CommitSpine | null> {
  const listed = await listSpineCommits(options.root, options.comparison);
  if (listed === null) return null;

  const { onProgress: _ignored, ...quiet } = options;
  const urlBase = await commitUrlBase(options.root);
  const commits = await mapWithConcurrency(listed.commits, SPINE_CONCURRENCY, async (commit) => {
    const index = await scanDiff({ ...quiet, comparison: commitComparison(commit.sha, commit.parent) });
    return measuredCommit(commit, index.files, urlBase);
  });

  return { range: request, commits, omitted: listed.omitted };
}
